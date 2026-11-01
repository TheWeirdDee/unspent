// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {UnspentVault} from "../UnspentVault.sol";
import {UnspentVaultTestBase} from "./UnspentVault.Base.t.sol";
import {FeeOnTransferToken} from "./mocks/FeeOnTransferToken.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {ToggleToken} from "./mocks/ToggleToken.sol";

contract UnspentVaultDepositTest is UnspentVaultTestBase {
    // (1) deposit credits exact amount atomically
    function test_Deposit_CreditsExactAmountAndRaisesLiability() public {
        usdc.mint(alice, 5_000_000);
        vm.startPrank(alice);
        usdc.approve(address(vault), 5_000_000);
        vault.deposit(pid, 3_000_000);
        vm.stopPrank();

        (uint256 a, uint256 r, uint256 d, uint256 s, uint256 f) = vault.getAccount(pid, alice);
        assertEq(a, 3_000_000);
        assertEq(r, 0);
        assertEq(d, 3_000_000);
        assertEq(s, 0);
        assertEq(f, 0);
        assertEq(vault.totalOutstandingLiability(), 3_000_000);
        assertEq(vault.providerOutstanding(pid), 3_000_000);
        assertEq(usdc.balanceOf(address(vault)), 3_000_000);
        assertEq(usdc.balanceOf(alice), 2_000_000);
        (uint256 bal, uint256 liab) = vault.solvency();
        assertEq(bal, liab);
    }

    function test_Deposit_AccumulatesAcrossDepositsAndIsProviderScoped() public {
        _deposit(alice, pid, 1_000_000);
        _deposit(alice, pid, 2_000_000);
        _deposit(alice, pidB, 700_000);
        _deposit(bob, pid, 5);
        assertEq(_avail(pid, alice), 3_000_000);
        assertEq(_avail(pidB, alice), 700_000);
        assertEq(_avail(pid, bob), 5);
        assertEq(_avail(pidB, bob), 0);
        assertEq(vault.providerOutstanding(pid), 3_000_005);
        assertEq(vault.providerOutstanding(pidB), 700_000);
        assertEq(vault.totalOutstandingLiability(), 3_700_005);
        assertEq(usdc.balanceOf(address(vault)), 3_700_005);
    }

    function test_Deposit_OneMicroUnit() public {
        _deposit(alice, pid, 1);
        assertEq(_avail(pid, alice), 1);
        assertEq(vault.totalOutstandingLiability(), 1);
    }

    function test_Deposit_ZeroAmountReverts() public {
        vm.prank(alice);
        vm.expectRevert(UnspentVault.ZeroAmount.selector);
        vault.deposit(pid, 0);
    }

    function test_Deposit_InsufficientAllowance_CreatesNoCredit() public {
        usdc.mint(alice, 1_000_000);
        vm.startPrank(alice);
        usdc.approve(address(vault), 999_999);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(vault), 999_999, 1_000_000)
        );
        vault.deposit(pid, 1_000_000);
        vm.stopPrank();
        _assertNoCredit();
        assertEq(usdc.balanceOf(alice), 1_000_000);
    }

    function test_Deposit_InsufficientBalance_CreatesNoCredit() public {
        usdc.mint(alice, 999_999);
        vm.startPrank(alice);
        usdc.approve(address(vault), 1_000_000);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, alice, 999_999, 1_000_000));
        vault.deposit(pid, 1_000_000);
        vm.stopPrank();
        _assertNoCredit();
    }

    function test_Deposit_FeeOnTransferToken_Rejected() public {
        FeeOnTransferToken ft = new FeeOnTransferToken();
        UnspentVault v = new UnspentVault(IERC20(address(ft)));
        vm.prank(providerOwner);
        uint256 p = v.registerProvider(payout, META);
        ft.mint(alice, 1_000_000);
        vm.startPrank(alice);
        ft.approve(address(v), 1_000_000);
        vm.expectRevert(UnspentVault.TransferAmountMismatch.selector);
        v.deposit(p, 1_000_000);
        vm.stopPrank();
        (uint256 a,, uint256 d,,) = v.getAccount(p, alice);
        assertEq(a, 0);
        assertEq(d, 0);
        assertEq(v.totalOutstandingLiability(), 0);
        assertEq(ft.balanceOf(address(v)), 0);
        assertEq(ft.balanceOf(alice), 1_000_000);
    }

    function test_Deposit_FeeOnTransferToken_RejectedForTinyAmounts() public {
        FeeOnTransferToken ft = new FeeOnTransferToken();
        UnspentVault v = new UnspentVault(IERC20(address(ft)));
        vm.prank(providerOwner);
        uint256 p = v.registerProvider(payout, META);
        ft.mint(alice, 10);
        vm.startPrank(alice);
        ft.approve(address(v), 10);
        vm.expectRevert(UnspentVault.TransferAmountMismatch.selector);
        v.deposit(p, 1);
        vm.stopPrank();
        assertEq(v.totalOutstandingLiability(), 0);
    }

    function test_Deposit_TransferFromReturnsFalse_CreatesNoCredit() public {
        ToggleToken tt = new ToggleToken();
        UnspentVault v = new UnspentVault(IERC20(address(tt)));
        vm.prank(providerOwner);
        uint256 p = v.registerProvider(payout, META);
        tt.mint(alice, 1_000_000);
        tt.setTransferFromMode(true, false);
        vm.startPrank(alice);
        tt.approve(address(v), 1_000_000);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(tt)));
        v.deposit(p, 1_000_000);
        vm.stopPrank();
        assertEq(v.totalOutstandingLiability(), 0);
        (uint256 a,,,,) = v.getAccount(p, alice);
        assertEq(a, 0);
    }

    function test_Deposit_TransferFromReverts_CreatesNoCredit() public {
        ToggleToken tt = new ToggleToken();
        UnspentVault v = new UnspentVault(IERC20(address(tt)));
        vm.prank(providerOwner);
        uint256 p = v.registerProvider(payout, META);
        tt.mint(alice, 1_000_000);
        tt.setTransferFromMode(false, true);
        vm.startPrank(alice);
        tt.approve(address(v), 1_000_000);
        vm.expectRevert(bytes("ToggleToken: transferFrom reverted"));
        v.deposit(p, 1_000_000);
        vm.stopPrank();
        assertEq(v.totalOutstandingLiability(), 0);
        (uint256 a,,,,) = v.getAccount(p, alice);
        assertEq(a, 0);
    }

    function test_Deposit_UnregisteredProviderReverts() public {
        usdc.mint(alice, 1_000_000);
        vm.startPrank(alice);
        usdc.approve(address(vault), 1_000_000);
        vm.expectRevert(UnspentVault.ProviderNotFound.selector);
        vault.deposit(999, 1_000_000);
        vm.expectRevert(UnspentVault.ProviderNotFound.selector);
        vault.deposit(0, 1_000_000);
        vm.stopPrank();
        assertEq(vault.totalOutstandingLiability(), 0);
        assertEq(usdc.balanceOf(alice), 1_000_000);
    }

    function test_Deposit_InactiveProviderReverts() public {
        vm.prank(providerOwner);
        vault.setProviderActive(pid, false);
        usdc.mint(alice, 1_000_000);
        vm.startPrank(alice);
        usdc.approve(address(vault), 1_000_000);
        vm.expectRevert(UnspentVault.ProviderInactive.selector);
        vault.deposit(pid, 1_000_000);
        vm.stopPrank();
        _assertNoCredit();
    }

    function test_Deposit_AllowedAgainAfterReactivation() public {
        vm.startPrank(providerOwner);
        vault.setProviderActive(pid, false);
        vault.setProviderActive(pid, true);
        vm.stopPrank();
        _deposit(alice, pid, 1_000_000);
        assertEq(_avail(pid, alice), 1_000_000);
    }

    function test_Refund_StillAllowedAfterProviderDeactivation() public {
        _deposit(alice, pid, 4_000_000);
        vm.prank(providerOwner);
        vault.setProviderActive(pid, false);
        vm.prank(alice);
        vault.refund(pid, 4_000_000);
        assertEq(usdc.balanceOf(alice), 4_000_000);
        assertEq(_avail(pid, alice), 0);
        assertEq(vault.totalOutstandingLiability(), 0);
    }

    function test_Deposit_ProviderOwnerCannotTouchCustomerCredit() public {
        _deposit(alice, pid, 4_000_000);
        vm.startPrank(providerOwner);
        vault.setProviderActive(pid, false);
        vault.updateProviderPayout(pid, makeAddr("x"));
        vm.stopPrank();
        assertEq(_avail(pid, alice), 4_000_000);
    }

    function _assertNoCredit() internal view {
        (uint256 a, uint256 r, uint256 d,,) = vault.getAccount(pid, alice);
        assertEq(a, 0);
        assertEq(r, 0);
        assertEq(d, 0);
        assertEq(vault.totalOutstandingLiability(), 0);
        assertEq(vault.providerOutstanding(pid), 0);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }
}
