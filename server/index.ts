import { recoverTypedDataAddress, isAddress, isHex, keccak256, stringToHex, type Address, type Hex } from "viem";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { ACCEPT_TYPES, RESERVE_TYPES, canonicalRequestHash, responseHashOf, vaultDomain, SERVICE_ID, MAX_INPUT_CHARS } from "../src/lib/protocol";
import { chain, config, dep, NETWORK, PROVIDER_ID, publicClient, relayerAccount, rpcSource, VAULT } from "./config";
import { ApiError, chainNow, findReservedByRequest, readProvider, readReservation, receiptOf, relay, requireVault } from "./chain";
import { store, hashToken, tokenMatches, persistence, type RequestRecord } from "./store";
import { ModelError, modelConfigured, summarise } from "./llm";
import { OutputCache, reconcileAll, reconcileRecord, runExecute, submitReservation, submitSettlement, type ExecDeps, type ReconcileDeps, type SubmitDeps } from "./lifecycle";

// ---- simulated outage (demo only; never touches contract state or recovery routes) ----
const outage = { active: false, since: 0, until: 0, reason: "" };
const outageActive = () => {
  if (outage.active && Date.now() > outage.until) outage.active = false;
  return outage.active;
};
const outageView = () => ({
  active: outageActive(),
  simulated: true,
  label: "SIMULATED APPLICATION BACKEND OUTAGE (controlled demo toggle on the UNSPENT sample service)",
  since: outage.active ? outage.since : null,
  until: outage.active ? outage.until : null,
  reason: outage.active ? outage.reason : null,
});

// ---- tiny in-memory rate limiter (per ip, per minute) ----
const hits = new Map<string, { n: number; t: number }>();
function limited(ip: string, max = 90) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.t > 60_000) {
    hits.set(ip, { n: 1, t: now });
    return false;
  }
  return ++h.n > max;
}

