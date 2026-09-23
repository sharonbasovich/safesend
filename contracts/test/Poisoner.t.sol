// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SafeSend} from "../src/SafeSend.sol";
import {MockUSDT} from "../src/MockUSDT.sol";
import {Poisoner} from "../src/demo/Poisoner.sol";

/// @notice Reproduces the real address-poisoning mechanism and proves the
/// baseline loss that SafeSend exists to prevent.
contract PoisonerTest is Test {
    SafeSend internal router;
    MockUSDT internal token;
    Poisoner internal poisoner;

    address internal victim = makeAddr("victim");
    address internal terry = makeAddr("terry");
    address internal attacker = makeAddr("attacker");

    function setUp() public {
        router = new SafeSend();
        token = new MockUSDT();
        poisoner = new Poisoner();

        token.mint(victim, 10_000e6);
        token.mint(attacker, 10_000e6);
        vm.deal(victim, 10 ether);
        vm.deal(attacker, 1 ether);
        vm.prank(victim);
        token.approve(address(router), type(uint256).max);
    }

    /// The real attack primitive: zero-value transferFrom succeeds with zero
    /// allowance and emits Transfer(victim -> lookalike), inserting the
    /// lookalike into the victim's outgoing history.
    function test_poison_zeroValueTransferFrom_needsNoAllowance() public {
        address lookalike = _lookalikeOf(terry);

        assertEq(token.allowance(victim, address(poisoner)), 0);

        vm.prank(attacker);
        vm.expectEmit(true, true, false, true, address(token));
        emit Transfer(victim, lookalike, 0);
        bool ok = poisoner.poison(token, victim, lookalike);

        assertTrue(ok);
        // no value moved — the damage is purely in the victim's history
        assertEq(token.balanceOf(lookalike), 0);
        assertEq(token.balanceOf(victim), 10_000e6);
    }

    /// dust(): the lookalike sends a tiny real amount so it appears in the
    /// victim's *incoming* history (attacker controls the lookalike key).
    function test_dust_insertsLookalikeIntoIncomingHistory() public {
        address lookalike = _lookalikeOf(terry);
        token.mint(lookalike, 1e6);

        vm.prank(lookalike);
        token.approve(address(poisoner), 1e6);
        vm.prank(attacker);
        poisoner.dust(token, lookalike, victim, 42);

        assertEq(token.balanceOf(victim), 10_000e6 + 42);
    }

    /// Baseline: a raw ERC-20 transfer to a lookalike is irreversible.
    /// There is no undo — the funds are simply gone.
    function test_baseline_rawTransferToLookalike_isFinal() public {
        address lookalike = _lookalikeOf(terry);

        vm.prank(victim);
        token.transfer(lookalike, 1_000e6);

        assertEq(token.balanceOf(lookalike), 1_000e6);
        assertEq(token.balanceOf(victim), 9_000e6);
        // there is no API to get it back — nothing to call
    }

    /// The same mistake routed through SafeSend is caught: quarantined 24h,
    /// flagged on-chain, cancellable — the lookalike gets nothing.
    function test_sameSend_viaSafeSend_isCaughtAndRefunded() public {
        vm.prank(victim);
        router.addPayee(terry);
        address lookalike = _lookalikeOf(terry);

        vm.prank(victim);
        uint256 id = router.send(address(token), lookalike, 1_000e6);

        // attacker waits for unlock — 24h — and still can't beat the sender's cancel
        vm.prank(lookalike);
        vm.expectRevert(SafeSend.Locked.selector);
        router.claim(id);

        vm.prank(victim);
        router.cancel(id);
        assertEq(token.balanceOf(lookalike), 0);
        assertEq(token.balanceOf(victim), 10_000e6);
    }

    /// Even after the 24h lock expires, a lookalike CAN claim — the window and
    /// the flag are the defense, not a permanent block. State this honestly.
    function test_lookalike_canClaimAfter24h_ifSenderNeverCancels() public {
        vm.prank(victim);
        router.addPayee(terry);
        address lookalike = _lookalikeOf(terry);

        vm.prank(victim);
        uint256 id = router.send(address(token), lookalike, 1_000e6);

        vm.warp(block.timestamp + 24 hours);
        vm.prank(lookalike);
        router.claim(id);
        assertEq(token.balanceOf(lookalike), 1_000e6);
    }

    function _lookalikeOf(address a) internal pure returns (address) {
        return address(uint160(uint160(a) ^ (uint160(1) << 80)));
    }

    event Transfer(address indexed from, address indexed to, uint256 value);
}
