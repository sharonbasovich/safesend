// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SafeSend} from "../src/SafeSend.sol";
import {MockUSDT} from "../src/MockUSDT.sol";

/// @dev exercises the router with random send/claim/cancel/reclaim/addPayee calls
/// across a fixed actor set, tracking expected escrow custody as ghost variables.
contract Handler is Test {
    SafeSend public router;
    MockUSDT public token;

    address[] public actors;
    address[] public payees;
    uint256[] public ids;

    uint256 public ghostErc20Pending;
    uint256 public ghostEthPending;
    uint256 public calls;
    uint256 public violations; // set instead of reverting so failures are attributable

    constructor(SafeSend _router, MockUSDT _token) {
        router = _router;
        token = _token;
        for (uint160 i = 0; i < 3; i++) {
            actors.push(address(uint160(0xA11CE000 + i)));
            vm.deal(actors[i], 1_000 ether);
        }
        for (uint160 i = 0; i < 4; i++) {
            payees.push(address(uint160(0xB0B000 + i)));
        }
        for (uint256 i = 0; i < actors.length; i++) {
            vm.prank(actors[i]);
            token.approve(address(router), type(uint256).max);
        }
    }

    function send(uint8 a, uint8 p, uint96 amount, bool useEth, uint64 cd) external {
        address actor = actors[a % actors.length];
        address payee = payees[p % payees.length];
        amount = uint96(bound(amount, 1, 1_000_000e6));
        cd = uint64(bound(cd, 60, 7 days));

        vm.prank(actor);
        router.setCooldown(cd);

        if (!useEth) {
            token.mint(actor, amount);
        }
        bool wasVerified = router.verified(actor, payee);

        uint256 id;
        if (useEth) {
            vm.prank(actor);
            id = router.send{value: amount}(address(0), payee, amount);
        } else {
            vm.prank(actor);
            id = router.send(address(token), payee, amount);
        }

        if (wasVerified) {
            if (id != 0) violations++; // verified payees must never be escrowed
        } else {
            ids.push(id);
            if (useEth) ghostEthPending += amount;
            else ghostErc20Pending += amount;
        }
        calls++;
    }

    function claim(uint256 idx) external {
        if (ids.length == 0) return;
        uint256 id = ids[idx % ids.length];
        (
            address t,
            address from,
            address to,
            uint128 amount,
            uint64 unlockAt,
            SafeSend.Status status,
            SafeSend.Reason reason
        ) = router.transfers(id);
        if (status != SafeSend.Status.Pending) return;
        if (block.timestamp < unlockAt) vm.warp(unlockAt);
        if (reason == SafeSend.Reason.LookalikeOfVerified && !router.lookalikeApproved(id)) {
            vm.prank(from);
            router.approveLookalike(id);
        }
        vm.prank(to);
        router.claim(id);
        if (t == address(0)) ghostEthPending -= amount;
        else ghostErc20Pending -= amount;
        calls++;
    }

    function cancel(uint256 idx) external {
        if (ids.length == 0) return;
        uint256 id = ids[idx % ids.length];
        (address t, address from,, uint128 amount,, SafeSend.Status status,) = router.transfers(id);
        if (status != SafeSend.Status.Pending) return;
        vm.prank(from);
        router.cancel(id);
        if (t == address(0)) ghostEthPending -= amount;
        else ghostErc20Pending -= amount;
        calls++;
    }

    function reclaim(uint256 idx) external {
        if (ids.length == 0) return;
        uint256 id = ids[idx % ids.length];
        (address t, address from,, uint128 amount, uint64 unlockAt, SafeSend.Status status,) = router.transfers(id);
        if (status != SafeSend.Status.Pending) return;
        if (block.timestamp < uint256(unlockAt) + 30 days) vm.warp(uint256(unlockAt) + 30 days);
        vm.prank(from);
        router.reclaim(id);
        if (t == address(0)) ghostEthPending -= amount;
        else ghostErc20Pending -= amount;
        calls++;
    }

    function addPayee(uint8 a, uint8 p) external {
        vm.prank(actors[a % actors.length]);
        router.addPayee(payees[p % payees.length]);
        calls++;
    }

    function idsLength() external view returns (uint256) {
        return ids.length;
    }
}

contract SafeSendInvariantTest is Test {
    SafeSend internal router;
    MockUSDT internal token;
    Handler internal handler;

    function setUp() public {
        router = new SafeSend();
        token = new MockUSDT();
        handler = new Handler(router, token);
        targetContract(address(handler));
    }

    /// contract holds exactly the sum of Pending escrows, per asset — never more, never less
    function invariant_escrowSolvency_erc20() public view {
        assertEq(token.balanceOf(address(router)), handler.ghostErc20Pending());
    }

    function invariant_escrowSolvency_eth() public view {
        assertEq(address(router).balance, handler.ghostEthPending());
    }

    /// ids are sequential, no gaps: every escrow ever created is tracked
    function invariant_nextIdConsistent() public view {
        assertEq(router.nextId(), handler.idsLength() + 1);
    }

    /// a send to a verified payee never created an escrow
    function invariant_verifiedNeverEscrowed() public view {
        assertEq(handler.violations(), 0);
    }
}
