// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {UnspentVault} from "../UnspentVault.sol";
import {UnspentVaultTestBase} from "./UnspentVault.Base.t.sol";

/// (11) forced / unsolicited surplus never creates credit; plus the unit-scale documentation test.
contract UnspentVaultSurplusTest is UnspentVaultTestBase {
    function test_Surplus_DirectTokenTransferCreatesNoCredit() public {
        _deposit(alice, pid, 2_000_000);
        usdc.mint(bob, 777_000);
        vm.prank(bob);
        usdc.transfer(address(vault), 777_000);

        assertEq(usdc.balanceOf(address(vault)), 2_777_000);
        assertEq(vault.totalOutstandingLiability(), 2_000_000);
        assertEq(vault.providerOutstanding(pid), 2_000_000);
        assertEq(_avail(pid, bob), 0);
        assertEq(_deposited(pid, bob), 0);
        assertEq(_avail(pid, alice), 2_000_000);
        (uint256 bal, uint256 liab) = vault.solvency();
        assertEq(bal, 2_777_000);
        assertEq(liab, 2_000_000);
    }

    function test_Surplus_CannotBeRefundedOrReservedByDonor() public {
        usdc.mint(bob, 1_000_000);
        vm.prank(bob);
        usdc.transfer(address(vault), 1_000_000);
        vm.prank(bob);
        vm.expectRevert(UnspentVault.InsufficientAvailable.selector);
        vault.refund(pid, 1);
        vm.prank(providerOwner);
        vm.expectRevert(UnspentVault.InsufficientAvailable.selector);
        vault.refund(pid, 1);
        assertEq(vault.totalOutstandingLiability(), 0);
    }

    function test_Surplus_DoesNotInflateLaterDepositCredit() public {
        usdc.mint(address(vault), 123); // donation before the deposit
        _deposit(alice, pid, 1_000_000);
        assertEq(_avail(pid, alice), 1_000_000);
        assertEq(vault.totalOutstandingLiability(), 1_000_000);
        assertEq(usdc.balanceOf(address(vault)), 1_000_123);
    }

    function test_Surplus_DoesNotChangeSettleOrRefundAccounting() public {
        _deposit(alice, pid, 1_000_000);
        usdc.mint(address(vault), 500);
        vm.prank(alice);
        vault.refund(pid, 1_000_000);
        assertEq(vault.totalOutstandingLiability(), 0);
        assertEq(usdc.balanceOf(address(vault)), 500, "surplus is stuck, not swept");
        assertEq(usdc.balanceOf(alice), 1_000_000);
    }

    function test_Surplus_ForcedNativeSendCreatesNoCreditAndPlainSendReverts() public {
        _deposit(alice, pid, 1_000_000);
        vm.deal(address(vault), 3 ether); // forced send (selfdestruct-style) bypasses receive/fallback
        assertEq(vault.totalOutstandingLiability(), 1_000_000);
        assertEq(_avail(pid, alice), 1_000_000);
        (uint256 bal, uint256 liab) = vault.solvency();
        assertEq(bal, liab);

        vm.deal(bob, 1 ether);
        vm.prank(bob);
        (bool ok,) = address(vault).call{value: 1 ether}("");
        assertFalse(ok, "vault has no payable receive/fallback");
        vm.prank(bob);
        (ok,) = address(vault).call{value: 1 ether}(hex"12345678");
        assertFalse(ok, "vault has no payable fallback");
    }

    function test_Units_AmountsAreSixDecimalMicroUsdcNotEighteenDecimalNative() public {
        assertEq(usdc.decimals(), 6);
        uint256 tenCents = 100_000; // 0.10 USDC
        _deposit(alice, pid, tenCents);
        assertEq(_avail(pid, alice), tenCents);
        assertEq(usdc.balanceOf(address(vault)), tenCents);
        assertTrue(tenCents != 0.1 ether, "0.10 USDC is NOT 1e17");
        assertEq(10 ** uint256(usdc.decimals()), 1_000_000); // 1 USDC
    }
}
