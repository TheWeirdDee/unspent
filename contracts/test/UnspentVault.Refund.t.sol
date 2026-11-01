// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {UnspentVault} from "../UnspentVault.sol";
import {UnspentVaultTestBase} from "./UnspentVault.Base.t.sol";

/// (6) refund rules.
contract UnspentVaultRefundTest is UnspentVaultTestBase {
    function setUp() public override {
        super.setUp();
        _deposit(alice, pid, FUND);
    }

    function test_Refund_FullAvailableGoesToCaller() public {
        vm.prank(alice);
        vault.refund(pid, FUND);
        assertEq(usdc.balanceOf(alice), FUND);
        assertEq(usdc.balanceOf(address(vault)), 0);
        assertEq(_avail(pid, alice), 0);
        assertEq(_refunded(pid, alice), FUND);
        assertEq(vault.totalOutstandingLiability(), 0);
        assertEq(vault.providerOutstanding(pid), 0);
        _assertAccountIdentity(pid, alice);
    }

    function test_Refund_PartialThenRest() public {
        vm.startPrank(alice);
        vault.refund(pid, 1);
        vault.refund(pid, FUND - 1);
        vm.stopPrank();
        assertEq(usdc.balanceOf(alice), FUND);
        assertEq(_refunded(pid, alice), FUND);
    }

    function test_Refund_GoesToMsgSenderNotAnyoneElse() public {
        _deposit(bob, pid, 2_000_000);
        vm.prank(bob);
        vault.refund(pid, 500_000);
        assertEq(usdc.balanceOf(bob), 500_000);
        assertEq(usdc.balanceOf(alice), 0);
        assertEq(_avail(pid, alice), FUND);
        assertEq(_avail(pid, bob), 1_500_000);
    }

    function test_RevertWhen_RefundExceedsAvailable() public {
        vm.prank(alice);
        vm.expectRevert(UnspentVault.InsufficientAvailable.selector);
        vault.refund(pid, FUND + 1);
        assertEq(_avail(pid, alice), FUND);
        assertEq(usdc.balanceOf(alice), 0);
    }

    function test_RevertWhen_DoubleRefund() public {
        vm.startPrank(alice);
        vault.refund(pid, FUND);
        vm.expectRevert(UnspentVault.InsufficientAvailable.selector);
        vault.refund(pid, FUND);
        vm.expectRevert(UnspentVault.InsufficientAvailable.selector);
        vault.refund(pid, 1);
        vm.stopPrank();
        assertEq(usdc.balanceOf(alice), FUND);
    }

    function test_RevertWhen_RefundZero() public {
        vm.prank(alice);
        vm.expectRevert(UnspentVault.ZeroAmount.selector);
        vault.refund(pid, 0);
    }

    function test_RevertWhen_NonDepositorOrProviderRefunds() public {
        vm.prank(bob);
        vm.expectRevert(UnspentVault.InsufficientAvailable.selector);
        vault.refund(pid, 1);
        vm.prank(providerOwner);
        vm.expectRevert(UnspentVault.InsufficientAvailable.selector);
        vault.refund(pid, 1);
        vm.prank(payout);
        vm.expectRevert(UnspentVault.InsufficientAvailable.selector);
        vault.refund(pid, 1);
        assertEq(_avail(pid, alice), FUND);
    }

    function test_RevertWhen_RefundFromOtherProviderAccount() public {
        vm.prank(alice);
        vm.expectRevert(UnspentVault.InsufficientAvailable.selector);
        vault.refund(pidB, 1);
        vm.prank(alice);
        vm.expectRevert(UnspentVault.InsufficientAvailable.selector);
        vault.refund(12345, 1);
    }

    function test_Refund_CannotTakeReservedFunds() public {
        _reserveN(1, 4_000_000);
        vm.prank(alice);
        vm.expectRevert(UnspentVault.InsufficientAvailable.selector);
        vault.refund(pid, FUND); // would dip into reserved
        vm.prank(alice);
        vm.expectRevert(UnspentVault.InsufficientAvailable.selector);
        vault.refund(pid, FUND - 4_000_000 + 1);
    }

    function test_Refund_WhileReservationInFlight_LeavesReservedIntact() public {
        uint256 id = _reserveN(1, 4_000_000);
        vm.prank(alice);
        vault.refund(pid, 6_000_000);
        assertEq(_resv(pid, alice), 4_000_000);
        assertEq(_avail(pid, alice), 0);
        assertEq(vault.totalOutstandingLiability(), 4_000_000);
        assertEq(usdc.balanceOf(address(vault)), 4_000_000);
        assertEq(_status(id), uint8(UnspentVault.ReservationStatus.Reserved));
        // reservation can still settle in full afterwards
        vm.prank(alice);
        vault.settleDirect(id, RESP, 4_000_000);
        assertEq(usdc.balanceOf(payout), 4_000_000);
        assertEq(usdc.balanceOf(address(vault)), 0);
        _assertAccountIdentity(pid, alice);
    }

    function test_Race_ReserveAllAvailableThenRefundReverts() public {
        _reserveN(1, FUND);
        vm.prank(alice);
        vm.expectRevert(UnspentVault.InsufficientAvailable.selector);
        vault.refund(pid, 1);
    }

    function test_Race_RefundThenReserveReverts() public {
        vm.prank(alice);
        vault.refund(pid, 1);
        UnspentVault.ReserveAuthorisation memory a = _auth(1, FUND);
        bytes memory sig = _sigReserve(ALICE_PK, a);
        _reserveExpectRevert(a, sig, UnspentVault.InsufficientAvailable.selector);
        assertEq(_resv(pid, alice), 0);
    }

    function test_Refund_AfterReleaseOfExpiredReservation() public {
        uint256 id = _reserveN(1, 4_000_000);
        vm.prank(alice);
        vault.refund(pid, 6_000_000);
        vm.warp(EXPIRY);
        vault.releaseExpired(id);
        vm.prank(alice);
        vault.refund(pid, 4_000_000);
        assertEq(usdc.balanceOf(alice), FUND);
        assertEq(vault.totalOutstandingLiability(), 0);
    }

    function test_Refund_PartialSettlementRemainderIsRefundable() public {
        uint256 id = _reserveN(1, 4_000_000);
        vm.prank(alice);
        vault.settleDirect(id, RESP, 1_000_000);
        vm.prank(alice);
        vault.refund(pid, FUND - 1_000_000);
        assertEq(usdc.balanceOf(alice), FUND - 1_000_000);
        assertEq(usdc.balanceOf(payout), 1_000_000);
        assertEq(usdc.balanceOf(address(vault)), 0);
        assertEq(vault.totalOutstandingLiability(), 0);
        _assertAccountIdentity(pid, alice);
    }

    function test_Refund_SettledFundsCannotBeRefunded() public {
        uint256 id = _reserveN(1, FUND);
        vm.prank(alice);
        vault.settleDirect(id, RESP, FUND);
        vm.prank(alice);
        vm.expectRevert(UnspentVault.InsufficientAvailable.selector);
        vault.refund(pid, 1);
    }
}
