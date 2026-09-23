// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SafeSend} from "../src/SafeSend.sol";
import {MockUSDT} from "../src/MockUSDT.sol";

contract SafeSendTest is Test {
    SafeSend internal router;
    MockUSDT internal token;

    address internal alice = makeAddr("alice"); // sender / victim
    address internal terry = makeAddr("terry"); // verified payee
    address internal bob = makeAddr("bob"); // unknown payee
    address internal attacker = makeAddr("attacker");

    uint128 internal constant AMT = 1_000e6;

    function setUp() public {
        router = new SafeSend();
        token = new MockUSDT();

        token.mint(alice, 100_000e6);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 1 ether);
        vm.deal(terry, 1 ether);
        vm.deal(attacker, 1 ether);

        vm.prank(alice);
        token.approve(address(router), type(uint256).max);
    }

    function _escrowTo(address to, uint128 amount) internal returns (uint256 id) {
        vm.prank(alice);
        id = router.send(address(token), to, amount);
    }

    function _escrowToAlice2(address to, uint128 amount) internal returns (uint256 id) {
        vm.prank(alice);
        id = router.send(address(token), to, amount);
    }

    // ---------- fingerprint / isLookalike ----------

    function test_fingerprint_matchesFirstLast4Hex() public view {
        address a = address(uint160(0x7a3F1234567890ABCdEF1234567890AbcDeF9c21));
        // top 16 bits = 0x7a3F, low 16 bits = 0x9c21
        assertEq(router.fingerprint(a), 0x7a3f9c21);
    }

    function test_isLookalike_trueWhenFingerprintMatchesVerifiedPayee() public {
        address payee = address(uint160(0x7a3F000000000000000000000000000000009C21));
        address lookalike = address(uint160(0x7a3F111111111111111111111111111111119c21)); // same fp, different address
        vm.prank(alice);
        router.addPayee(payee);
        assertTrue(router.isLookalike(alice, lookalike));
        assertFalse(router.isLookalike(alice, payee));
    }

    function test_isLookalike_falseForUnrelatedAddress() public {
        vm.prank(alice);
        router.addPayee(terry);
        assertFalse(router.isLookalike(alice, bob));
    }

    // ---------- send paths ----------

    function test_send_verifiedPayee_isInstant_erc20() public {
        vm.prank(alice);
        router.addPayee(terry);

        uint256 id;
        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit SafeSend.Sent(alice, terry, address(token), AMT);
        id = router.send(address(token), terry, AMT);

        assertEq(id, 0);
        assertEq(token.balanceOf(terry), AMT);
        assertEq(token.balanceOf(address(router)), 0);
        assertEq(router.nextId(), 1); // no escrow created
    }

    function test_send_verifiedPayee_isInstant_eth() public {
        vm.prank(alice);
        router.addPayee(terry);

        uint256 terryBal = terry.balance;
        vm.prank(alice);
        uint256 id = router.send{value: 1 ether}(address(0), terry, 1 ether);

        assertEq(id, 0);
        assertEq(terry.balance, terryBal + 1 ether);
        assertEq(address(router).balance, 0);
    }

    function test_send_unknownPayee_escrowsWithSenderCooldown() public {
        vm.prank(alice);
        router.setCooldown(90);

        vm.prank(alice);
        vm.expectEmit(true, true, true, false);
        emit SafeSend.Escrowed(1, alice, bob, address(token), AMT, uint64(block.timestamp) + 90, 0);
        uint256 id = router.send(address(token), bob, AMT);

        assertEq(id, 1);
        (
            address t,
            address from,
            address to,
            uint128 amount,
            uint64 unlockAt,
            SafeSend.Status status,
            SafeSend.Reason reason
        ) = router.transfers(id);
        assertEq(t, address(token));
        assertEq(from, alice);
        assertEq(to, bob);
        assertEq(amount, AMT);
        assertEq(unlockAt, uint64(block.timestamp) + 90);
        assertEq(uint8(status), uint8(SafeSend.Status.Pending));
        assertEq(uint8(reason), uint8(SafeSend.Reason.UnknownPayee));
        assertEq(token.balanceOf(address(router)), AMT);
    }

    function test_send_unknownPayee_defaultCooldownIs1h() public {
        uint256 id = _escrowTo(bob, AMT);
        (,,,, uint64 unlockAt,,) = router.transfers(id);
        assertEq(unlockAt, uint64(block.timestamp) + 1 hours);
    }

    function test_send_lookalike_escrows24h_andFlags() public {
        vm.prank(alice);
        router.addPayee(terry);

        // craft a lookalike of terry: same first 4 + last 4 hex chars
        address lookalike = _lookalikeOf(terry);
        assertEq(router.fingerprint(lookalike), router.fingerprint(terry));
        assertTrue(router.isLookalike(alice, lookalike));
        uint32 fp = router.fingerprint(lookalike);

        vm.prank(alice);
        vm.expectEmit(true, true, true, true);
        emit SafeSend.LookalikeFlagged(1, alice, lookalike, fp);
        uint256 id = router.send(address(token), lookalike, AMT);

        (,,,, uint64 unlockAt,, SafeSend.Reason reason) = router.transfers(id);
        assertEq(unlockAt, uint64(block.timestamp) + 24 hours);
        assertEq(uint8(reason), uint8(SafeSend.Reason.LookalikeOfVerified));
    }

    // ---------- send reverts ----------

    function test_send_zeroAmount_reverts() public {
        vm.prank(alice);
        vm.expectRevert(SafeSend.ZeroAmount.selector);
        router.send(address(token), bob, 0);
    }

    function test_send_toSelf_reverts() public {
        vm.prank(alice);
        vm.expectRevert(SafeSend.SelfSend.selector);
        router.send(address(token), alice, AMT);
    }

    function test_send_ethValueMismatch_reverts() public {
        vm.prank(alice);
        vm.expectRevert(SafeSend.BadValue.selector);
        router.send{value: 0.5 ether}(address(0), bob, 1 ether);
    }

    function test_send_erc20WithValue_reverts() public {
        vm.prank(alice);
        vm.expectRevert(SafeSend.BadValue.selector);
        router.send{value: 1 ether}(address(token), bob, AMT);
    }

    // ---------- claim ----------

    function test_claim_beforeUnlock_revertsLocked() public {
        uint256 id = _escrowTo(bob, AMT);
        vm.prank(bob);
        vm.expectRevert(SafeSend.Locked.selector);
        router.claim(id);
    }

    function test_claim_byNonRecipient_reverts() public {
        uint256 id = _escrowTo(bob, AMT);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(attacker);
        vm.expectRevert(SafeSend.NotRecipient.selector);
        router.claim(id);
    }

    function test_claim_afterUnlock_paysAndVerifies() public {
        uint256 id = _escrowTo(bob, AMT);
        vm.warp(block.timestamp + 1 hours);

        vm.prank(bob);
        vm.expectEmit(true, false, false, false);
        emit SafeSend.Claimed(id);
        router.claim(id);

        assertEq(token.balanceOf(bob), AMT);
        assertEq(token.balanceOf(address(router)), 0);
        assertTrue(router.verified(alice, bob));
        assertEq(router.fpCount(alice, router.fingerprint(bob)), 1);
    }

    function test_claim_atExactUnlock_works() public {
        uint256 id = _escrowTo(bob, AMT);
        vm.warp(block.timestamp + 1 hours); // exactly unlockAt
        vm.prank(bob);
        router.claim(id);
        assertEq(token.balanceOf(bob), AMT);
    }

    function test_claim_twice_reverts() public {
        uint256 id = _escrowTo(bob, AMT);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(bob);
        router.claim(id);
        vm.prank(bob);
        vm.expectRevert(SafeSend.NotPending.selector);
        router.claim(id);
    }

    function test_claim_thenSecondSend_isInstant() public {
        uint256 id = _escrowTo(bob, AMT);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(bob);
        router.claim(id);

        vm.prank(alice);
        uint256 id2 = router.send(address(token), bob, AMT);
        assertEq(id2, 0);
        assertEq(token.balanceOf(bob), 2 * AMT);
    }

    function test_claim_eth() public {
        vm.prank(alice);
        uint256 id = router.send{value: 2 ether}(address(0), bob, 2 ether);
        assertEq(address(router).balance, 2 ether);

        vm.warp(block.timestamp + 1 hours);
        uint256 bobBal = bob.balance;
        vm.prank(bob);
        router.claim(id);
        assertEq(bob.balance, bobBal + 2 ether);
        assertEq(address(router).balance, 0);
    }

    // ---------- cancel ----------

    function test_cancel_byNonSender_reverts() public {
        uint256 id = _escrowTo(bob, AMT);
        vm.prank(bob);
        vm.expectRevert(SafeSend.NotSender.selector);
        router.cancel(id);
    }

    function test_cancel_refundsSender() public {
        uint256 id = _escrowTo(bob, AMT);
        assertEq(token.balanceOf(alice), 100_000e6 - AMT);

        vm.prank(alice);
        vm.expectEmit(true, false, false, false);
        emit SafeSend.Cancelled(id);
        router.cancel(id);

        assertEq(token.balanceOf(alice), 100_000e6);
        assertEq(token.balanceOf(address(router)), 0);
    }

    function test_cancel_afterClaim_reverts() public {
        uint256 id = _escrowTo(bob, AMT);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(bob);
        router.claim(id);
        vm.prank(alice);
        vm.expectRevert(SafeSend.NotPending.selector);
        router.cancel(id);
    }

    function test_cancel_lookalikeEscrow_refundsBeforeUnlock() public {
        // the core defense: sender sent to a lookalike, sees the flag, cancels
        vm.prank(alice);
        router.addPayee(terry);
        address lookalike = _lookalikeOf(terry);
        vm.prank(alice);
        uint256 id = router.send(address(token), lookalike, AMT);

        // attacker cannot claim during the 24h lock
        vm.prank(lookalike);
        vm.expectRevert(SafeSend.Locked.selector);
        router.claim(id);

        vm.prank(alice);
        router.cancel(id);
        assertEq(token.balanceOf(alice), 100_000e6);
        assertEq(token.balanceOf(lookalike), 0);
    }

    // ---------- lookalike approval gate ----------

    function _lookalikeEscrow() internal returns (uint256 id, address lookalike) {
        vm.prank(alice);
        router.addPayee(terry);
        lookalike = _lookalikeOf(terry);
        vm.prank(alice);
        id = router.send(address(token), lookalike, AMT);
    }

    function test_lookalikeClaim_atUnlock_revertsWithoutApproval() public {
        (uint256 id, address lookalike) = _lookalikeEscrow();
        vm.warp(block.timestamp + 24 hours);
        vm.prank(lookalike);
        vm.expectRevert(SafeSend.NotApproved.selector);
        router.claim(id);
    }

    function test_lookalikeClaim_farAfterUnlock_revertsWithoutApproval() public {
        // time alone never unlocks a flagged recipient — approval is required
        (uint256 id, address lookalike) = _lookalikeEscrow();
        vm.warp(block.timestamp + 24 hours + 29 days);
        vm.prank(lookalike);
        vm.expectRevert(SafeSend.NotApproved.selector);
        router.claim(id);
        assertFalse(router.lookalikeApproved(id));
    }

    function test_approveLookalike_byRecipient_revertsSelfApprove() public {
        (uint256 id, address lookalike) = _lookalikeEscrow();
        vm.prank(lookalike);
        vm.expectRevert(SafeSend.NotSender.selector);
        router.approveLookalike(id);
    }

    function test_approveLookalike_byThirdParty_reverts() public {
        (uint256 id,) = _lookalikeEscrow();
        vm.prank(attacker);
        vm.expectRevert(SafeSend.NotSender.selector);
        router.approveLookalike(id);
    }

    function test_approveLookalike_unknownEscrow_reverts() public {
        vm.prank(alice);
        vm.expectRevert(SafeSend.NotSender.selector);
        router.approveLookalike(999);
    }

    function test_approveLookalike_unknownPayeeEscrow_revertsNotLookalike() public {
        uint256 id = _escrowTo(bob, AMT);
        vm.prank(alice);
        vm.expectRevert(SafeSend.NotLookalike.selector);
        router.approveLookalike(id);
    }

    function test_approveLookalike_afterCancel_revertsNotPending() public {
        (uint256 id,) = _lookalikeEscrow();
        vm.prank(alice);
        router.cancel(id);
        vm.prank(alice);
        vm.expectRevert(SafeSend.NotPending.selector);
        router.approveLookalike(id);
    }

    function test_approveLookalike_emitsEvent() public {
        (uint256 id,) = _lookalikeEscrow();
        vm.prank(alice);
        vm.expectEmit(true, false, false, false);
        emit SafeSend.LookalikeApproved(id);
        router.approveLookalike(id);
        assertTrue(router.lookalikeApproved(id));
    }

    function test_approveThenClaim_afterUnlock_paysAndVerifies() public {
        // legitimate flagged recipient: sender confirms out-of-band, approves,
        // recipient claims after the 24h lock and becomes verified
        (uint256 id, address lookalike) = _lookalikeEscrow();
        vm.prank(alice);
        router.approveLookalike(id);

        // still locked during the 24h window even with approval
        vm.prank(lookalike);
        vm.expectRevert(SafeSend.Locked.selector);
        router.claim(id);

        vm.warp(block.timestamp + 24 hours);
        vm.prank(lookalike);
        router.claim(id);
        assertEq(token.balanceOf(lookalike), AMT);
        assertTrue(router.verified(alice, lookalike));
    }

    function test_cancel_afterApproval_stillRefunds() public {
        // approval is not consent to release — the sender can still pull funds back
        (uint256 id, address lookalike) = _lookalikeEscrow();
        vm.prank(alice);
        router.approveLookalike(id);
        vm.warp(block.timestamp + 24 hours);
        vm.prank(alice);
        router.cancel(id);
        assertEq(token.balanceOf(alice), 100_000e6);
        assertEq(token.balanceOf(lookalike), 0);
    }

    function test_unknownPayeeClaim_onSchedule_needsNoApproval() public {
        // regression guard: the gate applies only to LookalikeOfVerified
        uint256 id = _escrowTo(bob, AMT);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(bob);
        router.claim(id);
        assertEq(token.balanceOf(bob), AMT);
        assertTrue(router.verified(alice, bob));
    }

    // ---------- reclaim ----------

    function test_reclaim_beforeWindow_reverts() public {
        uint256 id = _escrowTo(bob, AMT);
        vm.warp(block.timestamp + 1 hours + 29 days);
        vm.prank(alice);
        vm.expectRevert(SafeSend.TooEarly.selector);
        router.reclaim(id);
    }

    function test_reclaim_after30Days_refunds() public {
        uint256 id = _escrowTo(bob, AMT);
        vm.warp(block.timestamp + 1 hours + 30 days);
        vm.prank(alice);
        router.reclaim(id);
        assertEq(token.balanceOf(alice), 100_000e6);
    }

    function test_reclaim_byNonSender_reverts() public {
        uint256 id = _escrowTo(bob, AMT);
        vm.warp(block.timestamp + 31 days);
        vm.prank(attacker);
        vm.expectRevert(SafeSend.NotSender.selector);
        router.reclaim(id);
    }

    // ---------- payee book ----------

    function test_addPayee_marksVerifiedAndBumpsFingerprint() public {
        vm.prank(alice);
        vm.expectEmit(true, true, false, false);
        emit SafeSend.PayeeVerified(alice, terry);
        router.addPayee(terry);

        assertTrue(router.verified(alice, terry));
        assertEq(router.fpCount(alice, router.fingerprint(terry)), 1);
    }

    function test_addPayee_idempotent() public {
        vm.startPrank(alice);
        router.addPayee(terry);
        router.addPayee(terry);
        vm.stopPrank();
        assertEq(router.fpCount(alice, router.fingerprint(terry)), 1);
    }

    function test_removePayee_decrementsFingerprint() public {
        vm.startPrank(alice);
        router.addPayee(terry);
        vm.expectEmit(true, true, false, false);
        emit SafeSend.PayeeRemoved(alice, terry);
        router.removePayee(terry);
        vm.stopPrank();

        assertFalse(router.verified(alice, terry));
        assertEq(router.fpCount(alice, router.fingerprint(terry)), 0);
    }

    function test_removePayee_notVerified_isNoop() public {
        vm.prank(alice);
        router.removePayee(terry);
        assertEq(router.fpCount(alice, router.fingerprint(terry)), 0);
    }

    function test_payeeBooks_arePerSender() public {
        vm.prank(alice);
        router.addPayee(terry);
        assertTrue(router.verified(alice, terry));
        assertFalse(router.verified(bob, terry));
        assertFalse(router.isLookalike(bob, terry));
    }

    // ---------- cooldown ----------

    function test_setCooldown_bounds() public {
        vm.prank(alice);
        router.setCooldown(60);
        assertEq(router.getCooldown(alice), 60);

        vm.prank(alice);
        router.setCooldown(7 days);
        assertEq(router.getCooldown(alice), 7 days);
    }

    function test_setCooldown_outOfRange_reverts() public {
        vm.prank(alice);
        vm.expectRevert(SafeSend.CooldownOutOfRange.selector);
        router.setCooldown(59);
        vm.prank(alice);
        vm.expectRevert(SafeSend.CooldownOutOfRange.selector);
        router.setCooldown(7 days + 1);
    }

    function test_getCooldown_default() public view {
        assertEq(router.getCooldown(alice), 1 hours);
    }

    // ---------- helpers ----------

    /// @dev flips one middle bit: guaranteed different address, identical fingerprint
    function _lookalikeOf(address a) internal pure returns (address) {
        return address(uint160(uint160(a) ^ (uint160(1) << 80)));
    }
}
