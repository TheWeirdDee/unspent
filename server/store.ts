// Non-authoritative metadata store. Financial truth is always the contract. Raw inputs/outputs are never persisted.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
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
  accessTokenHash: string; // sha256 of the bearer token; the token itself is never stored
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
  /** Hash of a relayer transaction that was broadcast and whose receipt has not been reconciled yet. */
  pendingTx?: Hex;
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

const dir = fileURLToPath(new URL("../data/", import.meta.url)); // not .pathname: that yields /C:/... on Windows
const file = `${dir}state.json`;
let data: Data = { requests: {}, usage: {} };

// Durable mode: DATABASE_URL (Postgres, e.g. Neon free tier). One row holds the whole non-authoritative state.
// Single API instance only; the chain, not this table, is the source of financial truth.
const DATABASE_URL = process.env.DATABASE_URL;
export const persistence: "postgres" | "file" = DATABASE_URL ? "postgres" : "file";
const sql = DATABASE_URL ? new Bun.SQL(DATABASE_URL) : null;
if (sql) {
  await sql`CREATE TABLE IF NOT EXISTS unspent_state (id int PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`;
  const rows = await sql`SELECT data FROM unspent_state WHERE id = 1`;
  if (rows.length) data = (typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data) as Data;
}
if (!sql && existsSync(file)) {
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    console.error("state.json unreadable; starting empty (chain remains authoritative)");
  }
  // Migrate any legacy plaintext access tokens to hashes.
  let migrated = false;
  for (const r of Object.values(data.requests) as (RequestRecord & { accessToken?: string })[]) {
    if (r.accessToken) {
      r.accessTokenHash = createHash("sha256").update(r.accessToken).digest("hex");
      delete r.accessToken;
      migrated = true;
    }
  }
  if (migrated && !sql) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(data));
  }
}
// Writes are serialised in call order and each call returns a promise that settles when THAT write is acknowledged.
// `put` does not wait (cosmetic updates); `putDurable` does, and rejects if the write failed, so irreversible steps
// (the paid model call, a relayer broadcast) are only taken after their intent is recorded.
let pending: Promise<unknown> = Promise.resolve();
function persist(): Promise<void> {
  if (sql) {
    const snapshot = JSON.stringify(data);
    const write = pending.then(() => sql`INSERT INTO unspent_state (id, data) VALUES (1, ${snapshot}::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`);
    pending = write.catch(() => undefined); // a failed write must not block later ones
    return write.then(() => undefined);
  }
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify(data));
    renameSync(`${file}.tmp`, file);
    return Promise.resolve();
  } catch (e) {
    return Promise.reject(e);
  }
}
const persistQuiet = () => {
  persist().catch((e) => console.error("state persist failed (chain remains authoritative):", (e as Error).message));
};

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
export function tokenMatches(rec: { accessTokenHash: string }, token: unknown): boolean {
  if (typeof token !== "string" || rec.accessTokenHash === REVOKED) return false;
  const a = Buffer.from(hashToken(token));
  const b = Buffer.from(rec.accessTokenHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

const QUOTE_TTL_MS = 60 * 60_000; // unreserved quotes are dropped after an hour

/** Invalidates every bearer token ever issued (used after the dev-server exposure). Records are kept; tokens are not. */
function revokeAll(): { revoked: number; total: number } {
  const all = Object.values(data.requests);
  let revoked = 0;
  for (const r of all) {
    if (r.accessTokenHash !== REVOKED) { r.accessTokenHash = REVOKED; revoked++; }
  }
  persistQuiet();
  return { revoked, total: all.length };
}
const REVOKED = "revoked";
export const flush = () => pending;

export const store = {
  revokeAll,
  get: (id: string) => data.requests[id],
  all: () => Object.values(data.requests),
  prune() {
    const now = Date.now();
    let n = 0;
    for (const [id, r] of Object.entries(data.requests)) if ((r.state === "quoted" || r.state === "failed_before_service") && now - r.createdAt > QUOTE_TTL_MS) { delete data.requests[id]; n++; }
    if (n) persistQuiet();
  },
  put(r: RequestRecord) {
    r.updatedAt = Date.now();
    data.requests[r.requestId] = r;
    persistQuiet();
  },
  /** Like `put`, but resolves only once the write is acknowledged and rejects if it failed. */
  putDurable(r: RequestRecord): Promise<void> {
    r.updatedAt = Date.now();
    data.requests[r.requestId] = r;
    return persist();
  },
  usageToday(customer: string) {
    const d = new Date().toISOString().slice(0, 10);
    return { global: data.usage[`${d}:global`] ?? 0, customer: data.usage[`${d}:${customer.toLowerCase()}`] ?? 0 };
  },
  bumpUsage(customer: string): Promise<void> {
    const d = new Date().toISOString().slice(0, 10);
    for (const k of [`${d}:global`, `${d}:${customer.toLowerCase()}`]) data.usage[k] = (data.usage[k] ?? 0) + 1;
    return persist();
  },
};
