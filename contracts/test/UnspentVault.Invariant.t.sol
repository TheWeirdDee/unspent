// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {UnspentVault} from "../UnspentVault.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {UnspentVaultHandler} from "./UnspentVault.Handler.t.sol";

/// (10) stateful invariants driven through UnspentVaultHandler.
/// forge-config: default.invariant.runs = 256
/// forge-config: default.invariant.depth = 150
/// forge-config: default.invariant.fail_on_revert = false
contract UnspentVaultInvariantTest is Test {
    UnspentVault internal vault;
    MockUSDC internal usdc;
    UnspentVaultHandler internal handler;

    function setUp() public {
        vm.warp(1_700_000_000);
        usdc = new MockUSDC();
        vault = new UnspentVault(IERC20(address(usdc)));
        handler = new UnspentVaultHandler(vault, usdc);

        targetContract(address(handler));
        bytes4[] memory sels = new bytes4[](9);
        sels[0] = handler.deposit.selector;
        sels[1] = handler.refund.selector;
        sels[2] = handler.reserve.selector;
        sels[3] = handler.settle.selector;
        sels[4] = handler.release.selector;
        sels[5] = handler.warp.selector;
        sels[6] = handler.updatePayout.selector;
        sels[7] = handler.toggleActive.selector;
        sels[8] = handler.outsiderAttack.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sels}));
    }

    function _sumAvailable() internal view returns (uint256 total) {
        for (uint256 c; c < 3; c++) {
            for (uint256 p; p < 2; p++) {
                (uint256 a,,,,) = vault.getAccount(handler.providerIds(p), handler.customers(c));
                total += a;
            }
        }
    }

    function _sumReserved() internal view returns (uint256 total) {
        for (uint256 c; c < 3; c++) {
            for (uint256 p; p < 2; p++) {
                (, uint256 r,,,) = vault.getAccount(handler.providerIds(p), handler.customers(c));
                total += r;
            }
        }
    }

    /// available + reserved + totalSettled + totalRefunded == totalDeposited, per account
    function invariant_AccountIdentityHolds() public view {
        for (uint256 c; c < 3; c++) {
            for (uint256 p; p < 2; p++) {
                (uint256 a, uint256 r, uint256 d, uint256 s, uint256 f) =
                    vault.getAccount(handler.providerIds(p), handler.customers(c));
                assertEq(a + r + s + f, d, "account identity");
            }
        }
    }

    /// sum over actors of available + reserved == totalOutstandingLiability
    function invariant_LiabilityEqualsSumOfAvailableAndReserved() public view {
        assertEq(_sumAvailable() + _sumReserved(), vault.totalOutstandingLiability());
    }

    /// providerOutstanding[p] == sum over customers of available + reserved
    function invariant_ProviderOutstandingSums() public view {
        uint256 total;
        for (uint256 p; p < 2; p++) {
            uint256 pid = handler.providerIds(p);
            uint256 sum;
            for (uint256 c; c < 3; c++) {
                (uint256 a, uint256 r,,,) = vault.getAccount(pid, handler.customers(c));
                sum += a + r;
            }
            assertEq(vault.providerOutstanding(pid), sum, "provider outstanding");
            total += vault.providerOutstanding(pid);
        }
        assertEq(total, vault.totalOutstandingLiability());
    }

    /// token balance covers liability (and, with no surplus injected here, equals it)
    function invariant_TokenBalanceCoversLiability() public view {
        (uint256 bal, uint256 liab) = vault.solvency();
        assertGe(bal, liab);
        assertEq(bal, liab, "no surplus exists in this scenario");
    }

    /// handler ghost totals match what the vault recorded and what actually moved
    function invariant_GhostTotalsMatchVaultAndTokenFlows() public view {
        uint256 dep;
        uint256 settled;
        uint256 refunded;
        for (uint256 c; c < 3; c++) {
            for (uint256 p; p < 2; p++) {
                (,, uint256 d, uint256 s, uint256 f) = vault.getAccount(handler.providerIds(p), handler.customers(c));
                dep += d;
                settled += s;
                refunded += f;
            }
        }
        assertEq(dep, handler.ghostDeposited());
        assertEq(settled, handler.ghostSettled());
        assertEq(refunded, handler.ghostRefunded());
        assertEq(dep, settled + refunded + vault.totalOutstandingLiability());

        uint256 paid;
        for (uint256 i; i < handler.payoutCount(); i++) {
            paid += usdc.balanceOf(handler.payoutWallets(i));
        }
        assertEq(paid, settled, "payout wallets received exactly what was settled");
    }

    /// sum of open reservations' maxAmount == sum of reserved
    function invariant_ReservedEqualsOpenReservations() public view {
        uint256 open;
        for (uint256 i; i < handler.reservationCount(); i++) {
            UnspentVault.Reservation memory r = vault.getReservation(handler.reservationIds(i));
            if (r.status == UnspentVault.ReservationStatus.Reserved) open += r.maxAmount;
        }
        assertEq(open, _sumReserved());
    }

    /// no provider owner / payout wallet / random address ever reduced a customer's available balance
    function invariant_OutsidersNeverReduceCustomerAvailable() public view {
        assertFalse(handler.outsiderReducedAvailable());
    }

    function invariant_CallSummary() public view {
        console2.log("deposit", handler.nDeposit());
        console2.log("refund", handler.nRefund());
        console2.log("reserve", handler.nReserve());
        console2.log("settleDirect", handler.nSettleDirect());
        console2.log("settleSigned", handler.nSettleSigned());
        console2.log("release", handler.nRelease());
        console2.log("outsider", handler.nOutsider());
    }
}
