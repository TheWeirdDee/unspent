// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {UnspentVault} from "../UnspentVault.sol";
import {UnspentVaultTestBase} from "./UnspentVault.Base.t.sol";

contract UnspentVaultReserveTest is UnspentVaultTestBase {
    uint256 internal constant AMT = 3_000_000;

    function setUp() public override {
        super.setUp();
        _deposit(alice, pid, FUND);
    }

    // ------------------------------------------------------------ digest cross-checks
    function test_Digest_ReserveMatchesIndependentComputation() public view {
        UnspentVault.ReserveAuthorisation memory a = _auth(1, AMT);
        assertEq(vault.hashReserveAuthorisation(a), _reserveDigest(a, address(vault), block.chainid));
        assertEq(vault.DOMAIN_SEPARATOR(), _domainSeparator(address(vault), block.chainid));
        assertEq(vault.RESERVE_AUTHORISATION_TYPEHASH(), RESERVE_TYPEHASH);
        assertEq(vault.DELIVERY_ACCEPTANCE_TYPEHASH(), ACCEPT_TYPEHASH);
    }

    function test_Digest_AcceptanceMatchesIndependentComputation() public view {
        UnspentVault.DeliveryAcceptance memory c = _acc(7, AMT, 3);
        assertEq(vault.hashDeliveryAcceptance(c), _acceptDigest(c, address(vault), block.chainid));
    }

    // ------------------------------------------------------------ happy path
    function test_Reserve_MovesAvailableToReservedWithoutChangingLiability() public {
        uint256 liab = vault.totalOutstandingLiability();
        uint256 provOut = vault.providerOutstanding(pid);
        uint256 id = _reserveN(1, AMT);
        assertEq(id, 1);
        assertEq(_avail(pid, alice), FUND - AMT);
        assertEq(_resv(pid, alice), AMT);
        assertEq(_deposited(pid, alice), FUND);
        assertEq(vault.totalOutstandingLiability(), liab);
        assertEq(vault.providerOutstanding(pid), provOut);
        assertEq(usdc.balanceOf(address(vault)), FUND);
        assertEq(vault.nextReservationId(), 2);
        assertTrue(vault.reserveNonceUsed(alice, 1));
        assertTrue(vault.requestReserved(alice, keccak256(abi.encode("req", uint256(1)))));
        UnspentVault.Reservation memory r = vault.getReservation(id);
        assertEq(r.customer, alice);
        assertEq(r.providerId, pid);
        assertEq(r.payoutWallet, payout);
        assertEq(r.payoutVersion, 1);
        assertEq(uint8(r.status), uint8(UnspentVault.ReservationStatus.Reserved));
        assertEq(r.expiry, EXPIRY);
        assertEq(r.maxAmount, AMT);
        assertEq(r.requestHash, keccak256(abi.encode("req", uint256(1))));
        assertEq(r.settledAmount, 0);
        _assertAccountIdentity(pid, alice);
    }

    function test_Reserve_AnyRelayerMaySubmit() public {
        UnspentVault.ReserveAuthorisation memory a = _auth(1, AMT);
        bytes memory sig = _sigReserve(ALICE_PK, a);
        vm.prank(mallory);
        vault.reserveWithSignature(a, sig);
        assertEq(_resv(pid, alice), AMT);
    }

    function test_Reserve_NonceZeroIsValid() public {
        _reserveN(0, AMT);
        assertTrue(vault.reserveNonceUsed(alice, 0));
    }

    function test_Reserve_ExactlyAllAvailable() public {
        _reserveN(1, FUND);
        assertEq(_avail(pid, alice), 0);
        assertEq(_resv(pid, alice), FUND);
    }

    function test_Reserve_TwoDistinctRequestsSucceed() public {
        _reserveN(1, AMT);
        _reserveN(2, AMT);
        assertEq(_resv(pid, alice), 2 * AMT);
        assertEq(_avail(pid, alice), FUND - 2 * AMT);
    }

    // ------------------------------------------------------------ signature failures
    function test_RevertWhen_WrongCustomerSigner() public {
        UnspentVault.ReserveAuthorisation memory a = _auth(1, AMT);
        bytes memory sig = _sigReserve(MALLORY_PK, a);
        _reserveExpectRevert(a, sig, UnspentVault.InvalidSignature.selector);
        assertEq(_resv(pid, alice), 0);
    }

    function test_RevertWhen_SignedByProviderKey() public {
        UnspentVault.ReserveAuthorisation memory a = _auth(1, AMT);
        bytes memory sig = _sigReserve(PROVIDER_PK, a);
        _reserveExpectRevert(a, sig, UnspentVault.InvalidSignature.selector);
    }

    function test_RevertWhen_SignedForWrongChainId() public {
        UnspentVault.ReserveAuthorisation memory a = _auth(1, AMT);
        uint256 real = block.chainid;
        vm.chainId(real + 1);
        bytes memory sig = _sign(ALICE_PK, _reserveDigest(a, address(vault), block.chainid));
        vm.chainId(real);
        _reserveExpectRevert(a, sig, UnspentVault.InvalidSignature.selector);
    }

    function test_Reserve_SignatureForCurrentChainIdAcceptedAfterChainIdChange() public {
        UnspentVault.ReserveAuthorisation memory a = _auth(1, AMT);
        vm.chainId(block.chainid + 7);
        bytes memory sig = _sign(ALICE_PK, _reserveDigest(a, address(vault), block.chainid));
        assertEq(vault.DOMAIN_SEPARATOR(), _domainSeparator(address(vault), block.chainid));
        _submit(a, sig);
        assertEq(_resv(pid, alice), AMT);
    }

    function test_RevertWhen_SignedForOtherVaultInstance() public {
        UnspentVault vault2 = new UnspentVault(IERC20(address(usdc)));
        vm.prank(providerOwner);
        assertEq(vault2.registerProvider(payout, META), pid);
        UnspentVault.ReserveAuthorisation memory a = _auth(1, AMT);
        bytes memory sigForVault2 = _sign(ALICE_PK, _reserveDigest(a, address(vault2), block.chainid));
        assertTrue(vault2.DOMAIN_SEPARATOR() != vault.DOMAIN_SEPARATOR());
        _reserveExpectRevert(a, sigForVault2, UnspentVault.InvalidSignature.selector);
        // and the original vault's signature is rejected by the second instance
        bytes memory sigForVault1 = _sigReserve(ALICE_PK, a);
        vm.prank(relayer);
        vm.expectRevert(UnspentVault.InvalidSignature.selector);
        vault2.reserveWithSignature(a, sigForVault1);
    }

    function test_RevertWhen_TamperedAmount() public {
        UnspentVault.ReserveAuthorisation memory a = _auth(1, AMT);
        bytes memory sig = _sigReserve(ALICE_PK, a);
        a.maxAmount = AMT + 1;
        _reserveExpectRevert(a, sig, UnspentVault.InvalidSignature.selector);
    }

    function test_RevertWhen_TamperedRequestHash() public {
        UnspentVault.ReserveAuthorisation memory a = _auth(1, AMT);
        bytes memory sig = _sigReserve(ALICE_PK, a);
        a.requestHash = keccak256("different");
        _reserveExpectRevert(a, sig, UnspentVault.InvalidSignature.selector);
    }

    function test_RevertWhen_TamperedExpiry() public {
        UnspentVault.ReserveAuthorisation memory a = _auth(1, AMT);
        bytes memory sig = _sigReserve(ALICE_PK, a);
        a.expiry = EXPIRY + 1;
        _reserveExpectRevert(a, sig, UnspentVault.InvalidSignature.selector);
    }

    function test_RevertWhen_TamperedNonceOrAuthDeadlineOrCustomer() public {
        UnspentVault.ReserveAuthorisation memory a = _auth(1, AMT);
        bytes memory sig = _sigReserve(ALICE_PK, a);
        a.nonce = 2;
        _reserveExpectRevert(a, sig, UnspentVault.InvalidSignature.selector);
        a.nonce = 1;
        a.authDeadline = AUTH_DEADLINE + 1;
        _reserveExpectRevert(a, sig, UnspentVault.InvalidSignature.selector);
        a.authDeadline = AUTH_DEADLINE;
        a.customer = bob;
        _reserveExpectRevert(a, sig, UnspentVault.InvalidSignature.selector);
    }

    function test_RevertWhen_TamperedProviderId() public {
        UnspentVault.ReserveAuthorisation memory a = _auth(1, AMT);
        bytes memory sig = _sigReserve(ALICE_PK, a);
        a.providerId = pidB;
        a.payoutWallet = payout2; // consistent with provider B's registry so only the signature can fail
        _reserveExpectRevert(a, sig, UnspentVault.InvalidSignature.selector);
    }

    function test_RevertWhen_MalformedSignatureLength() public {
        UnspentVault.ReserveAuthorisation memory a = _auth(1, AMT);
        bytes memory good = _sigReserve(ALICE_PK, a);
        _reserveExpectRevert(a, "", UnspentVault.InvalidSignature.selector);
        _reserveExpectRevert(a, new bytes(64), UnspentVault.InvalidSignature.selector);
        _reserveExpectRevert(a, new bytes(65), UnspentVault.InvalidSignature.selector);
        _reserveExpectRevert(a, new bytes(66), UnspentVault.InvalidSignature.selector);
        _reserveExpectRevert(a, bytes.concat(good, hex"00"), UnspentVault.InvalidSignature.selector);
        bytes memory truncated = new bytes(64);
        for (uint256 i; i < 64; i++) {
            truncated[i] = good[i];
        }
        _reserveExpectRevert(a, truncated, UnspentVault.InvalidSignature.selector);
        bytes memory shortSig = new bytes(10);
        _reserveExpectRevert(a, shortSig, UnspentVault.InvalidSignature.selector);
        // control: the intact signature is accepted
        _submit(a, good);
    }

    function test_RevertWhen_MalleatedHighSSignature() public {
        UnspentVault.ReserveAuthorisation memory a = _auth(1, AMT);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ALICE_PK, _reserveDigest(a, address(vault), block.chainid));
        bytes32 highS = bytes32(SECP_N - uint256(s));
        uint8 flippedV = v == 27 ? 28 : 27;
        bytes memory bad = abi.encodePacked(r, highS, flippedV);
        _reserveExpectRevert(a, bad, UnspentVault.InvalidSignature.selector);
    }

    // ------------------------------------------------------------ config mismatches
    function test_RevertWhen_WrongPayoutVersion() public {
        UnspentVault.ReserveAuthorisation memory a = _auth(1, AMT);
        a.payoutVersion = 2;
        bytes memory sig = _sigReserve(ALICE_PK, a);
        _reserveExpectRevert(a, sig, UnspentVault.PayoutConfigMismatch.selector);
        a.payoutVersion = 0;
        sig = _sigReserve(ALICE_PK, a);
        _reserveExpectRevert(a, sig, UnspentVault.PayoutConfigMismatch.selector);
    }

    function test_RevertWhen_WrongPayoutWallet() public {
        UnspentVault.ReserveAuthorisation memory a = _auth(1, AMT);
        a.payoutWallet = payout2;
        bytes memory sig = _sigReserve(ALICE_PK, a);
        _reserveExpectRevert(a, sig, UnspentVault.PayoutConfigMismatch.selector);
    }

    function test_RevertWhen_WrongProvider_UnknownOrMismatchedPayout() public {
        UnspentVault.ReserveAuthorisation memory a = _authFor(999, payout, 1, AMT);
        bytes memory sig = _sigReserve(ALICE_PK, a);
        _reserveExpectRevert(a, sig, UnspentVault.ProviderNotFound.selector);
        // provider B but payout wallet of provider A
        a = _authFor(pidB, payout, 1, AMT);
        sig = _sigReserve(ALICE_PK, a);
        _reserveExpectRevert(a, sig, UnspentVault.PayoutConfigMismatch.selector);
    }

    function test_RevertWhen_ProviderInactive() public {
        vm.prank(providerOwner);
        vault.setProviderActive(pid, false);
        UnspentVault.ReserveAuthorisation memory a = _auth(1, AMT);
        bytes memory sig = _sigReserve(ALICE_PK, a);
        _reserveExpectRevert(a, sig, UnspentVault.ProviderInactive.selector);
    }

    // ------------------------------------------------------------ zero values
    function test_RevertWhen_ZeroCustomer() public {
        UnspentVault.ReserveAuthorisation memory a = _auth(1, AMT);
        a.customer = address(0);
        bytes memory sig = _sigReserve(ALICE_PK, a);
        _reserveExpectRevert(a, sig, UnspentVault.ZeroAddress.selector);
    }

    function test_RevertWhen_ZeroMaxAmount() public {
        UnspentVault.ReserveAuthorisation memory a = _auth(1, 0);
        bytes memory sig = _sigReserve(ALICE_PK, a);
        _reserveExpectRevert(a, sig, UnspentVault.ZeroAmount.selector);
    }

    function test_RevertWhen_ZeroRequestHash() public {
        UnspentVault.ReserveAuthorisation memory a = _auth(1, AMT);
        a.requestHash = bytes32(0);
        bytes memory sig = _sigReserve(ALICE_PK, a);
        _reserveExpectRevert(a, sig, UnspentVault.InvalidRequestHash.selector);
    }

    function test_RevertWhen_ZeroProviderId() public {
        UnspentVault.ReserveAuthorisation memory a = _authFor(0, payout, 1, AMT);
        bytes memory sig = _sigReserve(ALICE_PK, a);
        _reserveExpectRevert(a, sig, UnspentVault.ProviderNotFound.selector);
    }

    function test_RevertWhen_ZeroAuthDeadlineAndExpiry() public {
        UnspentVault.ReserveAuthorisation memory a = _auth(1, AMT);
        a.authDeadline = 0;
        bytes memory sig = _sigReserve(ALICE_PK, a);
        _reserveExpectRevert(a, sig, UnspentVault.AuthorisationExpired.selector);
        a.authDeadline = AUTH_DEADLINE;
        a.expiry = 0;
        sig = _sigReserve(ALICE_PK, a);
        _reserveExpectRevert(a, sig, UnspentVault.InvalidExpiryRelationship.selector);
    }

    // ------------------------------------------------------------ replay / double reservation / funds
    function test_RevertWhen_SameSignedReservationReplayed() public {
        UnspentVault.ReserveAuthorisation memory a = _auth(1, AMT);
        bytes memory sig = _sigReserve(ALICE_PK, a);
        _submit(a, sig);
        _reserveExpectRevert(a, sig, UnspentVault.NonceUsed.selector);
        assertEq(_resv(pid, alice), AMT);
    }

    function test_RevertWhen_NonceReusedWithDifferentRequest() public {
        _reserveN(5, AMT);
        UnspentVault.ReserveAuthorisation memory a = _auth(5, AMT);
        a.requestHash = keccak256("other request");
        bytes memory sig = _sigReserve(ALICE_PK, a);
        _reserveExpectRevert(a, sig, UnspentVault.NonceUsed.selector);
    }

    function test_RevertWhen_SameRequestHashReservedTwice() public {
        UnspentVault.ReserveAuthorisation memory a = _auth(1, AMT);
        _reserve(a);
        a.nonce = 2; // fresh nonce, same requestHash
        bytes memory sig = _sigReserve(ALICE_PK, a);
        _reserveExpectRevert(a, sig, UnspentVault.RequestAlreadyReserved.selector);
        assertFalse(vault.reserveNonceUsed(alice, 2), "failed reserve must not burn nonce");
    }

    function test_RevertWhen_RequestHashReusedAfterRelease() public {
        UnspentVault.ReserveAuthorisation memory a = _auth(1, AMT);
        uint256 id = _reserve(a);
        vm.warp(EXPIRY);
        vault.releaseExpired(id);
        a.nonce = 2;
        a.authDeadline = EXPIRY + 1 hours;
        a.expiry = EXPIRY + 2 hours;
        bytes memory sig = _sigReserve(ALICE_PK, a);
        _reserveExpectRevert(a, sig, UnspentVault.RequestAlreadyReserved.selector);
    }

    function test_RequestHashIsCustomerScoped() public {
        _deposit(bob, pid, FUND);
        UnspentVault.ReserveAuthorisation memory a = _auth(1, AMT);
        _reserve(a);
        a.customer = bob;
        bytes memory sig = _sign(BOB_PK, _reserveDigest(a, address(vault), block.chainid));
        _submit(a, sig);
        assertEq(_resv(pid, bob), AMT);
    }

    function test_RevertWhen_InsufficientAvailable() public {
        UnspentVault.ReserveAuthorisation memory a = _auth(1, FUND + 1);
        bytes memory sig = _sigReserve(ALICE_PK, a);
        _reserveExpectRevert(a, sig, UnspentVault.InsufficientAvailable.selector);
        assertFalse(vault.reserveNonceUsed(alice, 1));
        assertFalse(vault.requestReserved(alice, a.requestHash));
        // another provider's credits do not count
        _deposit(alice, pidB, FUND);
        _reserveExpectRevert(a, sig, UnspentVault.InsufficientAvailable.selector);
    }

    function test_RevertWhen_NoCreditsAtAll() public {
        UnspentVault.ReserveAuthorisation memory a = _auth(1, 1);
        a.customer = bob;
        bytes memory sig = _sign(BOB_PK, _reserveDigest(a, address(vault), block.chainid));
        _reserveExpectRevert(a, sig, UnspentVault.InsufficientAvailable.selector);
    }

    function test_RevertWhen_SecondReservationExceedsRemainingAvailable() public {
        _reserveN(1, FUND - 10);
        UnspentVault.ReserveAuthorisation memory a = _auth(2, 11);
        bytes memory sig = _sigReserve(ALICE_PK, a);
        _reserveExpectRevert(a, sig, UnspentVault.InsufficientAvailable.selector);
    }
}
