// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {UnspentVaultTestBase} from "./UnspentVault.Base.t.sol";
import {UnspentVault} from "../UnspentVault.sol";

/// Payout destinations that would burn or strand credit are rejected.
contract UnspentVaultPayoutTest is UnspentVaultTestBase {
    function test_RegisterRejectsVaultAsPayout() public {
        vm.prank(providerOwner);
        vm.expectRevert(UnspentVault.InvalidPayoutWallet.selector);
        vault.registerProvider(address(vault), META);
    }

    function test_RegisterRejectsTokenAsPayout() public {
        vm.prank(providerOwner);
        vm.expectRevert(UnspentVault.InvalidPayoutWallet.selector);
        vault.registerProvider(address(usdc), META);
    }

    function test_UpdateRejectsVaultAndTokenAsPayout() public {
        vm.startPrank(providerOwner);
        vm.expectRevert(UnspentVault.InvalidPayoutWallet.selector);
        vault.updateProviderPayout(pid, address(vault));
        vm.expectRevert(UnspentVault.InvalidPayoutWallet.selector);
        vault.updateProviderPayout(pid, address(usdc));
        vm.stopPrank();
    }

    function test_UpdateRejectsZero() public {
        vm.prank(providerOwner);
        vm.expectRevert(UnspentVault.ZeroAddress.selector);
        vault.updateProviderPayout(pid, address(0));
    }
}
