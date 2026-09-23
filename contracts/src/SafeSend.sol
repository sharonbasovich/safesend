// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title SafeSend — poison-aware payment router
/// @notice UNAUDITED TESTNET PROTOTYPE. Built for a hackathon; do not use with real funds.
///
/// A verified payee receives funds instantly. An unknown payee's transfer is
/// escrowed for the sender's cooldown window and must be claimed by the
/// recipient — claiming verifies the payee for future sends. An address whose
/// first and last 4 hex characters match a verified payee ("lookalike", the
/// heuristic address-poisoning attacks exploit) is escrowed for a fixed 24h
/// window and flagged on-chain; the sender must additionally approve the
/// flagged recipient before it can claim.
///
/// No owner, no upgradeability, no fees. Custody is by code only.
contract SafeSend is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        Pending,
        Claimed,
        Cancelled,
        Reclaimed
    }

    enum Reason {
        UnknownPayee,
        LookalikeOfVerified
    }

    struct Transfer {
        address token; // address(0) = native ETH
        address from;
        address to;
        uint128 amount;
        uint64 unlockAt;
        Status status;
        Reason reason;
    }

    /// @notice sender => payee => verified by an out-of-band check or a completed claim
    mapping(address => mapping(address => bool)) public verified;

    /// @notice sender => fingerprint => count of verified payees sharing that fingerprint
    /// @dev fingerprint = top 16 bits ++ low 16 bits of the address (first 4 + last 4 hex chars)
    mapping(address => mapping(uint32 => uint16)) public fpCount;

    /// @notice sender => escrow window for unknown payees; 0 means DEFAULT_COOLDOWN
    mapping(address => uint64) public cooldown;

    mapping(uint256 => Transfer) public transfers;

    /// @notice escrow id => sender approved the flagged lookalike recipient.
    /// Only meaningful for LookalikeOfVerified escrows; a separate mapping so
    /// the Transfer tuple stays unchanged.
    mapping(uint256 => bool) public lookalikeApproved;

    /// @dev transfer ids start at 1; send() returns 0 for instant sends
    uint256 public nextId = 1;

    uint64 public constant DEFAULT_COOLDOWN = 1 hours;
    uint64 public constant MIN_COOLDOWN = 60 seconds;
    uint64 public constant MAX_COOLDOWN = 7 days;
    uint64 public constant LOOKALIKE_LOCK = 24 hours;
    uint64 public constant RECLAIM_AFTER = 30 days;

    event Sent(address indexed from, address indexed to, address token, uint256 amount);
    event Escrowed(
        uint256 indexed id,
        address indexed from,
        address indexed to,
        address token,
        uint256 amount,
        uint64 unlockAt,
        uint8 reason
    );
    event LookalikeFlagged(uint256 indexed id, address indexed from, address indexed to, uint32 fingerprint);
    event LookalikeApproved(uint256 indexed id);
    event Claimed(uint256 indexed id);
    event Cancelled(uint256 indexed id);
    event Reclaimed(uint256 indexed id);
    event PayeeVerified(address indexed sender, address indexed payee);
    event PayeeRemoved(address indexed sender, address indexed payee);
    event CooldownSet(address indexed sender, uint64 cooldown);

    error NotRecipient();
    error NotSender();
    error NotApproved();
    error NotLookalike();
    error Locked();
    error NotPending();
    error TooEarly();
    error ZeroAmount();
    error BadValue();
    error CooldownOutOfRange();
    error SelfSend();
    error EthTransferFailed();

    /// @notice first 4 and last 4 hex chars of an address, packed into a uint32
    function fingerprint(address a) public pure returns (uint32) {
        return uint32((uint160(a) >> 144) << 16 | (uint160(a) & 0xffff));
    }

    /// @notice true when `to` is not verified for `sender` but shares a
    /// fingerprint with at least one of sender's verified payees
    function isLookalike(address sender, address to) public view returns (bool) {
        return !verified[sender][to] && fpCount[sender][fingerprint(to)] > 0;
    }

    /// @notice sender's escrow window for unknown payees
    function getCooldown(address sender) public view returns (uint64) {
        uint64 c = cooldown[sender];
        return c == 0 ? DEFAULT_COOLDOWN : c;
    }

    /// @notice Send `amount` of `token` (address(0) = native ETH) to `to`.
    /// @return id escrow id; 0 when the payee was verified and funds moved instantly
    function send(address token, address to, uint128 amount) external payable nonReentrant returns (uint256 id) {
        if (amount == 0) revert ZeroAmount();
        if (to == msg.sender) revert SelfSend();

        _pull(token, amount);

        if (verified[msg.sender][to]) {
            _payout(token, to, amount);
            emit Sent(msg.sender, to, token, amount);
            return 0;
        }

        id = nextId++;
        Transfer storage t = transfers[id];
        t.token = token;
        t.from = msg.sender;
        t.to = to;
        t.amount = amount;
        t.status = Status.Pending;

        if (isLookalike(msg.sender, to)) {
            t.unlockAt = uint64(block.timestamp) + LOOKALIKE_LOCK;
            t.reason = Reason.LookalikeOfVerified;
            emit LookalikeFlagged(id, msg.sender, to, fingerprint(to));
        } else {
            t.unlockAt = uint64(block.timestamp) + getCooldown(msg.sender);
            t.reason = Reason.UnknownPayee;
        }
        emit Escrowed(id, msg.sender, to, token, amount, t.unlockAt, uint8(t.reason));
    }

    /// @notice Sender approves the recipient of a lookalike-quarantined escrow.
    /// Approval is required in addition to the 24h lock before claim() succeeds
    /// — without it the flagged lookalike could claim and auto-verify itself.
    function approveLookalike(uint256 id) external {
        Transfer storage t = transfers[id];
        if (msg.sender != t.from) revert NotSender();
        if (t.status != Status.Pending) revert NotPending();
        if (t.reason != Reason.LookalikeOfVerified) revert NotLookalike();
        lookalikeApproved[id] = true;
        emit LookalikeApproved(id);
    }

    /// @notice Recipient claims escrowed funds after unlock; becomes a verified payee for the sender
    function claim(uint256 id) external nonReentrant {
        Transfer storage t = transfers[id];
        if (msg.sender != t.to) revert NotRecipient();
        if (t.status != Status.Pending) revert NotPending();
        if (block.timestamp < t.unlockAt) revert Locked();
        if (t.reason == Reason.LookalikeOfVerified && !lookalikeApproved[id]) revert NotApproved();

        t.status = Status.Claimed;
        _verify(t.from, t.to);
        emit Claimed(id);

        _payout(t.token, t.to, t.amount);
    }

    /// @notice Sender cancels a pending transfer at any time; funds return to the sender
    function cancel(uint256 id) external nonReentrant {
        Transfer storage t = transfers[id];
        if (msg.sender != t.from) revert NotSender();
        if (t.status != Status.Pending) revert NotPending();

        t.status = Status.Cancelled;
        emit Cancelled(id);

        _payout(t.token, t.from, t.amount);
    }

    /// @notice Sender reclaims a transfer that was never claimed, 30 days after unlock
    function reclaim(uint256 id) external nonReentrant {
        Transfer storage t = transfers[id];
        if (msg.sender != t.from) revert NotSender();
        if (t.status != Status.Pending) revert NotPending();
        if (block.timestamp < uint256(t.unlockAt) + RECLAIM_AFTER) revert TooEarly();

        t.status = Status.Reclaimed;
        emit Reclaimed(id);

        _payout(t.token, t.from, t.amount);
    }

    /// @notice Manually mark `p` as a verified payee. Verify the address out-of-band first.
    function addPayee(address p) external {
        _verify(msg.sender, p);
    }

    function removePayee(address p) external {
        if (verified[msg.sender][p]) {
            verified[msg.sender][p] = false;
            fpCount[msg.sender][fingerprint(p)]--;
            emit PayeeRemoved(msg.sender, p);
        }
    }

    /// @notice Set the escrow window for unknown payees, [60s, 7d]
    function setCooldown(uint64 s) external {
        if (s < MIN_COOLDOWN || s > MAX_COOLDOWN) revert CooldownOutOfRange();
        cooldown[msg.sender] = s;
        emit CooldownSet(msg.sender, s);
    }

    function _verify(address sender, address p) internal {
        if (!verified[sender][p]) {
            verified[sender][p] = true;
            fpCount[sender][fingerprint(p)]++;
            emit PayeeVerified(sender, p);
        }
    }

    function _pull(address token, uint128 amount) internal {
        if (token == address(0)) {
            if (msg.value != amount) revert BadValue();
        } else {
            if (msg.value != 0) revert BadValue();
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        }
    }

    function _payout(address token, address to, uint128 amount) internal {
        if (token == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert EthTransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }
}
