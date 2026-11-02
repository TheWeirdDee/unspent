// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {UnspentVault} from "../UnspentVault.sol";
import {MockSmartWallet} from "./mocks/MockSmartWallet.sol";
import {UnspentVaultTestBase} from "./UnspentVault.Base.t.sol";

/// @notice ERC-1271 contract-wallet signatures for reservation and acceptance.
contract UnspentVaultSmartWalletTest is UnspentVaultTestBase {
    MockSmartWallet internal wallet; // owned by alice, used as the customer

    function setUp() public override {
        super.setUp();
        wallet = new MockSmartWallet(alice);
        _fundWallet(2_000_000); // 2 USDC
    }

    function _fundWallet(uint256 amount) internal {
        usdc.mint(address(wallet), amount);
        vm.startPrank(alice);
        wallet.execute(address(usdc), abi.encodeCall(IERC20.approve, (address(vault), amount)));
        wallet.execute(address(vault), abi.encodeCall(UnspentVault.deposit, (pid, amount)));
        vm.stopPrank();
    }

    function _walletCall(bytes memory call) internal {
        vm.prank(alice);
        wallet.execute(address(vault), call);
    }

    function _walletAuth(uint256 nonce, uint256 amount) internal view returns (UnspentVault.ReserveAuthorisation memory a) {
        a = _auth(nonce, amount);
        a.customer = address(wallet);
    }

    function _walletAcc(uint256 id, uint256 amount, uint256 nonce)
        internal
        view
        returns (UnspentVault.DeliveryAcceptance memory c)
    {
        c = _acc(id, amount, nonce);
        c.customer = address(wallet);
    }

    function test_SmartWalletDeposit_CreatesCredits() public view {
        assertEq(_avail(pid, address(wallet)), 2_000_000);
        assertEq(_deposited(pid, address(wallet)), 2_000_000);
    }

    function test_SmartWalletReserve_Accepts1271Signature() public {
        UnspentVault.ReserveAuthorisation memory a = _walletAuth(1, 100_000);
        uint256 id = _submit(a, _sigReserve(ALICE_PK, a));

        UnspentVault.Reservation memory r = vault.getReservation(id);
        assertEq(r.customer, address(wallet));
        assertEq(_resv(pid, address(wallet)), 100_000);
        assertEq(_avail(pid, address(wallet)), 1_900_000);
    }

    function test_SmartWalletReserve_RejectsForeignOwnerSignature() public {
        UnspentVault.ReserveAuthorisation memory a = _walletAuth(1, 100_000);
        _reserveExpectRevert(a, _sigReserve(MALLORY_PK, a), UnspentVault.InvalidSignature.selector);
    }

    function test_SmartWalletReserve_RejectedByWallet_Reverts() public {
        vm.prank(alice);
        wallet.setMode(MockSmartWallet.Mode.AlwaysReject);
        UnspentVault.ReserveAuthorisation memory a = _walletAuth(1, 100_000);
        _reserveExpectRevert(a, _sigReserve(ALICE_PK, a), UnspentVault.InvalidSignature.selector);
    }

    function test_SmartWalletReserve_WalletReverts_Reverts() public {
        vm.prank(alice);
        wallet.setMode(MockSmartWallet.Mode.Revert);
        UnspentVault.ReserveAuthorisation memory a = _walletAuth(1, 100_000);
        _reserveExpectRevert(a, _sigReserve(ALICE_PK, a), UnspentVault.InvalidSignature.selector);
    }

    function test_SmartWalletReserve_ShortReturn_Reverts() public {
        vm.prank(alice);
        wallet.setMode(MockSmartWallet.Mode.ShortReturn);
        UnspentVault.ReserveAuthorisation memory a = _walletAuth(1, 100_000);
        _reserveExpectRevert(a, _sigReserve(ALICE_PK, a), UnspentVault.InvalidSignature.selector);
    }

    function test_SmartWalletAccept_Accepts1271Signature_PaysBoundPayout() public {
        UnspentVault.ReserveAuthorisation memory a = _walletAuth(1, 100_000);
        uint256 id = _submit(a, _sigReserve(ALICE_PK, a));

        UnspentVault.DeliveryAcceptance memory c = _walletAcc(id, 100_000, 7);
        bytes memory sig = _sigAccept(ALICE_PK, c);
        vm.prank(relayer);
        vault.acceptAndSettle(c, sig);

        assertEq(usdc.balanceOf(payout), 100_000);
        assertEq(_settled(pid, address(wallet)), 100_000);
        assertEq(_resv(pid, address(wallet)), 0);
        _assertAccountIdentity(pid, address(wallet));
    }

    function test_SmartWalletAccept_ReplayRejected() public {
        UnspentVault.ReserveAuthorisation memory a = _walletAuth(1, 100_000);
        uint256 id = _submit(a, _sigReserve(ALICE_PK, a));
        UnspentVault.DeliveryAcceptance memory c = _walletAcc(id, 100_000, 7);
        bytes memory sig = _sigAccept(ALICE_PK, c);
        vm.prank(relayer);
        vault.acceptAndSettle(c, sig);

        vm.prank(relayer);
        vm.expectRevert(UnspentVault.ReservationNotOpen.selector);
        vault.acceptAndSettle(c, sig);
    }

    function test_SmartWalletSettleDirect_Works() public {
        UnspentVault.ReserveAuthorisation memory a = _walletAuth(1, 100_000);
        uint256 id = _submit(a, _sigReserve(ALICE_PK, a));

        _walletCall(abi.encodeCall(UnspentVault.settleDirect, (id, RESP, 60_000)));
        assertEq(usdc.balanceOf(payout), 60_000);
        assertEq(_avail(pid, address(wallet)), 1_940_000);
        _assertAccountIdentity(pid, address(wallet));
    }

    function test_SmartWalletRefund_ReturnsToWallet() public {
        _walletCall(abi.encodeCall(UnspentVault.refund, (pid, 500_000)));
        assertEq(usdc.balanceOf(address(wallet)), 500_000);
        _assertAccountIdentity(pid, address(wallet));
    }

    /// An EOA customer cannot be impersonated by a contract signature: ecrecover only sees EOAs.
    function test_EoaCustomer_StillRejectsNonEcdsaSignature() public {
        _deposit(alice, pid, 1_000_000);
        UnspentVault.ReserveAuthorisation memory a = _auth(5, 100_000);
        _reserveExpectRevert(a, hex"deadbeef", UnspentVault.InvalidSignature.selector);
    }
}

