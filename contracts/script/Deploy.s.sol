// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {SafeSend} from "../src/SafeSend.sol";
import {MockUSDT} from "../src/MockUSDT.sol";
import {Poisoner} from "../src/demo/Poisoner.sol";

/// @notice Deploys SafeSend + MockUSDT + Poisoner and writes addresses to
/// web/src/deployments/<chainId>.json so the web app picks them up.
contract Deploy is Script {
    function run() external {
        vm.startBroadcast();

        SafeSend safeSend = new SafeSend();
        MockUSDT token = new MockUSDT();
        Poisoner poisoner = new Poisoner();

        vm.stopBroadcast();

        console.log("SafeSend:", address(safeSend));
        console.log("MockUSDT:", address(token));
        console.log("Poisoner:", address(poisoner));

        string memory obj = "deployments";
        vm.serializeAddress(obj, "safeSend", address(safeSend));
        vm.serializeAddress(obj, "mockUSDT", address(token));
        vm.serializeAddress(obj, "poisoner", address(poisoner));
        string memory json = vm.serializeUint(obj, "chainId", block.chainid);

        string memory path = string.concat("../web/src/deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);
        console.log("wrote", path);
    }
}
