// Unit tests for the acceptance guard: a bad delivery must never reach the wallet. Run: bun test scripts/delivery.test.ts
import { describe, expect, test } from "bun:test";
import type { Hex } from "viem";
import { checkDelivery, signAcceptance, type DeliveryInput } from "../src/lib/delivery";
import { responseHashOf } from "../src/lib/protocol";

const customer = "0xE306b8ae6e958F7C8e3401f1f12d550E5DAecab6" as const;
const payout = "0x97f32Ba0b4DD5c274DFD9C2A7e6Aa403a9B7dE8d" as const;
const requestHash = ("0x" + "10".repeat(32)) as Hex;
const output = "- one\n- two\n- three";
const NOW = 1_800_000_000;

const base = (over: Partial<DeliveryInput> = {}, resultOver: Record<string, unknown> = {}, reservationOver: Partial<DeliveryInput["reservation"]> = {}): DeliveryInput => ({
  result: { output, responseHash: responseHashOf(output), usageAmountMicrounits: "100000", ...resultOver },
  customer,
  providerId: 1n,
  reservationId: "1",
  quote: { requestHash, maxAmountMicrounits: "100000", payoutWallet: payout, reservationDeadline: NOW + 1200 },
  reservation: { status: 1, customer, providerId: 1n, payoutWallet: payout, maxAmount: 100000n, requestHash, expiry: BigInt(NOW + 1200), ...reservationOver },
  now: NOW,
  nonce: 7n,
  ...over,
});

/** A wallet that records every signing request. */
const spyWallet = () => {
  const calls: unknown[] = [];
  return { calls, sign: async (m: unknown) => { calls.push(m); return ("0x" + "ab".repeat(65)) as Hex; } };
};

describe("a valid delivery", () => {
  test("is accepted and the wallet is asked to sign exactly the verified message", async () => {
    const w = spyWallet();
    const r = await signAcceptance(base(), w.sign);
    expect(r.ok).toBe(true);
    expect(w.calls).toHaveLength(1);
    const m = w.calls[0] as { responseHash: Hex; amount: bigint; reservationId: bigint; customer: string };
    expect(m.responseHash).toBe(responseHashOf(output));
    expect(m.amount).toBe(100000n);
    expect(m.reservationId).toBe(1n);
    expect(m.customer).toBe(customer);
  });
  test("hash comparison ignores hex case", () => {
    expect(checkDelivery(base({}, { responseHash: responseHashOf(output).toUpperCase().replace("0X", "0x") })).ok).toBe(true);
  });
  test("a smaller amount than the cap is allowed", () => {
    const r = checkDelivery(base({}, { usageAmountMicrounits: "60000" }));
    expect(r.ok && r.message.amount).toBe(60000n);
  });
});

describe("a mismatched delivery never reaches the wallet", () => {
  const cases: [string, DeliveryInput, string][] = [
    ["text A with the hash of text B", base({}, { output: "- something else entirely" }), "HASH_MISMATCH"],
    ["a different but well-formed hash", base({}, { responseHash: "0x" + "cd".repeat(32) }), "HASH_MISMATCH"],
    ["amount above the quoted maximum", base({}, { usageAmountMicrounits: "100001" }), "AMOUNT_OUT_OF_BOUNDS"],
    ["amount far above the maximum", base({}, { usageAmountMicrounits: "100000000000" }), "AMOUNT_OUT_OF_BOUNDS"],
    ["zero amount", base({}, { usageAmountMicrounits: "0" }), "AMOUNT_OUT_OF_BOUNDS"],
    ["amount above the onchain reservation", base({}, {}, { maxAmount: 50000n }), "AMOUNT_OUT_OF_BOUNDS"],
    ["scientific-notation amount", base({}, { usageAmountMicrounits: "1e5" }), "MALFORMED_DELIVERY"],
    ["negative amount", base({}, { usageAmountMicrounits: "-1" }), "MALFORMED_DELIVERY"],
    ["hex amount", base({}, { usageAmountMicrounits: "0x10" }), "MALFORMED_DELIVERY"],
    ["fractional amount", base({}, { usageAmountMicrounits: "100000.5" }), "MALFORMED_DELIVERY"],
    ["amount with whitespace", base({}, { usageAmountMicrounits: " 100000" }), "MALFORMED_DELIVERY"],
    ["leading-zero amount", base({}, { usageAmountMicrounits: "0100000" }), "MALFORMED_DELIVERY"],
    ["numeric (not string) amount", base({}, { usageAmountMicrounits: 100000 }), "MALFORMED_DELIVERY"],
    ["missing text", base({}, { output: undefined }), "MALFORMED_DELIVERY"],
    ["empty text", base({}, { output: "" }), "MALFORMED_DELIVERY"],
    ["oversized text", base({}, { output: "x".repeat(20_001) }), "MALFORMED_DELIVERY"],
    ["short hash", base({}, { responseHash: "0x1234" }), "MALFORMED_DELIVERY"],
    ["non-hex hash", base({}, { responseHash: "0x" + "zz".repeat(32) }), "MALFORMED_DELIVERY"],
    ["null delivery", base({ result: null }), "MALFORMED_DELIVERY"],
    ["string delivery", base({ result: "ok" }), "MALFORMED_DELIVERY"],
    ["reservation already settled", base({}, {}, { status: 2 }), "RESERVATION_MISMATCH"],
    ["reservation released", base({}, {}, { status: 3 }), "RESERVATION_MISMATCH"],
    ["reservation belongs to another customer", base({}, {}, { customer: payout }), "RESERVATION_MISMATCH"],
    ["reservation is for another provider", base({}, {}, { providerId: 2n }), "RESERVATION_MISMATCH"],
    ["reservation has another request hash", base({}, {}, { requestHash: ("0x" + "77".repeat(32)) as Hex }), "RESERVATION_MISMATCH"],
    ["reservation has another payout wallet", base({}, {}, { payoutWallet: customer }), "RESERVATION_MISMATCH"],
    ["reservation about to expire", base({ now: NOW + 1190 }), "RESERVATION_EXPIRED"],
    ["reservation already expired", base({ now: NOW + 5000 }), "RESERVATION_EXPIRED"],
  ];
  for (const [name, input, code] of cases) {
    test(`${name} -> ${code}, no signing request`, async () => {
      const w = spyWallet();
      const r = await signAcceptance(input, w.sign);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe(code as never);
      expect(w.calls).toHaveLength(0);
    });
  }
});
