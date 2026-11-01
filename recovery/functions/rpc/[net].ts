// Optional same-origin RPC pass-through for the independent recovery client on Cloudflare Pages.
//
// Why it exists: privacy filter lists (EasyPrivacy ships `||arc.io^$third-party`) make browsers cancel every request to
// *.arc.io hosts from a page on another domain (net::ERR_BLOCKED_BY_CLIENT). A same-origin /rpc/<network> path is not
// affected. This is NOT the UNSPENT API: it forwards JSON-RPC reads to Arc's public RPC and nothing else, holds no state,
// no keys and no secrets, and the client falls back to the direct RPC hosts (and any RPC the user adds) without it.
// Transactions are never sent through here: the user's wallet sends them.

const UPSTREAM: Record<string, string> = {
  mainnet: "https://rpc.mainnet.arc.io",
  testnet: "https://rpc.testnet.arc.io",
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

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export const onRequestPost = async (context: { request: Request; params: { net?: string | string[] } }): Promise<Response> => {
  const net = Array.isArray(context.params.net) ? context.params.net[0] : context.params.net;
  const upstream = net ? UPSTREAM[net] : undefined;
  if (!upstream) return reply(404, { error: "unknown network" });

  const text = await context.request.text();
  if (text.length > 100_000) return reply(413, { error: "request too large" });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return reply(400, { error: "invalid JSON" });
  }
  const calls = Array.isArray(parsed) ? parsed : [parsed];
  const allowed = calls.length > 0 && calls.length <= 20 && calls.every((c) => typeof (c as { method?: unknown })?.method === "string" && READ_ONLY.has((c as { method: string }).method));
  if (!allowed) return reply(403, { error: "only read-only JSON-RPC methods are forwarded" });

  try {
    const r = await fetch(upstream, { method: "POST", headers: { "content-type": "application/json" }, body: text, signal: AbortSignal.timeout(15_000) });
    return new Response(r.body, { status: r.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch {
    return reply(502, { error: "upstream RPC unreachable" });
  }
};
