// Tests for the read-retry helper and the recovery relay's token bucket. No network, no timers: both take injected time.
import { describe, expect, test } from "bun:test";
import { isTransientRpcError, withRetry } from "../src/lib/retry";
import { createLimiter } from "../src/lib/limit";
import { BUCKET_CAPACITY, BUCKET_REFILL_PER_SEC, takeToken, type Bucket } from "../recovery/functions/rpc/[net]";

const noSleep = async () => {};

describe("withRetry", () => {
  test("returns the first successful result without retrying", async () => {
    let calls = 0;
    const value = await withRetry(async () => {
      calls++;
      return "ok";
    }, { sleep: noSleep });
    expect(value).toBe("ok");
    expect(calls).toBe(1);
  });

  test("retries a rate limit and then succeeds", async () => {
    let calls = 0;
    const delays: number[] = [];
    const value = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw Object.assign(new Error("429 Too Many Requests"), { status: 429 });
        return calls;
      },
      { attempts: 4, baseMs: 10, jitter: 0, sleep: async (ms) => void delays.push(ms) },
    );
    expect(value).toBe(3);
    expect(delays).toEqual([10, 20]); // exponential, capped by maxMs
  });

  test("does not retry a deterministic error", async () => {
    let calls = 0;
    const err = Object.assign(new Error("execution reverted"), { name: "ContractFunctionExecutionError" });
    await expect(
      withRetry(async () => {
        calls++;
        throw err;
      }, { sleep: noSleep }),
    ).rejects.toThrow("execution reverted");
    expect(calls).toBe(1);
  });

  test("gives up after the last attempt and rethrows the original error", async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw Object.assign(new Error("503 Service Unavailable"), { status: 503 });
      }, { attempts: 3, baseMs: 1, sleep: noSleep }),
    ).rejects.toThrow("503");
    expect(calls).toBe(3);
  });

  test("reports each retry with its delay", async () => {
    const seen: number[] = [];
    await withRetry(
      async () => {
        throw new Error("timeout");
      },
      { attempts: 2, baseMs: 5, jitter: 0, sleep: noSleep, onRetry: ({ delayMs }) => seen.push(delayMs) },
    ).catch(() => undefined);
    expect(seen).toEqual([5]);
  });

  test("classifies transient and terminal errors", () => {
    expect(isTransientRpcError({ status: 429 })).toBe(true);
    expect(isTransientRpcError({ status: 502 })).toBe(true);
    expect(isTransientRpcError({ code: -32005 })).toBe(true);
    expect(isTransientRpcError(new Error("requested range too large"))).toBe(true);
    expect(isTransientRpcError(new Error("fetch failed"))).toBe(true);
    expect(isTransientRpcError(new Error("execution reverted: InsufficientAvailable"))).toBe(false);
    expect(isTransientRpcError({ status: 400 })).toBe(false);
  });
});

describe("concurrency limiter", () => {
  test("never runs more than the limit at once", async () => {
    const run = createLimiter(2);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        run(async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
          return i;
        }),
      ),
    );
    expect(peak).toBe(2);
  });

  test("returns every result and releases slots after a failure", async () => {
    const run = createLimiter(1);
    await expect(run(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    // A failed read must not leak its slot, or later reads would hang forever.
    const next = await run(async () => "after");
    expect(next).toBe("after");
    const many = await Promise.all([1, 2, 3].map((n) => run(async () => n)));
    expect(many).toEqual([1, 2, 3]);
  });

  test("rejects an invalid limit instead of silently serialising", () => {
    expect(() => createLimiter(0)).toThrow();
  });
});

describe("relay token bucket", () => {
  test("allows a burst up to capacity, then refuses", () => {
    const m = new Map<string, Bucket>();
    const now = 1_000_000;
    for (let i = 0; i < BUCKET_CAPACITY; i++) expect(takeToken(m, "mainnet:1.2.3.4", now)).toBe(true);
    expect(takeToken(m, "mainnet:1.2.3.4", now)).toBe(false);
  });

  test("refills over time", () => {
    const m = new Map<string, Bucket>();
    const now = 1_000_000;
    for (let i = 0; i < BUCKET_CAPACITY; i++) takeToken(m, "mainnet:1.2.3.4", now);
    expect(takeToken(m, "mainnet:1.2.3.4", now)).toBe(false);
    const later = now + (1000 / BUCKET_REFILL_PER_SEC) * 2;
    expect(takeToken(m, "mainnet:1.2.3.4", later)).toBe(true);
  });

  test("keeps clients independent", () => {
    const m = new Map<string, Bucket>();
    const now = 1_000_000;
    for (let i = 0; i < BUCKET_CAPACITY; i++) takeToken(m, "mainnet:a", now);
    expect(takeToken(m, "mainnet:a", now)).toBe(false);
    expect(takeToken(m, "mainnet:b", now)).toBe(true);
    expect(takeToken(m, "testnet:a", now)).toBe(true);
  });
});
