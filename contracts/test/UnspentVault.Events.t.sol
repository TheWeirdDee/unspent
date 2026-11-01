// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {UnspentVault} from "../UnspentVault.sol";
import {UnspentVaultTestBase} from "./UnspentVault.Base.t.sol";

/// (9) exact event args for every state-changing function, plus provider-registry behaviour.
contract UnspentVaultEventsTest is UnspentVaultTestBase {
    uint256 internal constant AMT = 3_000_000;

    // ------------------------------------------------------------ registry
    function test_RegisterProvider_EmitsAndStores() public {
        address newPayout = makeAddr("newProviderPayout");
        bytes32 meta = keccak256("m2");
        uint256 expectedId = vault.nextProviderId();
        vm.expectEmit(true, true, false, true, address(vault));
        emit UnspentVault.ProviderRegistered(expectedId, bob, newPayout, meta);
        vm.prank(bob);
        uint256 id = vault.registerProvider(newPayout, meta);
        assertEq(id, expectedId);
        assertEq(vault.nextProviderId(), expectedId + 1);
        UnspentVault.Provider memory p = vault.getProvider(id);
        assertEq(p.owner, bob);
        assertEq(p.payoutWallet, newPayout);
        assertEq(p.payoutVersion, 1);
        assertTrue(p.active);
        assertEq(p.metadataHash, meta);
    }

    function test_RegisterProvider_IdsAreSequentialAndOwnersIndependent() public view {
        assertEq(pid, 1);
        assertEq(pidB, 2);
        assertEq(vault.getProvider(pid).owner, providerOwner);
        assertEq(vault.getProvider(pidB).owner, providerOwner2);
    }

    function test_RevertWhen_RegisterZeroPayout() public {
        vm.expectRevert(UnspentVault.ZeroAddress.selector);
        vault.registerProvider(address(0), META);
    }

    function test_UpdateProviderPayout_EmitsAndBumpsVersion() public {
        address np = makeAddr("np");
        vm.expectEmit(true, false, false, true, address(vault));
        emit UnspentVault.ProviderPayoutUpdated(pid, payout, np, 2);
        vm.prank(providerOwner);
        vault.updateProviderPayout(pid, np);
        assertEq(vault.getProvider(pid).payoutWallet, np);
        assertEq(vault.getProvider(pid).payoutVersion, 2);
        vm.expectEmit(true, false, false, true, address(vault));
        emit UnspentVault.ProviderPayoutUpdated(pid, np, payout, 3);
        vm.prank(providerOwner);
        vault.updateProviderPayout(pid, payout);
        assertEq(vault.getProvider(pid).payoutVersion, 3);
    }

    function test_UpdateProviderPayout_AccessControlAndZero() public {
        vm.prank(bob);
        vm.expectRevert(UnspentVault.NotProviderOwner.selector);
        vault.updateProviderPayout(pid, bob);
        vm.prank(providerOwner);
        vm.expectRevert(UnspentVault.NotProviderOwner.selector);
        vault.updateProviderPayout(pidB, bob); // owner of A cannot touch B
        vm.prank(providerOwner);
        vm.expectRevert(UnspentVault.ZeroAddress.selector);
        vault.updateProviderPayout(pid, address(0));
        vm.prank(providerOwner);
        vm.expectRevert(UnspentVault.ProviderNotFound.selector);
        vault.updateProviderPayout(77, bob);
    }

    function test_SetProviderActive_EmitsAndToggles() public {
        vm.expectEmit(true, false, false, true, address(vault));
        emit UnspentVault.ProviderStatusChanged(pid, false);
        vm.prank(providerOwner);
        vault.setProviderActive(pid, false);
        assertFalse(vault.getProvider(pid).active);
        vm.expectEmit(true, false, false, true, address(vault));
        emit UnspentVault.ProviderStatusChanged(pid, true);
        vm.prank(providerOwner);
        vault.setProviderActive(pid, true);
        assertTrue(vault.getProvider(pid).active);
    }

    function test_SetProviderActive_AccessControl() public {
        vm.prank(bob);
        vm.expectRevert(UnspentVault.NotProviderOwner.selector);
        vault.setProviderActive(pid, false);
        vm.prank(providerOwner);
        vm.expectRevert(UnspentVault.ProviderNotFound.selector);
        vault.setProviderActive(77, false);
        assertTrue(vault.getProvider(pid).active);
    }

    function test_GetProvider_AbsentIdIsZeroStruct() public view {
        UnspentVault.Provider memory p = vault.getProvider(999);
        assertEq(p.owner, address(0));
        assertEq(p.payoutWallet, address(0));
        assertEq(p.payoutVersion, 0);
        assertFalse(p.active);
    }

    function test_Constructor_ZeroTokenReverts() public {
        vm.expectRevert(UnspentVault.ZeroAddress.selector);
        new UnspentVault(IERC20(address(0)));
    }

    function test_Constructor_StoresTokenAndNoOwnerSurface() public view {
        assertEq(address(vault.usdc()), address(usdc));
        assertEq(vault.nextProviderId(), 3);
        assertEq(vault.nextReservationId(), 1);
        assertEq(vault.MAX_RESERVATION_DURATION(), 1 days);
    }

    // ------------------------------------------------------------ money events
    function test_Deposit_EmitsCreditsDeposited() public {
        usdc.mint(alice, AMT);
        vm.startPrank(alice);
        usdc.approve(address(vault), AMT);
        vm.expectEmit(true, true, false, true, address(vault));
        emit UnspentVault.CreditsDeposited(pid, alice, AMT);
        vault.deposit(pid, AMT);
        vm.stopPrank();
    }

    function test_Reserve_EmitsUsageReserved() public {
        _deposit(alice, pid, FUND);
        UnspentVault.ReserveAuthorisation memory a = _auth(1, AMT);
        bytes memory sig = _sigReserve(ALICE_PK, a);
        vm.expectEmit(true, true, true, true, address(vault));
        emit UnspentVault.UsageReserved(1, pid, alice, AMT, EXPIRY, a.requestHash);
        vm.prank(relayer);
        vault.reserveWithSignature(a, sig);
    }

    function test_AcceptAndSettle_EmitsUsageSettled() public {
        _deposit(alice, pid, FUND);
        uint256 id = _reserveN(1, AMT);
        UnspentVault.DeliveryAcceptance memory c = _acc(id, 1_000_000, 1);
        bytes memory sig = _sigAccept(ALICE_PK, c);
        vm.expectEmit(true, true, true, true, address(vault));
        emit UnspentVault.UsageSettled(id, pid, alice, 1_000_000, RESP, payout);
        vm.prank(relayer);
        vault.acceptAndSettle(c, sig);
    }

    function test_SettleDirect_EmitsUsageSettled() public {
        _deposit(alice, pid, FUND);
        uint256 id = _reserveN(1, AMT);
        vm.expectEmit(true, true, true, true, address(vault));
        emit UnspentVault.UsageSettled(id, pid, alice, AMT, RESP2, payout);
        vm.prank(alice);
        vault.settleDirect(id, RESP2, AMT);
    }

    function test_ReleaseExpired_EmitsReservationReleased() public {
        _deposit(alice, pid, FUND);
        uint256 id = _reserveN(1, AMT);
        vm.warp(EXPIRY);
        vm.expectEmit(true, true, true, true, address(vault));
        emit UnspentVault.ReservationReleased(id, pid, alice, AMT);
        vm.prank(relayer);
        vault.releaseExpired(id);
    }

    function test_Refund_EmitsCreditsRefunded() public {
        _deposit(alice, pid, FUND);
        vm.expectEmit(true, true, false, true, address(vault));
        emit UnspentVault.CreditsRefunded(pid, alice, 1_234_567);
        vm.prank(alice);
        vault.refund(pid, 1_234_567);
    }
}
