// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockUSDT — 6-decimal ERC-20 demo asset for SafeSend
/// @notice UNAUDITED TESTNET PROTOTYPE. Public mint — demo asset only, zero real value.
/// Mirrors USDT's 6 decimals and zero-allowance `transferFrom(x, y, 0)` behavior,
/// which is the mechanism real address-poisoning campaigns use.
contract MockUSDT is ERC20 {
    constructor() ERC20("Mock Tether", "mUSDT") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Open mint — this is a demo asset on a disposable chain
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