// Cross-origin access is allow-listed. Same-origin (Vite proxy / reverse proxy) needs no CORS.
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean);
const corsHeaders = (origin: string | null): Record<string, string> =>
  origin && ALLOWED_ORIGINS.includes(origin)
    ? { "access-control-allow-origin": origin, vary: "Origin", "access-control-allow-headers": "content-type, authorization", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-max-age": "600" }
    : {};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const addr = z.string().refine(isAddress, "invalid address").transform((a) => a as Address);
const hex = z.string().refine((h) => isHex(h), "invalid hex").transform((h) => h as Hex);
const decimalStr = z.string().regex(/^\d+$/);

// Responses are kept in memory only, for a strict 30 minutes (enforced on every read) and are cleared on restart.
const outputCache = new OutputCache();
const execDeps: ExecDeps = {
  store,
  cache: outputCache,
  inputHashOf: (t) => keccak256(stringToHex(t)),
  responseHashOf,
  readReservation,
  chainNow,
  summarise,
  errorCodeOf: (e) => (e instanceof ModelError ? e.code : "MODEL_UNAVAILABLE"),
  limits: { dailyGlobal: config.llm.dailyGlobal, dailyPerCustomer: config.llm.dailyPerCustomer, executeSafetyMarginSec: config.executeSafetyMarginSec },
};
const submitDeps: SubmitDeps = { store, relay: (fn, args, opts) => relay(fn, args, opts) as ReturnType<SubmitDeps["relay"]> };
const reconcileDeps: ReconcileDeps = { store, receiptOf, readReservation, findReserved: (c, h) => findReservedByRequest(c as Address, h as Hex) };
const reconcilePending = async (rec: RequestRecord) => {
  if (rec.state === "reserving" || rec.state === "settling") await reconcileRecord(rec, reconcileDeps).catch(() => false);
};

function publicRecord(r: RequestRecord) {
  return {
    requestId: r.requestId,
    providerId: r.providerId,
    customer: r.customer,
    state: r.state,
    reservationId: r.reservationId ?? null,
    reserveTx: r.reserveTx ?? null,
    settleTx: r.settleTx ?? null,
    requestHash: r.requestHash,
    responseHash: r.responseHash ?? null,
    maxAmountMicrounits: r.maxAmount,
    authDeadline: r.authDeadline,
    expiry: r.expiry,
    serviceModel: r.serviceModel ?? null,
    latencyMs: r.latencyMs ?? null,
    errorCode: r.errorCode ?? null,
  };
}

function authorised(r: RequestRecord | undefined, token: unknown): RequestRecord {
  if (!r) throw new ApiError(404, "NOT_FOUND", "Unknown request");
  if (!tokenMatches(r, token)) throw new ApiError(403, "FORBIDDEN", "Invalid request access token");
  return r;
}

async function providerInfo() {
  if (!PROVIDER_ID) throw new ApiError(503, "NOT_DEPLOYED", "No provider is registered for this network");
  const p = await readProvider(PROVIDER_ID);
  return {
    providerId: PROVIDER_ID.toString(),
    name: "TextLab API",
    service: SERVICE_ID,
    description: "Summarises text into three bullet points using a real language model.",
    priceMicrounits: config.priceMicro.toString(),
    displayPriceUsdc: "0.10",
    isDemo: true,
    verifiedByUnspent: false,
    onchain: { owner: p.owner, payoutWallet: p.payoutWallet, payoutVersion: p.payoutVersion, active: p.active, metadataHash: p.metadataHash },
    contract: VAULT,
    chainId: dep.chainId,
  };
}

async function route(req: Request, url: URL, ip: string): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, "");
  const m = req.method;
  const body = m === "POST" ? await req.json().catch(() => ({})) : {};

  if (path === "/api/v1/health" && m === "GET") {
    const version = process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? "dev";
    let chainOk = false;
    let head: string | null = null;
    try {
      head = (await publicClient.getBlockNumber()).toString();
      chainOk = true;
    } catch {
      /* reported below */
    }
    return json({
      ok: !outageActive(),
      service: "unspent-sample-api",
      version,
      network: NETWORK,
      chainId: chain.id,
      contract: VAULT ?? null,
      rpc: { source: rpcSource, reachable: chainOk, head },
      relayerConfigured: Boolean(relayerAccount),
      modelConfigured: modelConfigured(),
      persistence,
      outage: outageView(),
    });
  }

  if (path === "/api/v1/demo/outage" && m === "POST") {
    const b = z.object({ token: z.string(), active: z.boolean(), minutes: z.number().min(1).max(30).default(10), reason: z.string().max(200).default("Controlled demo of recovery without the billing backend") }).parse(body);
    if (!config.operatorToken || hashToken(b.token) !== hashToken(config.operatorToken)) throw new ApiError(403, "FORBIDDEN", "Invalid operator token");
    outage.active = b.active;
    outage.since = Date.now();
    outage.until = Date.now() + b.minutes * 60_000;
    outage.reason = b.reason;
    return json({ outage: outageView() });
  }

  // Everything below is the "normal billing backend". The simulated outage blocks all of it.
  if (outageActive()) {
    return json({ code: "SIMULATED_OUTAGE", message: "Simulated backend outage is active. Onchain balances and the recovery client are unaffected.", outage: outageView() }, 503);
  }
  if (limited(ip)) throw new ApiError(429, "RATE_LIMITED", "Too many requests");

  if (path === "/api/v1/providers" && m === "GET") return json({ providers: [await providerInfo()] });
  const pm = path.match(/^\/api\/v1\/providers\/(\d+)$/);
  if (pm && m === "GET") {
    if (!PROVIDER_ID || pm[1] !== PROVIDER_ID.toString()) throw new ApiError(404, "NOT_FOUND", "Unknown provider");
    return json(await providerInfo());
  }

  if (path === "/api/v1/usage/quote" && m === "POST") {
    const b = z.object({ customer: addr, providerId: decimalStr, inputHash: hex }).parse(body);
    if (!PROVIDER_ID || b.providerId !== PROVIDER_ID.toString()) throw new ApiError(404, "NOT_FOUND", "Unknown provider");
    const p = await readProvider(PROVIDER_ID);
    if (!p.active) throw new ApiError(409, "PROVIDER_INACTIVE", "Provider is not accepting new requests");
    const requestId = `req_${randomUUID().replace(/-/g, "")}`;
    const now = await chainNow();
    store.prune();
    const accessToken = randomBytes(24).toString("hex");
    const rec: RequestRecord = {
      requestId,
      accessTokenHash: hashToken(accessToken),
      providerId: b.providerId,
      customer: b.customer,
      inputHash: b.inputHash,
      requestHash: canonicalRequestHash({ requestId, providerId: b.providerId, customer: b.customer, inputHash: b.inputHash }),
      maxAmount: config.priceMicro.toString(),
      nonce: BigInt("0x" + randomBytes(16).toString("hex")).toString(),
      authDeadline: now + config.authWindowSec,
      expiry: now + config.reservationSec,
      state: "quoted",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    store.put(rec);
    return json({
      requestId,
      accessToken, // returned once, to the requester only
      providerId: rec.providerId,
      service: SERVICE_ID,
      maxAmountMicrounits: rec.maxAmount,
      displayAmountUsdc: "0.10",
      requestHash: rec.requestHash,
      nonce: rec.nonce,
      authDeadline: rec.authDeadline,
      reservationDeadline: rec.expiry,
      payoutWallet: p.payoutWallet,
      payoutVersion: p.payoutVersion,
      chainId: dep.chainId,
      contract: requireVault(),
    });
  }

  if (path === "/api/v1/usage/reservations" && m === "POST") {
    const b = z.object({ requestId: z.string(), accessToken: z.string(), signature: hex }).parse(body);
    const rec = authorised(store.get(b.requestId), b.accessToken);
    await reconcilePending(rec); // a submission whose confirmation was not seen yet may have landed since
    if (rec.state === "reserved" || rec.state === "executing" || rec.state === "delivered" || rec.state === "settled" || rec.state === "settling") {
      return json({ ...publicRecord(rec), idempotentReplay: true });
    }
    if (rec.state === "reserving") throw new ApiError(409, "IN_PROGRESS", "Reservation is already being submitted");
    if (rec.state !== "quoted") throw new ApiError(409, "INVALID_STATE", `Request is ${rec.state}`);
    const p = await readProvider(BigInt(rec.providerId));
    const message = {
      customer: rec.customer,
      providerId: BigInt(rec.providerId),
      payoutWallet: p.payoutWallet,
      payoutVersion: p.payoutVersion,
      requestHash: rec.requestHash,
      maxAmount: BigInt(rec.maxAmount),
      nonce: BigInt(rec.nonce),
      authDeadline: BigInt(rec.authDeadline),
      expiry: BigInt(rec.expiry),
    };
    const signer = await recoverTypedDataAddress({ domain: vaultDomain(dep.chainId, requireVault()), types: RESERVE_TYPES, primaryType: "ReserveAuthorisation", message, signature: b.signature }).catch(() => null);
    if (signer?.toLowerCase() !== rec.customer.toLowerCase()) throw new ApiError(400, "INVALID_SIGNATURE", "Signature does not match the quoted authorisation");
    await submitReservation(rec, message, b.signature, submitDeps);
    return json(publicRecord(rec));
  }

  const em = path.match(/^\/api\/v1\/usage\/(req_[a-f0-9]+)\/execute$/);
  if (em && m === "POST") {
    const b = z.object({ accessToken: z.string(), text: z.string().min(1).max(MAX_INPUT_CHARS) }).parse(body);
    const rec = authorised(store.get(em[1]), b.accessToken);
    const { output, replay } = await runExecute(rec, b.text, execDeps);
    return json({ ...publicRecord(rec), output, usageAmountMicrounits: rec.maxAmount, ...(replay ? { outputAvailable: true, idempotentReplay: true } : { deliveryStatus: "delivered_awaiting_acceptance" }) });
  }

  const am = path.match(/^\/api\/v1\/usage\/(req_[a-f0-9]+)\/accept$/);
  if (am && m === "POST") {
    const b = z.object({ accessToken: z.string(), signature: hex, nonce: decimalStr, deadline: decimalStr }).parse(body);
    const rec = authorised(store.get(am[1]), b.accessToken);
    await reconcilePending(rec);
    // A second acceptance for an already-settled request must FAIL. The contract would also revert (ReservationNotOpen).
    if (rec.state === "settled") throw new ApiError(409, "ALREADY_SETTLED", "This request was already settled; a replayed acceptance is rejected and no new transaction is sent.", { settleTx: rec.settleTx });
    if (rec.state === "settling") throw new ApiError(409, "IN_PROGRESS", "Settlement is already being submitted");
    if (rec.state !== "delivered" || !rec.reservationId || !rec.responseHash) throw new ApiError(409, "INVALID_STATE", `Request is ${rec.state}`);
    const message = { customer: rec.customer, reservationId: BigInt(rec.reservationId), responseHash: rec.responseHash, amount: BigInt(rec.maxAmount), nonce: BigInt(b.nonce), deadline: BigInt(b.deadline) };
    const signer = await recoverTypedDataAddress({ domain: vaultDomain(dep.chainId, requireVault()), types: ACCEPT_TYPES, primaryType: "DeliveryAcceptance", message, signature: b.signature }).catch(() => null);
    if (signer?.toLowerCase() !== rec.customer.toLowerCase()) throw new ApiError(400, "INVALID_SIGNATURE", "Acceptance signature does not match the delivered response");
    await submitSettlement(rec, message, b.signature, submitDeps);
    return json(publicRecord(rec));
  }

  const gm = path.match(/^\/api\/v1\/usage\/(req_[a-f0-9]+)$/);
  if (gm && m === "GET") {
    const rec = authorised(store.get(gm[1]), req.headers.get("authorization")?.replace(/^Bearer\s+/i, ""));
    await reconcilePending(rec);
    const chainState = rec.reservationId ? await readReservation(BigInt(rec.reservationId)).catch(() => null) : null;
    return json({ ...publicRecord(rec), onchainStatus: chainState?.statusName ?? null, output: outputCache.get(rec.requestId) ?? null });
  }

  if (path === "/api/v1/provider/overview" && m === "GET") {
    const settled = store.all().filter((r) => r.state === "settled");
    return json({
      note: "Offchain service records only. Revenue and liabilities are authoritative onchain.",
      requestsServed: settled.length,
      recent: settled.slice(-10).reverse().map((r) => ({ requestId: r.requestId, customer: r.customer, reservationId: r.reservationId, settleTx: r.settleTx, responseHash: r.responseHash })),
    });
  }

  throw new ApiError(404, "NOT_FOUND", `No route ${m} ${path}`);
}

