// Retry with exponential backoff and jitter for public-RPC reads.
//
// Arc's public endpoints answer HTTP 429 on bursts and reject very wide eth_getLogs ranges, and a cold mobile network
// drops requests. None of that is a reason to fail a page load, so reads retry a bounded number of times with growing
// delays. Writes never go through here: a relayer transaction or a wallet signature is never retried automatically,
// because a duplicate submission is a different (and worse) problem than a slow read.
//
// Browser- and Bun-safe: no Node APIs, and `sleep` is injectable so tests do not wait.

export interface RetryOptions {
  /** Total attempts, including the first. Default 3. */
  attempts?: number;
  /** First delay in milliseconds; doubles per attempt. Default 300. */
  baseMs?: number;
  /** Upper bound for a single delay. Default 4000. */
  maxMs?: number;
  /** Jitter fraction (0 to 1) applied to each delay. Default 0.25. */
  jitter?: number;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected for tests. Defaults to `isTransientRpcError`. */
  isRetryable?: (e: unknown) => boolean;
  /** Injected for tests. */
  random?: () => number;
  /** Called before each retry, for logging and counters. */
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** True for rate limits, timeouts, 5xx and dropped connections; false for deterministic errors such as a revert. */
export function isTransientRpcError(e: unknown): boolean {
  const err = e as { status?: number; statusCode?: number; code?: number | string; message?: string; shortMessage?: string; details?: string; name?: string };
  const status = err.status ?? err.statusCode;
  if (typeof status === "number" && (status === 429 || status >= 500)) return true;
  if (err.code === 429 || err.code === -32005) return true; // -32005: provider rate limit
  const text = `${err.message ?? ""} ${err.shortMessage ?? ""} ${err.details ?? ""} ${err.name ?? ""}`.toLowerCase();
  return (
    text.includes("429") ||
    text.includes("too many requests") ||
    text.includes("rate limit") ||
    text.includes("requested range too large") ||
    text.includes("timeout") ||
    text.includes("timed out") ||
    text.includes("econnreset") ||
    text.includes("fetch failed") ||
    text.includes("socket hang up") ||
    text.includes("502") ||
    text.includes("503") ||
    text.includes("504")
  );
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const baseMs = opts.baseMs ?? 300;
  const maxMs = opts.maxMs ?? 4000;
  const jitter = opts.jitter ?? 0.25;
  const sleep = opts.sleep ?? defaultSleep;
  const isRetryable = opts.isRetryable ?? isTransientRpcError;
  const random = opts.random ?? Math.random;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt === attempts || !isRetryable(e)) throw e;
      const raw = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
      const delayMs = Math.round(raw * (1 - jitter + random() * jitter * 2));
      opts.onRetry?.({ attempt, delayMs, error: e });
      await sleep(delayMs);
    }
  }
  throw lastError;
}
