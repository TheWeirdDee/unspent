// Non-authoritative metadata store. Financial truth is always the contract. Raw inputs/outputs are never persisted.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { Address, Hex } from "viem";

export type RequestState =
  | "quoted"
  | "reserving"
  | "reserved"
  | "executing"
  | "delivered"
  | "settling"
  | "settled"
  | "failed_before_service"
  | "service_failed";

export interface RequestRecord {
  requestId: string;
  accessToken: string;
  providerId: string;
  customer: Address;
  inputHash: Hex;
  requestHash: Hex;
  maxAmount: string;
  nonce: string;
  authDeadline: number;
  expiry: number;
  state: RequestState;
  reservationId?: string;
  reserveTx?: Hex;
  settleTx?: Hex;
  responseHash?: Hex;
  serviceModel?: string;
  latencyMs?: number;
  errorCode?: string;
  createdAt: number;
  updatedAt: number;
}

interface Data {
  requests: Record<string, RequestRecord>;
  usage: Record<string, number>; // "YYYY-MM-DD:global" and "YYYY-MM-DD:<customer>" -> model calls started
}

const dir = new URL("../data/", import.meta.url).pathname;
const file = `${dir}state.json`;
let data: Data = { requests: {}, usage: {} };
if (existsSync(file)) {
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    console.error("state.json unreadable; starting empty (chain remains authoritative)");
  }
}
function persist() {
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(data));
  renameSync(`${file}.tmp`, file);
}

export const store = {
  get: (id: string) => data.requests[id],
  all: () => Object.values(data.requests),
  put(r: RequestRecord) {
    r.updatedAt = Date.now();
    data.requests[r.requestId] = r;
    persist();
  },
  usageToday(customer: string) {
    const d = new Date().toISOString().slice(0, 10);
    return { global: data.usage[`${d}:global`] ?? 0, customer: data.usage[`${d}:${customer.toLowerCase()}`] ?? 0 };
  },
  bumpUsage(customer: string) {
    const d = new Date().toISOString().slice(0, 10);
    for (const k of [`${d}:global`, `${d}:${customer.toLowerCase()}`]) data.usage[k] = (data.usage[k] ?? 0) + 1;
    persist();
  },
};
