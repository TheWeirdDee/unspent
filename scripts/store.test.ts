// Store tests against a real Postgres engine (PGlite, Postgres compiled to WASM) plus deliberate storage failures.
// These cover the row-level layout, restart reload, atomic counters and the durable-write contract the lifecycle relies on.
import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { createStore, type SqlTag } from "../server/store";
import type { RequestRecord } from "../server/store";

const NOW = 1_790_000_000_000;

function pgliteTag(db: PGlite): SqlTag {
  // PGlite's tagged template returns a result object; the store expects rows.
  return (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const res = await (db.sql as unknown as (s: TemplateStringsArray, ...v: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>)(
      strings,
      ...values
    );
    return res.rows;
  }) as SqlTag;
}

/** Wraps a tag and throws on the Nth statement, to reproduce a storage outage at a chosen point. */
function failingTag(inner: SqlTag, failOn: (sql: string) => boolean): SqlTag {
  return (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    if (failOn(strings.join("?"))) throw new Error("simulated storage failure");
    return inner(strings, ...values);
  }) as SqlTag;
}

function record(id: string, over: Partial<RequestRecord> = {}): RequestRecord {
  return {
    requestId: id,
    accessTokenHash: "hash-" + id,
    providerId: "1",
    customer: "0xE306b8ae6e958F7C8e3401f1f12d550E5DAecab6",
    inputHash: `0x${"11".repeat(32)}`,
    requestHash: `0x${"22".repeat(32)}`,
    maxAmount: "100000",
    nonce: "1",
    authDeadline: NOW / 1000 + 300,
    expiry: NOW / 1000 + 1200,
    state: "quoted",
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as RequestRecord;
}

async function freshStore() {
  const db = new PGlite();
  return { db, store: await createStore({ sql: pgliteTag(db), now: () => NOW }) };
}

describe("postgres store", () => {
  test("reports postgres persistence and starts empty", async () => {
    const { store } = await freshStore();
    expect(store.persistence).toBe("postgres");
    expect(store.all()).toEqual([]);
  });

  test("one row per request: writing one record leaves the other untouched", async () => {
    const { db, store } = await freshStore();
    await store.putDurable(record("req_a", { state: "reserved" }));
    await store.putDurable(record("req_b", { state: "reserved" }));
    await store.putDurable(record("req_a", { state: "delivered", responseHash: `0x${"33".repeat(32)}` }));

    const rows = await db.query<{ request_id: string; state: string }>(
      "SELECT request_id, state FROM unspent_requests ORDER BY request_id"
    );
    expect(rows.rows.map((r) => r.request_id)).toEqual(["req_a", "req_b"]);
    expect(rows.rows.map((r) => r.state)).toEqual(["delivered", "reserved"]);
  });

  test("a new store instance reloads every record from the database", async () => {
    const { db, store } = await freshStore();
    await store.putDurable(record("req_a", { state: "reserved", reservationId: "7" }));
    const reopened = await createStore({ sql: pgliteTag(db), now: () => NOW });
    expect(reopened.get("req_a")?.reservationId).toBe("7");
    expect(reopened.get("req_a")?.state).toBe("reserved");
  });

  test("usage counters increment atomically and survive a reload", async () => {
    const { db, store } = await freshStore();
    const customer = "0xE306b8ae6e958F7C8e3401f1f12d550E5DAecab6";
    await Promise.all(Array.from({ length: 25 }, () => store.bumpUsage(customer)));
    expect(store.usageToday(customer)).toEqual({ global: 25, customer: 25 });

    const reopened = await createStore({ sql: pgliteTag(db), now: () => NOW });
    expect(reopened.usageToday(customer)).toEqual({ global: 25, customer: 25 });
  });

  test("durable writes reject when the database is unavailable", async () => {
    const db = new PGlite();
    const tag = failingTag(pgliteTag(db), (q) => q.includes("INSERT INTO unspent_requests"));
    const store = await createStore({ sql: tag, now: () => NOW });

    await expect(store.putDurable(record("req_a"))).rejects.toThrow("simulated storage failure");
    // Nothing claims a durable record exists when its write failed.
    const rows = await db.query("SELECT * FROM unspent_requests");
    expect(rows.rows).toHaveLength(0);
  });

  test("an interrupted counter update writes neither counter", async () => {
    const db = new PGlite();
    const tag = failingTag(pgliteTag(db), (q) => q.includes("INSERT INTO unspent_usage"));
    const store = await createStore({ sql: tag, now: () => NOW });
    await expect(store.bumpUsage("0xE306b8ae6e958F7C8e3401f1f12d550E5DAecab6")).rejects.toThrow("simulated storage failure");
    const rows = await db.query("SELECT * FROM unspent_usage");
    expect(rows.rows).toHaveLength(0);
    expect(store.usageToday("0xE306b8ae6e958F7C8e3401f1f12d550E5DAecab6")).toEqual({ global: 0, customer: 0 });
  });

  test("a failed write does not block the next one", async () => {
    const db = new PGlite();
    let failNext = true;
    const inner = pgliteTag(db);
    const tag = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (failNext && strings.join("?").includes("INSERT INTO unspent_requests")) {
        failNext = false;
        throw new Error("simulated storage failure");
      }
      return inner(strings, ...values);
    }) as SqlTag;
    const store = await createStore({ sql: tag, now: () => NOW });

    await expect(store.putDurable(record("req_a"))).rejects.toThrow();
    await store.putDurable(record("req_b"));
    await store.flush();
    const rows = await db.query("SELECT request_id FROM unspent_requests");
    expect(rows.rows).toEqual([{ request_id: "req_b" }]);
  });

  test("prune removes stale quotes in the database, not just in memory", async () => {
    const db = new PGlite();
    const store = await createStore({ sql: pgliteTag(db), now: () => NOW });
    const old = NOW - 2 * 60 * 60_000;
    await store.putDurable(record("req_old", { createdAt: old, state: "quoted" }));
    await store.putDurable(record("req_reserved", { createdAt: old, state: "reserved" }));

    store.prune();
    await store.flush();
    const rows = await db.query<{ request_id: string }>("SELECT request_id FROM unspent_requests");
    expect(rows.rows).toEqual([{ request_id: "req_reserved" }]);
    expect(store.get("req_old")).toBeUndefined();
    expect(store.get("req_reserved")).toBeDefined();
  });

  test("revokeAll invalidates every stored token hash in the database too", async () => {
    const { db, store } = await freshStore();
    await store.putDurable(record("req_a"));
    await store.putDurable(record("req_b"));
    const res = store.revokeAll();
    await store.flush();
    expect(res).toEqual({ revoked: 2, total: 2 });

    const rows = await db.query<{ token: string }>(
      "SELECT record->>'accessTokenHash' AS token FROM unspent_requests"
    );
    expect(rows.rows.map((r) => r.token)).toEqual(["revoked", "revoked"]);
  });
});
