// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {UnspentVault} from "../UnspentVault.sol";
import {UnspentVaultTestBase} from "./UnspentVault.Base.t.sol";

/// (10, fuzz half) amounts from 1 micro-unit up to type(uint128).max; digest equality over arbitrary field values.
contract UnspentVaultFuzzTest is UnspentVaultTestBase {
    uint256 internal constant MAX = type(uint128).max;

    // ------------------------------------------------------------ deposit
    function testFuzz_Deposit_CreditsExactAmount(uint256 amount) public {
        amount = bound(amount, 1, MAX);
        _deposit(alice, pid, amount);
        assertEq(_avail(pid, alice), amount);
        assertEq(_deposited(pid, alice), amount);
        assertEq(vault.totalOutstandingLiability(), amount);
        assertEq(vault.providerOutstanding(pid), amount);
        assertEq(usdc.balanceOf(address(vault)), amount);
        _assertAccountIdentity(pid, alice);
    }

    function test_Deposit_ExtremeBoundaries() public {
        _deposit(alice, pid, 1);
        _deposit(bob, pid, MAX);
        assertEq(vault.totalOutstandingLiability(), MAX + 1);
        assertEq(usdc.balanceOf(address(vault)), MAX + 1);
    }

    // ------------------------------------------------------------ full lifecycle conservation
    function testFuzz_Lifecycle_AcceptAndSettleThenRefundConservesValue(uint256 dep, uint256 res, uint256 set) public {
        dep = bound(dep, 1, MAX);
        res = bound(res, 1, dep);
        set = bound(set, 1, res);
        _deposit(alice, pid, dep);
        uint256 id = _reserveN(1, res);
        assertEq(vault.totalOutstandingLiability(), dep);
        _accept(_acc(id, set, 1));

        assertEq(usdc.balanceOf(payout), set);
        assertEq(_avail(pid, alice), dep - set);
        assertEq(_resv(pid, alice), 0);
        assertEq(vault.totalOutstandingLiability(), dep - set);
        assertEq(usdc.balanceOf(address(vault)), dep - set);
        _assertAccountIdentity(pid, alice);

        if (dep - set > 0) {
            vm.prank(alice);
            vault.refund(pid, dep - set);
        }
        assertEq(usdc.balanceOf(alice), dep - set);
        assertEq(usdc.balanceOf(payout) + usdc.balanceOf(alice), dep);
        assertEq(usdc.balanceOf(address(vault)), 0);
        assertEq(vault.totalOutstandingLiability(), 0);
        _assertAccountIdentity(pid, alice);
    }

    function testFuzz_Lifecycle_SettleDirectConservesValue(uint256 dep, uint256 res, uint256 set) public {
        dep = bound(dep, 1, MAX);
        res = bound(res, 1, dep);
        set = bound(set, 1, res);
        _deposit(alice, pid, dep);
        uint256 id = _reserveN(1, res);
        vm.prank(alice);
        vault.settleDirect(id, RESP, set);
        assertEq(usdc.balanceOf(payout), set);
        assertEq(_avail(pid, alice), dep - set);
        assertEq(_settled(pid, alice), set);
        assertEq(vault.providerOutstanding(pid), dep - set);
        assertEq(usdc.balanceOf(address(vault)), dep - set);
        _assertAccountIdentity(pid, alice);
    }

    function testFuzz_Lifecycle_ReleaseRestoresAvailable(uint256 dep, uint256 res, uint256 extraTime) public {
        dep = bound(dep, 1, MAX);
        res = bound(res, 1, dep);
        extraTime = bound(extraTime, 0, 365 days);
        _deposit(alice, pid, dep);
        uint256 id = _reserveN(1, res);
        vm.warp(EXPIRY + extraTime);
        vault.releaseExpired(id);
        assertEq(_avail(pid, alice), dep);
        assertEq(_resv(pid, alice), 0);
        assertEq(vault.totalOutstandingLiability(), dep);
        assertEq(usdc.balanceOf(address(vault)), dep);
    }

    // ------------------------------------------------------------ refund bounds
    function testFuzz_Refund_NeverExceedsAvailable(uint256 dep, uint256 res, uint256 amt) public {
        dep = bound(dep, 2, MAX);
        res = bound(res, 1, dep - 1);
        uint256 avail = dep - res;
        _deposit(alice, pid, dep);
        _reserveN(1, res);

        uint256 tooMuch = bound(amt, avail + 1, type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(UnspentVault.InsufficientAvailable.selector);
        vault.refund(pid, tooMuch);

        uint256 ok = bound(amt, 1, avail);
        vm.prank(alice);
        vault.refund(pid, ok);
        assertEq(usdc.balanceOf(alice), ok);
        assertEq(_avail(pid, alice), avail - ok);
        assertEq(_resv(pid, alice), res);
        _assertAccountIdentity(pid, alice);
    }

    function testFuzz_Reserve_RevertsWhenAboveAvailable(uint256 dep, uint256 over) public {
        dep = bound(dep, 1, MAX);
        over = bound(over, dep + 1, type(uint256).max);
        _deposit(alice, pid, dep);
        UnspentVault.ReserveAuthorisation memory a = _auth(1, over);
        bytes memory sig = _sigReserve(ALICE_PK, a);
        _reserveExpectRevert(a, sig, UnspentVault.InsufficientAvailable.selector);
    }

    function test_OneMicroUnit_FullLifecycle() public {
        _deposit(alice, pid, 1);
        uint256 id = _reserveN(1, 1);
        assertEq(_avail(pid, alice), 0);
        _accept(_acc(id, 1, 1));
        assertEq(usdc.balanceOf(payout), 1);
        assertEq(vault.totalOutstandingLiability(), 0);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function test_Uint128Max_ReserveAndPartialSettle() public {
        _deposit(alice, pid, MAX);
        uint256 id = _reserveN(1, MAX);
        _accept(_acc(id, MAX - 1, 1));
        assertEq(usdc.balanceOf(payout), MAX - 1);
        assertEq(_avail(pid, alice), 1);
        assertEq(vault.totalOutstandingLiability(), 1);
    }

    // ------------------------------------------------------------ digest equality for arbitrary field values
    function testFuzz_ReserveDigestMatchesIndependentComputation(UnspentVault.ReserveAuthorisation memory a) public view {
        assertEq(vault.hashReserveAuthorisation(a), _reserveDigest(a, address(vault), block.chainid));
    }

    function testFuzz_AcceptanceDigestMatchesIndependentComputation(UnspentVault.DeliveryAcceptance memory c) public view {
        assertEq(vault.hashDeliveryAcceptance(c), _acceptDigest(c, address(vault), block.chainid));
    }

    function testFuzz_DigestBindsChainId(uint64 chainId) public {
        chainId = uint64(bound(chainId, 1, type(uint64).max));
        UnspentVault.ReserveAuthorisation memory a = _auth(1, 1_000_000);
        vm.chainId(chainId);
        assertEq(vault.hashReserveAuthorisation(a), _reserveDigest(a, address(vault), chainId));
    }

    // ------------------------------------------------------------ signer / time fuzz
    function testFuzz_RandomKeyCannotReserveForAlice(uint256 pk) public {
        pk = bound(pk, 1, SECP_N - 1);
        vm.assume(vm.addr(pk) != alice);
        _deposit(alice, pid, FUND);
        UnspentVault.ReserveAuthorisation memory a = _auth(1, 1_000_000);
        bytes memory sig = _sigReserve(pk, a);
        _reserveExpectRevert(a, sig, UnspentVault.InvalidSignature.selector);
    }

    function testFuzz_SubmissionTimeVsAuthDeadline(uint256 t) public {
        t = bound(t, T0, AUTH_DEADLINE + 1 days);
        _deposit(alice, pid, FUND);
        vm.warp(t);
        UnspentVault.ReserveAuthorisation memory a = _auth(1, 1_000_000);
        bytes memory sig = _sigReserve(ALICE_PK, a);
        if (t > AUTH_DEADLINE) {
            _reserveExpectRevert(a, sig, UnspentVault.AuthorisationExpired.selector);
        } else {
            _submit(a, sig);
            assertEq(_resv(pid, alice), 1_000_000);
        }
    }

    function testFuzz_ExpiryCap(uint256 expOffset) public {
        expOffset = bound(expOffset, 3601, 3 days);
        _deposit(alice, pid, FUND);
        UnspentVault.ReserveAuthorisation memory a = _auth(1, 1_000_000);
        a.expiry = T0 + expOffset;
        bytes memory sig = _sigReserve(ALICE_PK, a);
        if (expOffset > 1 days) {
            _reserveExpectRevert(a, sig, UnspentVault.ExpiryTooFar.selector);
        } else {
            _submit(a, sig);
            assertEq(_resv(pid, alice), 1_000_000);
        }
    }

    function testFuzz_SettleOrReleaseExactlyOnePathByTime(uint256 t) public {
        t = bound(t, T0, EXPIRY + 3 days);
        _deposit(alice, pid, FUND);
        uint256 id = _reserveN(1, 1_000_000);
        vm.warp(t);
        if (t < EXPIRY) {
            vm.expectRevert(UnspentVault.ReservationNotExpired.selector);
            vault.releaseExpired(id);
            vm.prank(alice);
            vault.settleDirect(id, RESP, 1_000_000);
        } else {
            vm.prank(alice);
            vm.expectRevert(UnspentVault.ReservationExpired.selector);
            vault.settleDirect(id, RESP, 1_000_000);
            vault.releaseExpired(id);
            assertEq(_avail(pid, alice), FUND);
        }
    }
}
