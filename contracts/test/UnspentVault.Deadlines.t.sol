// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {UnspentVault} from "../UnspentVault.sol";
import {UnspentVaultTestBase} from "./UnspentVault.Base.t.sol";

/// (3) authorisation-deadline boundaries and (4) reservation-expiry boundaries.
contract UnspentVaultDeadlinesTest is UnspentVaultTestBase {
    uint256 internal constant AMT = 3_000_000;

    function setUp() public override {
        super.setUp();
        _deposit(alice, pid, FUND);
    }

    // ------------------------------------------------------------ (3) auth deadline
    function test_AuthDeadline_OneSecondBefore_Succeeds() public {
        vm.warp(AUTH_DEADLINE - 1);
        uint256 id = _reserveN(1, AMT);
        assertEq(_status(id), uint8(UnspentVault.ReservationStatus.Reserved));
    }

    function test_AuthDeadline_ExactlyAt_Succeeds() public {
        vm.warp(AUTH_DEADLINE);
        uint256 id = _reserveN(1, AMT);
        assertEq(_status(id), uint8(UnspentVault.ReservationStatus.Reserved));
    }

    function test_AuthDeadline_OneSecondAfter_Reverts() public {
        vm.warp(AUTH_DEADLINE + 1);
        UnspentVault.ReserveAuthorisation memory a = _auth(1, AMT);
        bytes memory sig = _sigReserve(ALICE_PK, a);
        _reserveExpectRevert(a, sig, UnspentVault.AuthorisationExpired.selector);
        assertEq(_resv(pid, alice), 0);
        assertFalse(vault.reserveNonceUsed(alice, 1));
    }

    function test_Expiry_NotAfterAuthDeadline_Reverts() public {
        UnspentVault.ReserveAuthorisation memory a = _auth(1, AMT);
        a.expiry = a.authDeadline; // equal
        bytes memory sig = _sigReserve(ALICE_PK, a);
        _reserveExpectRevert(a, sig, UnspentVault.InvalidExpiryRelationship.selector);
        a.expiry = a.authDeadline - 1; // below
        sig = _sigReserve(ALICE_PK, a);
        _reserveExpectRevert(a, sig, UnspentVault.InvalidExpiryRelationship.selector);
    }

    function test_Expiry_OneAfterAuthDeadline_Succeeds() public {
        UnspentVault.ReserveAuthorisation memory a = _auth(1, AMT);
        a.expiry = a.authDeadline + 1;
        uint256 id = _reserve(a);
        assertEq(vault.getReservation(id).expiry, a.authDeadline + 1);
    }

    function test_Expiry_ExactlyAtMaxDuration_Succeeds() public {
        UnspentVault.ReserveAuthorisation memory a = _auth(1, AMT);
        a.expiry = block.timestamp + vault.MAX_RESERVATION_DURATION();
        uint256 id = _reserve(a);
        assertEq(vault.getReservation(id).expiry, T0 + 1 days);
    }

    function test_Expiry_OneBeyondMaxDuration_RevertsExpiryTooFar() public {
        UnspentVault.ReserveAuthorisation memory a = _auth(1, AMT);
        a.expiry = block.timestamp + vault.MAX_RESERVATION_DURATION() + 1;
        bytes memory sig = _sigReserve(ALICE_PK, a);
        _reserveExpectRevert(a, sig, UnspentVault.ExpiryTooFar.selector);
        assertEq(_resv(pid, alice), 0);
    }

    function test_Expiry_MaxDurationIsMeasuredFromSubmissionTime() public {
        vm.warp(T0 + 1000);
        UnspentVault.ReserveAuthorisation memory a = _auth(1, AMT);
        a.expiry = T0 + 1 days + 1000; // exactly now + 1 day
        _reserve(a);
        a = _auth(2, AMT);
        a.expiry = T0 + 1 days + 1001;
        bytes memory sig = _sigReserve(ALICE_PK, a);
        _reserveExpectRevert(a, sig, UnspentVault.ExpiryTooFar.selector);
    }

    function test_Expiry_BeyondUint64Reverts() public {
        UnspentVault.ReserveAuthorisation memory a = _auth(1, AMT);
        a.authDeadline = type(uint256).max - 1;
        a.expiry = type(uint256).max;
        bytes memory sig = _sigReserve(ALICE_PK, a);
        _reserveExpectRevert(a, sig, UnspentVault.ExpiryTooFar.selector);
    }

    function test_AuthDeadlineFarInFuture_StillBoundedByExpiryCap() public {
        UnspentVault.ReserveAuthorisation memory a = _auth(1, AMT);
        a.authDeadline = T0 + 10 days;
        a.expiry = T0 + 10 days + 1;
        bytes memory sig = _sigReserve(ALICE_PK, a);
        _reserveExpectRevert(a, sig, UnspentVault.ExpiryTooFar.selector);
    }

    // ------------------------------------------------------------ (4) expiry + settlement
    function _open() internal returns (uint256 id) {
        id = _reserveN(1, AMT);
    }

    function _accLong(uint256 id, uint256 nonce) internal pure returns (UnspentVault.DeliveryAcceptance memory c) {
        c = _acc(id, AMT, nonce);
        c.deadline = EXPIRY + 100; // acceptance deadline never the binding constraint here
    }

    function test_AcceptAndSettle_OneSecondBeforeExpiry_Succeeds() public {
        uint256 id = _open();
        vm.warp(EXPIRY - 1);
        _accept(_accLong(id, 1));
        assertEq(_status(id), uint8(UnspentVault.ReservationStatus.Settled));
        assertEq(usdc.balanceOf(payout), AMT);
    }

    function test_AcceptAndSettle_AtExpiry_Reverts() public {
        uint256 id = _open();
        vm.warp(EXPIRY);
        UnspentVault.DeliveryAcceptance memory c = _accLong(id, 1);
        bytes memory sig = _sigAccept(ALICE_PK, c);
        _acceptExpectRevert(c, sig, UnspentVault.ReservationExpired.selector);
        assertEq(_status(id), uint8(UnspentVault.ReservationStatus.Reserved));
    }

    function test_AcceptAndSettle_OneSecondAfterExpiry_Reverts() public {
        uint256 id = _open();
        vm.warp(EXPIRY + 1);
        UnspentVault.DeliveryAcceptance memory c = _accLong(id, 1);
        bytes memory sig = _sigAccept(ALICE_PK, c);
        _acceptExpectRevert(c, sig, UnspentVault.ReservationExpired.selector);
    }

    function test_SettleDirect_OneSecondBeforeExpiry_Succeeds() public {
        uint256 id = _open();
        vm.warp(EXPIRY - 1);
        vm.prank(alice);
        vault.settleDirect(id, RESP, AMT);
        assertEq(_status(id), uint8(UnspentVault.ReservationStatus.Settled));
        assertEq(usdc.balanceOf(payout), AMT);
    }

    function test_SettleDirect_AtExpiry_Reverts() public {
        uint256 id = _open();
        vm.warp(EXPIRY);
        vm.prank(alice);
        vm.expectRevert(UnspentVault.ReservationExpired.selector);
        vault.settleDirect(id, RESP, AMT);
    }

    function test_SettleDirect_OneSecondAfterExpiry_Reverts() public {
        uint256 id = _open();
        vm.warp(EXPIRY + 1);
        vm.prank(alice);
        vm.expectRevert(UnspentVault.ReservationExpired.selector);
        vault.settleDirect(id, RESP, AMT);
    }

    function test_ReleaseExpired_OneSecondBeforeExpiry_Reverts() public {
        uint256 id = _open();
        vm.warp(EXPIRY - 1);
        vm.expectRevert(UnspentVault.ReservationNotExpired.selector);
        vault.releaseExpired(id);
        assertEq(_resv(pid, alice), AMT);
    }

    function test_ReleaseExpired_AtExpiry_Succeeds() public {
        uint256 id = _open();
        vm.warp(EXPIRY);
        vm.prank(relayer);
        vault.releaseExpired(id);
        assertEq(_status(id), uint8(UnspentVault.ReservationStatus.Released));
        assertEq(_resv(pid, alice), 0);
        assertEq(_avail(pid, alice), FUND);
        assertEq(vault.totalOutstandingLiability(), FUND);
        assertEq(usdc.balanceOf(address(vault)), FUND);
    }

    function test_ReleaseExpired_OneSecondAfterExpiry_Succeeds() public {
        uint256 id = _open();
        vm.warp(EXPIRY + 1);
        vault.releaseExpired(id);
        assertEq(_avail(pid, alice), FUND);
    }

    function test_ReleaseExpired_LongAfterExpiry_Succeeds() public {
        uint256 id = _open();
        vm.warp(EXPIRY + 365 days);
        vault.releaseExpired(id);
        assertEq(_avail(pid, alice), FUND);
    }

    function test_RevertWhen_SettleAfterRelease() public {
        uint256 id = _open();
        vm.warp(EXPIRY);
        vault.releaseExpired(id);
        vm.prank(alice);
        vm.expectRevert(UnspentVault.ReservationNotOpen.selector);
        vault.settleDirect(id, RESP, AMT);
        UnspentVault.DeliveryAcceptance memory c = _accLong(id, 1);
        bytes memory sig = _sigAccept(ALICE_PK, c);
        _acceptExpectRevert(c, sig, UnspentVault.ReservationNotOpen.selector);
    }

    function test_RevertWhen_ReleaseAfterSettle() public {
        uint256 id = _open();
        vm.prank(alice);
        vault.settleDirect(id, RESP, AMT);
        vm.warp(EXPIRY + 1);
        vm.expectRevert(UnspentVault.ReservationNotOpen.selector);
        vault.releaseExpired(id);
        assertEq(_avail(pid, alice), FUND - AMT);
    }

    function test_RevertWhen_DoubleRelease() public {
        uint256 id = _open();
        vm.warp(EXPIRY);
        vault.releaseExpired(id);
        vm.expectRevert(UnspentVault.ReservationNotOpen.selector);
        vault.releaseExpired(id);
        assertEq(_avail(pid, alice), FUND);
    }

    function test_RevertWhen_DoubleSettle() public {
        uint256 id = _open();
        vm.prank(alice);
        vault.settleDirect(id, RESP, AMT);
        vm.prank(alice);
        vm.expectRevert(UnspentVault.ReservationNotOpen.selector);
        vault.settleDirect(id, RESP, AMT);
        assertEq(usdc.balanceOf(payout), AMT);
    }

    function test_RevertWhen_ReleaseOrSettleUnknownReservation() public {
        vm.expectRevert(UnspentVault.ReservationNotOpen.selector);
        vault.releaseExpired(42);
        vm.prank(alice);
        vm.expectRevert(UnspentVault.ReservationNotOpen.selector);
        vault.settleDirect(42, RESP, 1);
    }

    function test_ReleasedFundsCanBeReservedAgainAndRefunded() public {
        uint256 id = _open();
        vm.warp(EXPIRY);
        vault.releaseExpired(id);
        UnspentVault.ReserveAuthorisation memory a = _auth(2, FUND);
        a.authDeadline = EXPIRY + 1 hours;
        a.expiry = EXPIRY + 2 hours;
        _reserve(a);
        assertEq(_resv(pid, alice), FUND);
    }

    function test_ReleaseWorksForInactiveProvider() public {
        uint256 id = _open();
        vm.prank(providerOwner);
        vault.setProviderActive(pid, false);
        vm.warp(EXPIRY);
        vault.releaseExpired(id);
        assertEq(_avail(pid, alice), FUND);
    }
}