/// @notice Explicit, customer-signed consent that the provider may settle without a fresh signature.
contract UnspentVaultConsentSettlementTest is UnspentVaultTestBase {
    uint64 internal constant CONSENT_AT = uint64(T0 + 90 minutes); // after AUTH_DEADLINE, before EXPIRY

    function setUp() public override {
        super.setUp();
        _deposit(alice, pid, 2_000_000); // 2 USDC
    }

    function test_DefaultReservation_ProviderCannotClaim() public {
        uint256 id = _reserveN(1, 100_000);
        vm.warp(CONSENT_AT + 1);
        vm.prank(providerOwner);
        vm.expectRevert(UnspentVault.NoSettlementConsent.selector);
        vault.settleConsented(id, RESP, 100_000);
    }

    function test_ConsentWindow_NotOpenBeforeSignedTime() public {
        uint256 id = _reserveConsent(1, 100_000, CONSENT_AT);
        vm.warp(CONSENT_AT - 1);
        vm.prank(providerOwner);
        vm.expectRevert(UnspentVault.ConsentWindowNotOpen.selector);
        vault.settleConsented(id, RESP, 100_000);
    }

    function test_ConsentWindow_ProviderClaimsAtSignedTime() public {
        uint256 id = _reserveConsent(1, 100_000, CONSENT_AT);
        vm.warp(CONSENT_AT);

        vm.expectEmit(true, true, true, true, address(vault));
        emit UnspentVault.ConsentSettlement(id, pid, alice);
        vm.prank(providerOwner);
        vault.settleConsented(id, RESP, 40_000);

        assertEq(usdc.balanceOf(payout), 40_000);
        assertEq(_settled(pid, alice), 40_000);
        assertEq(_resv(pid, alice), 0);
        assertEq(_avail(pid, alice), 1_960_000); // remainder returned to available
        _assertAccountIdentity(pid, alice);

        UnspentVault.Reservation memory r = vault.getReservation(id);
        assertEq(uint8(r.status), uint8(UnspentVault.ReservationStatus.Settled));
        assertEq(r.responseHash, RESP);
    }

    function test_ConsentWindow_OnlyProviderOwnerMayClaim() public {
        uint256 id = _reserveConsent(1, 100_000, CONSENT_AT);
        vm.warp(CONSENT_AT);

        vm.prank(relayer);
        vm.expectRevert(UnspentVault.NotProviderOwner.selector);
        vault.settleConsented(id, RESP, 100_000);

        vm.prank(mallory);
        vm.expectRevert(UnspentVault.NotProviderOwner.selector);
        vault.settleConsented(id, RESP, 100_000);

        vm.prank(providerOwner2);
        vm.expectRevert(UnspentVault.NotProviderOwner.selector);
        vault.settleConsented(id, RESP, 100_000);
    }

    function test_ConsentWindow_CustomerAcceptanceWins() public {
        uint256 id = _reserveConsent(1, 100_000, CONSENT_AT);
        // The customer accepts before the window opens, so the provider's claim has nothing left to claim.
        _accept(_acc(id, 100_000, 9));
        vm.warp(CONSENT_AT);
        vm.prank(providerOwner);
        vm.expectRevert(UnspentVault.ReservationNotOpen.selector);
        vault.settleConsented(id, RESP, 100_000);
    }

    function test_ConsentWindow_ExpiryStillWins() public {
        uint256 id = _reserveConsent(1, 100_000, CONSENT_AT);
        vm.warp(EXPIRY);
        vm.prank(providerOwner);
        vm.expectRevert(UnspentVault.ReservationExpired.selector);
        vault.settleConsented(id, RESP, 100_000);
    }

    function test_ConsentWindow_AmountAboveMaximumReverts() public {
        uint256 id = _reserveConsent(1, 100_000, CONSENT_AT);
        vm.warp(CONSENT_AT);
        vm.prank(providerOwner);
        vm.expectRevert(UnspentVault.AmountExceedsReservation.selector);
        vault.settleConsented(id, RESP, 100_001);
    }

    function test_ConsentWindow_ZeroAmountAndZeroHashRevert() public {
        uint256 id = _reserveConsent(1, 100_000, CONSENT_AT);
        vm.warp(CONSENT_AT);
        vm.startPrank(providerOwner);
        vm.expectRevert(UnspentVault.InvalidResponseHash.selector);
        vault.settleConsented(id, bytes32(0), 100_000);
        vm.expectRevert(UnspentVault.AmountExceedsReservation.selector);
        vault.settleConsented(id, RESP, 0);
        vm.stopPrank();
    }

    function test_ConsentWindow_DeactivatedProviderCanStillClaim() public {
        uint256 id = _reserveConsent(1, 100_000, CONSENT_AT);
        vm.prank(providerOwner);
        vault.setProviderActive(pid, false);
        vm.warp(CONSENT_AT);

        vm.prank(providerOwner);
        vault.settleConsented(id, RESP, 100_000);
        assertEq(usdc.balanceOf(payout), 100_000);
    }

    function test_ConsentWindow_ReplayRejected() public {
        uint256 id = _reserveConsent(1, 100_000, CONSENT_AT);
        vm.warp(CONSENT_AT);
        vm.startPrank(providerOwner);
        vault.settleConsented(id, RESP, 100_000);
        vm.expectRevert(UnspentVault.ReservationNotOpen.selector);
        vault.settleConsented(id, RESP, 100_000);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- consent validation at reserve time
    function test_ConsentAtOrBeforeAuthDeadline_Reverts() public {
        UnspentVault.ReserveAuthorisation memory a = _authWithConsent(1, 100_000, uint64(AUTH_DEADLINE));
        _reserveExpectRevert(a, _sigReserve(ALICE_PK, a), UnspentVault.InvalidSettlementConsent.selector);
    }

    function test_ConsentAtOrAfterExpiry_Reverts() public {
        UnspentVault.ReserveAuthorisation memory a = _authWithConsent(1, 100_000, uint64(EXPIRY));
        _reserveExpectRevert(a, _sigReserve(ALICE_PK, a), UnspentVault.InvalidSettlementConsent.selector);
    }

    function test_ConsentTimestampIsBoundByTheSignature() public {
        UnspentVault.ReserveAuthorisation memory a = _authWithConsent(1, 100_000, CONSENT_AT);
        bytes memory sig = _sigReserve(ALICE_PK, a);
        // Moving the consent window after signing changes the digest, so the old signature no longer matches.
        a.providerSettleAfter = CONSENT_AT - 10 minutes;
        _reserveExpectRevert(a, sig, UnspentVault.InvalidSignature.selector);
    }

    /// Any claimed amount within the cap preserves the account identity and never overdraws the reservation.
    function testFuzz_ConsentClaim_KeepsAccountingIdentity(uint256 amount) public {
        uint256 cap = 100_000;
        amount = bound(amount, 1, cap);
        uint256 id = _reserveConsent(1, cap, CONSENT_AT);
        vm.warp(CONSENT_AT);
        vm.prank(providerOwner);
        vault.settleConsented(id, RESP, amount);

        assertEq(usdc.balanceOf(payout), amount);
        assertEq(_settled(pid, alice), amount);
        assertEq(_avail(pid, alice), 2_000_000 - amount);
        _assertAccountIdentity(pid, alice);
        (uint256 tokenBalance, uint256 liability) = vault.solvency();
        assertEq(tokenBalance, liability);
    }
}
