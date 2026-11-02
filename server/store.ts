// Non-authoritative metadata store. Financial truth is always the contract. Raw prompts and model outputs are never persisted.
//
// Postgres layout (DATABASE_URL set): one row per request plus one counter row per (day, scope), so a write touches only
// the record it belongs to instead of rewriting a single snapshot blob. Counters move with `calls = calls + 1` inside the
// database, so they cannot lose an increment to a read-modify-write race. The store is still created for a single API
// instance: the execution lock lives in the process, not in the table (see docs/hosting.md).
//
// File layout (no DATABASE_URL): the same shape in data/state.json, written atomically. Tests use `createStore` with an
// injected SQL tag, including a real Postgres engine (PGlite) and a tag that fails on purpose.
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

/** Minimal tagged-template SQL surface, satisfied by Bun.SQL and by PGlite in tests. */
export interface SqlTag {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>[]>;
}

const REVOKED = "revoked";
const QUOTE_TTL_MS = 60 * 60_000; // unreserved quotes are dropped after an hour

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export function tokenMatches(rec: { accessTokenHash: string }, token: unknown): boolean {
  if (typeof token !== "string" || rec.accessTokenHash === REVOKED) return false;
  const a = Buffer.from(hashToken(token));
  const b = Buffer.from(rec.accessTokenHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface Store {
  get(id: string): RequestRecord | undefined;
  all(): RequestRecord[];
  prune(): void;
  put(r: RequestRecord): void;
  /** Like `put`, but resolves only once the write is acknowledged and rejects if it failed. */
  putDurable(r: RequestRecord): Promise<void>;
  usageToday(customer: string): { global: number; customer: number };
  bumpUsage(customer: string): Promise<void>;
  revokeAll(): { revoked: number; total: number };
  /** Resolves when every queued write has settled (used by scripts that quit immediately). */
  flush(): Promise<unknown>;
}

export interface CreateStoreOptions {
  /** Postgres-backed when provided; file-backed when null/undefined. */
  sql?: SqlTag | null;
  /** Directory for the file-backed store. Defaults to ../data/ next to this module. */
  dir?: string;
  now?: () => number;
}

const recordOf = (row: Record<string, unknown>): RequestRecord =>
  (typeof row.record === "string" ? JSON.parse(row.record) : row.record) as RequestRecord;

/** Copies a pre-existing `unspent_state` snapshot into the per-row tables. Missing table = nothing to import. */
async function importLegacySnapshot(sql: SqlTag, data: Data): Promise<void> {
  let legacy: Record<string, unknown>[];
  try {
    legacy = await sql`SELECT data FROM unspent_state WHERE id = 1`;
  } catch {
    return; // table absent: a fresh database
  }
  if (!legacy.length) return;
  const snapshot = (typeof legacy[0].data === "string" ? JSON.parse(legacy[0].data as string) : legacy[0].data) as Data;
  const requests = Object.values(snapshot?.requests ?? {});
  for (const r of requests) {
    if (!r?.requestId) continue;
    data.requests[r.requestId] = r;
    await sql`INSERT INTO unspent_requests (request_id, state, created_at, record) VALUES (${r.requestId}, ${r.state}, ${r.createdAt ?? Date.now()}, ${JSON.stringify(r)}::jsonb)
      ON CONFLICT (request_id) DO NOTHING`;
  }
  for (const [key, calls] of Object.entries(snapshot?.usage ?? {})) {
    const [day, scope] = key.split(":");
    if (!day || !scope) continue;
    data.usage[key] = Number(calls);
    await sql`INSERT INTO unspent_usage (day, scope, calls) VALUES (${day}, ${scope}, ${Number(calls)})
      ON CONFLICT (day, scope) DO NOTHING`;
  }
  if (requests.length || Object.keys(snapshot?.usage ?? {}).length) {
    console.log(`imported ${requests.length} request record(s) and ${Object.keys(snapshot?.usage ?? {}).length} usage counter(s) from unspent_state`);
  }
}

export async function createStore(opts: CreateStoreOptions = {}): Promise<Store & { persistence: "postgres" | "file" }> {
  const sql = opts.sql ?? null;
  const now = opts.now ?? Date.now;
  const dir = opts.dir ?? fileURLToPath(new URL("../data/", import.meta.url)); // not .pathname: that yields /C:/... on Windows
  const file = `${dir}state.json`;
  const data: Data = { requests: {}, usage: {} };

  if (sql) {
    await sql`CREATE TABLE IF NOT EXISTS unspent_requests (
      request_id text PRIMARY KEY,
      state text NOT NULL,
      created_at bigint NOT NULL,
      record jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS unspent_requests_state_idx ON unspent_requests (state, created_at)`;
    await sql`CREATE TABLE IF NOT EXISTS unspent_usage (
      day date NOT NULL,
      scope text NOT NULL,
      calls bigint NOT NULL DEFAULT 0,
      PRIMARY KEY (day, scope)
    )`;
    const rows = await sql`SELECT record FROM unspent_requests`;
    for (const row of rows) {
      const r = recordOf(row);
      data.requests[r.requestId] = r;
    }
    const usage = await sql`SELECT day, scope, calls FROM unspent_usage`;
    for (const row of usage) {
      const day = String(row.day instanceof Date ? row.day.toISOString().slice(0, 10) : row.day).slice(0, 10);
      data.usage[`${day}:${row.scope}`] = Number(row.calls);
    }
    // One-time import from the previous single-snapshot layout. Without it, deploying this code would silently drop the
    // records of requests that were in flight at the moment of the deploy (learned from `unspent_state`, which is left
    // in place as a backup rather than deleted).
    if (rows.length === 0) await importLegacySnapshot(sql, data);
  } else if (existsSync(file)) {
    try {
      Object.assign(data, JSON.parse(readFileSync(file, "utf8")) as Data);
    } catch {
      console.error("state.json unreadable; starting empty (chain remains authoritative)");
    }
    // Migrate any legacy plaintext access tokens to hashes.
    let migrated = false;
    for (const r of Object.values(data.requests) as (RequestRecord & { accessToken?: string })[]) {
      if (r.accessToken) {
        r.accessTokenHash = hashToken(r.accessToken);
        delete r.accessToken;
        migrated = true;
      }
    }
    if (migrated) writeFileSync(file, JSON.stringify(data));
  }

  // Writes are serialised in call order and each call returns a promise that settles when THAT write is acknowledged.
  let pending: Promise<unknown> = Promise.resolve();
  const queue = (op: () => Promise<unknown>): Promise<void> => {
    const write = pending.then(op);
    pending = write.catch(() => undefined); // a failed write must not block later ones
    return write.then(() => undefined);
  };
  const persistFile = (): Promise<void> => {
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${file}.tmp`, JSON.stringify(data));
      renameSync(`${file}.tmp`, file);
      return Promise.resolve();
    } catch (e) {
      return Promise.reject(e);
    }
  };
  const persistRecord = (r: RequestRecord): Promise<void> => {
    if (!sql) return persistFile();
    const body = JSON.stringify(r);
    return queue(() =>
      sql`INSERT INTO unspent_requests (request_id, state, created_at, record) VALUES (${r.requestId}, ${r.state}, ${r.createdAt}, ${body}::jsonb)
          ON CONFLICT (request_id) DO UPDATE SET state = EXCLUDED.state, record = EXCLUDED.record, updated_at = now()`
    );
  };
  const persistQuiet = () => {
    (sql ? pending : persistFile()).catch((e) => console.error("state persist failed (chain remains authoritative):", (e as Error).message));
  };
  const day = () => new Date(now()).toISOString().slice(0, 10);
  const today = () => day();

  const store: Store & { persistence: "postgres" | "file" } = {
    persistence: sql ? "postgres" : "file",
    get: (id) => data.requests[id],
    all: () => Object.values(data.requests),
    prune() {
      const cutoff = now() - QUOTE_TTL_MS;
      let n = 0;
      for (const [id, r] of Object.entries(data.requests)) {
        if ((r.state === "quoted" || r.state === "failed_before_service") && now() - r.createdAt > QUOTE_TTL_MS) {
          delete data.requests[id];
          n++;
        }
      }
      if (!n) return;
      if (sql) {
        queue(() =>
          sql`DELETE FROM unspent_requests WHERE state IN ('quoted', 'failed_before_service') AND created_at < ${cutoff}`
        ).catch((e) => console.error("prune failed (chain remains authoritative):", (e as Error).message));
      } else {
        persistQuiet();
      }
    },
    put(r: RequestRecord) {
      r.updatedAt = now();
      data.requests[r.requestId] = r;
      persistRecord(r).catch((e) => console.error("state persist failed (chain remains authoritative):", (e as Error).message));
    },
    /** Like `put`, but resolves only once the write is acknowledged and rejects if it failed. */
    putDurable(r: RequestRecord): Promise<void> {
      r.updatedAt = now();
      data.requests[r.requestId] = r;
      return persistRecord(r);
    },
    usageToday(customer: string) {
      const d = today();
      return { global: data.usage[`${d}:global`] ?? 0, customer: data.usage[`${d}:${customer.toLowerCase()}`] ?? 0 };
    },
    bumpUsage(customer: string): Promise<void> {
      const d = today();
      const keys = [`${d}:global`, `${d}:${customer.toLowerCase()}`];
      if (!sql) {
        for (const k of keys) data.usage[k] = (data.usage[k] ?? 0) + 1;
        return persistFile();
      }
      // One statement for both counters: either the global and per-customer counts move together, or neither does.
      return queue(async () => {
        const rows = await sql`INSERT INTO unspent_usage (day, scope, calls) VALUES (${d}, 'global', 1), (${d}, ${customer.toLowerCase()}, 1)
          ON CONFLICT (day, scope) DO UPDATE SET calls = unspent_usage.calls + 1 RETURNING scope, calls`;
        for (const row of rows) {
          const calls = row.calls;
          data.usage[`${d}:${row.scope}`] = typeof calls === "number" ? calls : Number(calls);
        }
      });
    },
    revokeAll() {
      const all = Object.values(data.requests);
      let revoked = 0;
      for (const r of all) {
        if (r.accessTokenHash !== REVOKED) {
          r.accessTokenHash = REVOKED;
          revoked++;
        }
      }
      if (!sql) persistQuiet();
      else {
        queue(() =>
          sql`UPDATE unspent_requests SET record = jsonb_set(record, '{accessTokenHash}', '"revoked"'), updated_at = now()
              WHERE record->>'accessTokenHash' IS DISTINCT FROM 'revoked'`
        ).catch((e) => console.error("revoke persist failed:", (e as Error).message));
      }
      return { revoked, total: all.length };
    },
    flush: () => pending,
  };
  return store;
}

const DATABASE_URL = process.env.DATABASE_URL;
export const persistence: "postgres" | "file" = DATABASE_URL ? "postgres" : "file";
const sql = DATABASE_URL ? (new Bun.SQL(DATABASE_URL) as unknown as SqlTag) : null;
export const store = await createStore({ sql });
export const flush = () => store.flush();
