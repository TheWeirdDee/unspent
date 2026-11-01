import { keccak256, stringToHex, type Address, type Hex } from "viem";

/** Mirrors UnspentVault's EIP-712 schema exactly. */
export const RESERVE_TYPES = {
  ReserveAuthorisation: [
    { name: "customer", type: "address" },
    { name: "providerId", type: "uint256" },
    { name: "payoutWallet", type: "address" },
    { name: "payoutVersion", type: "uint32" },
    { name: "requestHash", type: "bytes32" },
    { name: "maxAmount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "authDeadline", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
} as const;

export const ACCEPT_TYPES = {
  DeliveryAcceptance: [
    { name: "customer", type: "address" },
    { name: "reservationId", type: "uint256" },
    { name: "responseHash", type: "bytes32" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export function vaultDomain(chainId: number, vault: Address) {
  return { name: "UnspentVault", version: "1", chainId, verifyingContract: vault } as const;
}

export interface ReserveMessage {
  customer: Address;
  providerId: bigint;
  payoutWallet: Address;
  payoutVersion: number;
  requestHash: Hex;
  maxAmount: bigint;
  nonce: bigint;
  authDeadline: bigint;
  expiry: bigint;
}

export interface AcceptMessage {
  customer: Address;
  reservationId: bigint;
  responseHash: Hex;
  amount: bigint;
  nonce: bigint;
  deadline: bigint;
}

export const SERVICE_ID = "textlab.summarise.v1";
export const MAX_INPUT_CHARS = 4000;

/** Hash of the private input. Only this hash ever leaves the browser into the onchain request hash. */
export function inputHash(text: string): Hex {
  return keccak256(stringToHex(text));
}

/** Canonical request hash: binds service, request id, provider, customer and the input hash. */
export function canonicalRequestHash(p: { requestId: string; providerId: string; customer: Address; inputHash: Hex }): Hex {
  const canonical = JSON.stringify({
    service: SERVICE_ID,
    requestId: p.requestId,
    providerId: p.providerId,
    customer: p.customer.toLowerCase(),
    inputHash: p.inputHash,
  });
  return keccak256(stringToHex(canonical));
}

export function responseHashOf(output: string): Hex {
  return keccak256(stringToHex(output));
}

export const RESERVATION_STATUS = ["None", "Reserved", "Settled", "Released"] as const;
export type ReservationStatusName = (typeof RESERVATION_STATUS)[number];
