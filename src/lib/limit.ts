// Bounds how many RPC reads run at once. Public Arc endpoints answer HTTP 429 on bursts, and a page that renders ~30
// receipts on load is exactly such a burst. Four in flight keeps first paint fast without tripping the limit.
//
// Browser- and Bun-safe, no timers, no Node APIs; the queue is FIFO so no read is starved.

export type Limiter = <T>(fn: () => Promise<T>) => Promise<T>;

export function createLimiter(max: number): Limiter {
  if (!Number.isFinite(max) || max < 1) throw new Error("limiter max must be at least 1");
  let active = 0;
  const queue: (() => void)[] = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((resolve) => queue.push(resolve));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}