const server = Bun.serve({
  port: config.port,
  hostname: "0.0.0.0",
  async fetch(req, srv) {
    const url = new URL(req.url);
    const ip = (req.headers.get("x-forwarded-for")?.split(",")[0].trim() || srv.requestIP(req)?.address) ?? "unknown";
    const cors = corsHeaders(req.headers.get("origin"));
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const withCors = (res: Response) => {
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    };
    try {
      return withCors(await route(req, url, ip));
    } catch (e) {
      if (e instanceof ApiError) return withCors(json({ code: e.code, message: e.message, ...e.extra }, e.status));
      if (e instanceof z.ZodError) return withCors(json({ code: "BAD_REQUEST", message: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400));
      console.error(e);
      return withCors(json({ code: "INTERNAL", message: "Unexpected server error" }, 500));
    }
  },
});
console.log(`unspent api on :${server.port} network=${NETWORK} vault=${VAULT} provider=${PROVIDER_ID} rpc=${rpcSource} model=${modelConfigured() ? config.llm.model : "NOT CONFIGURED"}`);
// Bring records left in a transitional state by a restart in line with the chain (never calls the model or the relayer).
reconcileAll(reconcileDeps).then((r) => { if (r.checked) console.log(`reconciled ${r.changed}/${r.checked} interrupted request record(s)`); }).catch((e) => console.error("startup reconcile failed:", (e as Error).message));
