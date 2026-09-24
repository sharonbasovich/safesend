import { parseAbi, parseAbiItem } from "viem";

export const safeSendAbi = parseAbi([
  "function send(address token, address to, uint128 amount) payable returns (uint256)",
  "function claim(uint256 id)",
  "function approveLookalike(uint256 id)",
  "function cancel(uint256 id)",
  "function reclaim(uint256 id)",
  "function addPayee(address p)",
  "function removePayee(address p)",
  "function setCooldown(uint64 s)",
  "function fingerprint(address a) view returns (uint32)",
  "function isLookalike(address sender, address to) view returns (bool)",
  "function getCooldown(address sender) view returns (uint64)",
  "function verified(address, address) view returns (bool)",
  "function fpCount(address, uint32) view returns (uint16)",
  "function transfers(uint256) view returns (address token, address from, address to, uint128 amount, uint64 unlockAt, uint8 status, uint8 reason)",
  "function lookalikeApproved(uint256) view returns (bool)",
  "function nextId() view returns (uint256)",
  "error NotRecipient()",
  "error NotSender()",
  "error NotApproved()",
  "error NotLookalike()",
  "error Locked()",
  "error NotPending()",
  "error TooEarly()",
  "error ZeroAmount()",
  "error BadValue()",
  "error CooldownOutOfRange()",
  "error SelfSend()",
  "error EthTransferFailed()",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
  "error SafeERC20FailedOperation(address token)",
]);

export const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function mint(address to, uint256 amount)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

export const poisonerAbi = parseAbi([
  "function poison(address token, address victim, address lookalike) returns (bool)",
  "function dust(address token, address lookalike, address victim, uint256 amount)",
]);

export const sentEvent = parseAbiItem(
  "event Sent(address indexed from, address indexed to, address token, uint256 amount)"
);
export const escrowedEvent = parseAbiItem(
  "event Escrowed(uint256 indexed id, address indexed from, address indexed to, address token, uint256 amount, uint64 unlockAt, uint8 reason)"
);
export const lookalikeFlaggedEvent = parseAbiItem(
  "event LookalikeFlagged(uint256 indexed id, address indexed from, address indexed to, uint32 fingerprint)"
);
export const lookalikeApprovedEvent = parseAbiItem("event LookalikeApproved(uint256 indexed id)");
export const claimedEvent = parseAbiItem("event Claimed(uint256 indexed id)");
export const cancelledEvent = parseAbiItem("event Cancelled(uint256 indexed id)");
export const reclaimedEvent = parseAbiItem("event Reclaimed(uint256 indexed id)");
export const payeeVerifiedEvent = parseAbiItem(
  "event PayeeVerified(address indexed sender, address indexed payee)"
);
export const payeeRemovedEvent = parseAbiItem(
  "event PayeeRemoved(address indexed sender, address indexed payee)"
);
export const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);

export const STATUS = ["Pending", "Claimed", "Cancelled", "Reclaimed"] as const;
export const REASON = ["Unknown payee", "Lookalike of verified payee"] as const;
