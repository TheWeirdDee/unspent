import type { Address, Hex } from "viem";
import { responseHashOf, type AcceptMessage } from "@/lib/protocol";

/**
 * Everything the browser must verify before it asks the wallet to sign acceptance of a delivery.
 * The API is untrusted for this step: it supplies the text, the hash and the amount, and a buggy or compromised API could
 * pair text A with hash B. The customer's signature is meant to bind the text they read, so the text is re-hashed here, the
 * amount is bounded by the quote and the onchain reservation, and the reservation is checked against this customer,
 * provider and request. The wallet callback is invoked only after every check passes.
 */

export interface DeliveryInput {
  /** What the API returned (unvalidated). */
  result: unknown;
  customer: Address;
  providerId: bigint;
  reservationId: string;
  quote: { requestHash: Hex; maxAmountMicrounits: string; payoutWallet: Address; reservationDeadline: number };
  /** The reservation as read from the contract just now. */
  reservation: { status: number; customer: Address; providerId: bigint; payoutWallet: Address; maxAmount: bigint; requestHash: Hex; expiry: bigint };
  /** Current chain time in seconds. */
  now: number;
  nonce: bigint;
  /** Seconds that must remain before the reservation expires so the relayer can still settle. */
  safetyMarginSec?: number;
}

export type DeliveryCheck =
  | { ok: true; message: AcceptMessage; output: string }
  | { ok: false; code: "MALFORMED_DELIVERY" | "HASH_MISMATCH" | "AMOUNT_OUT_OF_BOUNDS" | "RESERVATION_MISMATCH" | "RESERVATION_EXPIRED"; reason: string };

const HEX32 = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL = /^(0|[1-9]\d{0,29})$/;
const MAX_OUTPUT_CHARS = 20_000;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function checkDelivery(i: DeliveryInput): DeliveryCheck {
  const bad = (code: Exclude<DeliveryCheck, { ok: true }>["code"], reason: string): DeliveryCheck => ({ ok: false, code, reason });
  const r = i.result as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return bad("MALFORMED_DELIVERY", "The delivery is not an object.");
  const { output, responseHash, usageAmountMicrounits } = r;
  if (typeof output !== "string" || output.length === 0 || output.length > MAX_OUTPUT_CHARS) return bad("MALFORMED_DELIVERY", "The response text is missing or has an unexpected size.");
  if (typeof responseHash !== "string" || !HEX32.test(responseHash)) return bad("MALFORMED_DELIVERY", "The response hash is not a 32-byte hex value.");
  if (typeof usageAmountMicrounits !== "string" || !DECIMAL.test(usageAmountMicrounits)) return bad("MALFORMED_DELIVERY", "The amount is not a plain whole number of micro-USDC.");

  // 1. The text on screen must be the text the hash commits to.
  if (!same(responseHashOf(output), responseHash)) return bad("HASH_MISMATCH", "The response text does not match its hash. Nothing was signed.");

  // 2. The amount must be positive and within what the customer authorised and the contract reserved.
  const amount = BigInt(usageAmountMicrounits);
  if (!DECIMAL.test(i.quote.maxAmountMicrounits)) return bad("MALFORMED_DELIVERY", "The quoted maximum is malformed.");
  if (amount === 0n || amount > BigInt(i.quote.maxAmountMicrounits) || amount > i.reservation.maxAmount) {
    return bad("AMOUNT_OUT_OF_BOUNDS", "The amount to pay is outside what you authorised for this request. Nothing was signed.");
  }

  // 3. The onchain reservation must be this customer's, for this provider, request and payout, and still open.
  const rs = i.reservation;
  if (rs.status !== 1) return bad("RESERVATION_MISMATCH", "The contract does not show this reservation as open.");
  if (!same(rs.customer, i.customer) || rs.providerId !== i.providerId || !same(rs.requestHash, i.quote.requestHash) || !same(rs.payoutWallet, i.quote.payoutWallet)) {
    return bad("RESERVATION_MISMATCH", "The onchain reservation is not this customer's reservation for this request.");
  }
  if (BigInt(i.now) + BigInt(i.safetyMarginSec ?? 30) >= rs.expiry) return bad("RESERVATION_EXPIRED", "The reservation is about to expire; release it and start again.");

  return {
    ok: true,
    output,
    message: {
      customer: i.customer,
      reservationId: BigInt(i.reservationId),
      responseHash: responseHash as Hex,
      amount,
      nonce: i.nonce,
      deadline: BigInt(Math.min(i.quote.reservationDeadline, Number(rs.expiry)) - 1),
    },
  };
}

/** Verifies the delivery, and only then asks the wallet to sign exactly the verified message. */
export async function signAcceptance(
  input: DeliveryInput,
  sign: (message: AcceptMessage) => Promise<Hex>,
): Promise<{ ok: true; message: AcceptMessage; signature: Hex } | Extract<DeliveryCheck, { ok: false }>> {
  const checked = checkDelivery(input);
  if (!checked.ok) return checked;
  const signature = await sign(checked.message);
  return { ok: true, message: checked.message, signature };
}
