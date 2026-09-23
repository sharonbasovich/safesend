// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SafeSend} from "../src/SafeSend.sol";
import {MockUSDT} from "../src/MockUSDT.sol";

contract SafeSendFuzzTest is Test {
    SafeSend internal router;
    MockUSDT internal token;

    address internal alice = makeAddr("alice");

    function setUp() public {
        router = new SafeSend();
        token = new MockUSDT();
        token.mint(alice, type(uint96).max);
        vm.deal(alice, type(uint96).max);
        vm.prank(alice);
        token.approve(address(router), type(uint256).max);
    }

    /// isLookalike is exactly: not verified AND fingerprint collision with a verified payee
    function testFuzz_isLookalike_iffFingerprintMatchAndNotVerified(address payee, address to) public {
        vm.assume(payee != to && payee != address(0) && to != address(0));

        vm.prank(alice);
        router.addPayee(payee);

        bool fpMatch = router.fingerprint(payee) == router.fingerprint(to);
        assertEq(router.isLookalike(alice, to), fpMatch);

        // a verified `to` is never a lookalike
        vm.prank(alice);
        router.addPayee(to);
        assertFalse(router.isLookalike(alice, to));
    }

    /// fingerprint is pure bit-slicing: same fp iff same top16 and low16 bits
    function testFuzz_fingerprint_isTop16PlusLow16(address a) public view {
        uint32 fp = router.fingerprint(a);
        assertEq(fp >> 16, uint160(a) >> 144);
        assertEq(fp & 0xffff, uint160(a) & 0xffff);
    }

    /// any uint128 amount escrowed ends up entirely under contract custody
    function testFuzz_send_escrowsFullAmount(address to, uint128 amount) public {
        vm.assume(to != address(0) && to != alice && amount > 0);
        vm.assume(to != address(router)); // don't send to the router itself
        vm.assume(uint160(to) > 0x1000); // skip precompiles/foundry cheatcode addresses
        uint128 amt = uint128(bound(amount, 1, type(uint96).max));

        vm.prank(alice);
        uint256 id = router.send(address(token), to, amt);
        assertEq(token.balanceOf(address(router)), amt);

        (,, address tTo, uint128 tAmt,, SafeSend.Status status,) = router.transfers(id);
        assertEq(tTo, to);
        assertEq(tAmt, amt);
        assertEq(uint8(status), uint8(SafeSend.Status.Pending));
    }

    /// claim always pays the full escrowed amount to the recipient
    function testFuzz_claim_paysRecipient(address to, uint96 amount) public {
        vm.assume(to != address(0) && to != alice && amount > 0);
        vm.assume(uint160(to) > 0x1000 && to.code.length == 0);
        vm.assume(to != address(router));

        vm.prank(alice);
        uint256 id = router.send(address(token), to, amount);

        (,,,, uint64 unlockAt,,) = router.transfers(id);
        vm.warp(unlockAt);
        vm.prank(to);
        router.claim(id);
        assertEq(token.balanceOf(to), amount);
        assertEq(token.balanceOf(address(router)), 0);
        assertTrue(router.verified(alice, to));
    }

    /// cooldown bounds: [60s, 7d] accepted, anything else reverts
    function testFuzz_setCooldown_bounds(uint64 s) public {
        vm.prank(alice);
        if (s < 60 || s > 7 days) {
            vm.expectRevert(SafeSend.CooldownOutOfRange.selector);
            router.setCooldown(s);
        } else {
            router.setCooldown(s);
            assertEq(router.getCooldown(alice), s);
        }
    }
}
