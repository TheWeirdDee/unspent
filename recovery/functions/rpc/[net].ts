// Optional same-origin RPC pass-through for the independent recovery client on Cloudflare Pages.
//
// Why it exists: privacy filter lists (EasyPrivacy ships `||arc.io^$third-party`) make browsers cancel every request to
// *.arc.io hosts from a page on another domain (net::ERR_BLOCKED_BY_CLIENT). A same-origin /rpc/<network> path is not
// affected. This is NOT the UNSPENT API: it forwards JSON-RPC reads to Arc's public RPC and nothing else, holds no state,
// no keys and no secrets, and the client falls back to the direct RPC hosts (and any RPC the user adds) without it.
// Transactions are never sent through here: the user's wallet sends them.
// Limits in this file: read-only methods, at most 20 calls and 100 KB per request, a 10 s timeout per upstream, and a
// per-client token bucket (see `takeToken`). The bucket lives in module scope, so it is per Cloudflare isolate, not global:
// a client can exceed it by landing on several isolates. It is a cheap abuse brake on top of the host's own rate-limiting
// rules, not a hard quota. The client never depends on this path: it falls back to the direct RPC hosts without it.

// Arc's public endpoints (https://docs.arc.io/arc/references/rpc-endpoints.md), tried in order on a 429, a 5xx or a network
// error. All visitors share this host's address, so the primary endpoint's rate limit is hit sooner than from a browser.
const UPSTREAM: Record<string, string[]> = {
  mainnet: ["https://rpc.mainnet.arc.io", "https://rpc.blockdaemon.mainnet.arc.io", "https://rpc.drpc.mainnet.arc.io", "https://rpc.quicknode.mainnet.arc.io"],
  testnet: ["https://rpc.testnet.arc.io", "https://rpc.blockdaemon.testnet.arc.io", "https://rpc.drpc.testnet.arc.io", "https://rpc.quicknode.testnet.arc.io"],
};

const READ_ONLY = new Set([
  "eth_chainId",
  "net_version",
  "eth_blockNumber",
  "eth_call",
  "eth_getBalance",
  "eth_getCode",
  "eth_getLogs",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getTransactionCount",
  "eth_gasPrice",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_maxPriorityFeePerGas",
]);

const MAX_BODY_BYTES = 100_000;

// ---- per-client token bucket (per isolate) ----
export interface Bucket { tokens: number; updated: number }
export const BUCKET_CAPACITY = 30; // burst
export const BUCKET_REFILL_PER_SEC = 2; // sustained reads per second per client

/** Returns true when the caller may proceed. Pure over the supplied map so it can be tested without a Worker runtime. */
export function takeToken(buckets: Map<string, Bucket>, key: string, now: number): boolean {
  const b = buckets.get(key) ?? { tokens: BUCKET_CAPACITY, updated: now };
  const elapsedSec = Math.max(0, (now - b.updated) / 1000);
  const tokens = Math.min(BUCKET_CAPACITY, b.tokens + elapsedSec * BUCKET_REFILL_PER_SEC);
  if (tokens < 1) {
    buckets.set(key, { tokens, updated: now });
    return false;
  }
  buckets.set(key, { tokens: tokens - 1, updated: now });
  return true;
}

const buckets = new Map<string, Bucket>();

/** Reads the request body but stops (and refuses) as soon as it exceeds the limit, instead of buffering an arbitrary upload first. */
async function readLimited(request: Request, max: number): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export const onRequestPost = async (context: { request: Request; params: { net?: string | string[] } }): Promise<Response> => {
  const net = Array.isArray(context.params.net) ? context.params.net[0] : context.params.net;
  const upstreams = net && Object.hasOwn(UPSTREAM, net) ? UPSTREAM[net] : undefined;
  if (!upstreams) return reply(404, { error: "unknown network" });

  const client = context.request.headers.get("cf-connecting-ip") ?? context.request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anonymous";
  if (!takeToken(buckets, `${net}:${client}`, Date.now())) {
    return new Response(JSON.stringify({ error: "rate limited; retry shortly or use the direct RPC" }), {
      status: 429,
      headers: { "content-type": "application/json", "cache-control": "no-store", "retry-after": "1" },
    });
  }

  if (Number(context.request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return reply(413, { error: "request too large" });
  const text = await readLimited(context.request, MAX_BODY_BYTES);
  if (text === null) return reply(413, { error: "request too large" });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return reply(400, { error: "invalid JSON" });
  }
  const calls = Array.isArray(parsed) ? parsed : [parsed];
  const allowed = calls.length > 0 && calls.length <= 20 && calls.every((c) => typeof (c as { method?: unknown })?.method === "string" && READ_ONLY.has((c as { method: string }).method));
  if (!allowed) return reply(403, { error: "only read-only JSON-RPC methods are forwarded" });

  let last: Response | null = null;
  for (const upstream of upstreams) {
    try {
      const r = await fetch(upstream, { method: "POST", headers: { "content-type": "application/json" }, body: text, signal: AbortSignal.timeout(10_000) });
      if (r.status !== 429 && r.status < 500) return new Response(r.body, { status: r.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
      last = r;
    } catch {
      /* try the next endpoint */
    }
  }
  return last ? new Response(last.body, { status: last.status, headers: { "content-type": "application/json", "cache-control": "no-store" } }) : reply(502, { error: "upstream RPC unreachable" });
};

// Every other method (GET included) is refused explicitly instead of falling through to the static site.
export const onRequest = (): Response => reply(405, { error: "POST a JSON-RPC request" });
