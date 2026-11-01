import { recoverTypedDataAddress, isAddress, isHex, type Address, type Hex } from "viem";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { ACCEPT_TYPES, RESERVE_TYPES, canonicalRequestHash, responseHashOf, vaultDomain, SERVICE_ID, MAX_INPUT_CHARS } from "../src/lib/protocol";
import { chain, config, dep, NETWORK, PROVIDER_ID, publicClient, relayerAccount, rpcSource, VAULT } from "./config";
import { ApiError, chainNow, readProvider, readReservation, relay, requireVault } from "./chain";
import { store, type RequestRecord } from "./store";
import { ModelError, modelConfigured, summarise } from "./llm";

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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const addr = z.string().refine(isAddress, "invalid address").transform((a) => a as Address);
const hex = z.string().refine((h) => isHex(h), "invalid hex").transform((h) => h as Hex);
const decimalStr = z.string().regex(/^\d+$/);

const outputCache = new Map<string, { output: string; at: number }>();
const sweep = () => {
  for (const [k, v] of outputCache) if (Date.now() - v.at > 30 * 60_000) outputCache.delete(k);
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
  if (typeof token !== "string" || token !== r.accessToken) throw new ApiError(403, "FORBIDDEN", "Invalid request access token");
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
      network: NETWORK,
      chainId: chain.id,
      contract: VAULT ?? null,
      rpc: { source: rpcSource, reachable: chainOk, head },
      relayerConfigured: Boolean(relayerAccount),
      modelConfigured: modelConfigured(),
      outage: outageView(),
    });
  }

  if (path === "/api/v1/demo/outage" && m === "POST") {
    const b = z.object({ token: z.string(), active: z.boolean(), minutes: z.number().min(1).max(30).default(10), reason: z.string().max(200).default("Controlled demo of recovery without the billing backend") }).parse(body);
    if (!config.operatorToken || b.token !== config.operatorToken) throw new ApiError(403, "FORBIDDEN", "Invalid operator token");
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
    const rec: RequestRecord = {
      requestId,
      accessToken: randomBytes(24).toString("hex"),
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
      accessToken: rec.accessToken,
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
    rec.state = "reserving";
    store.put(rec);
    try {
      const { hash, logs } = await relay("reserveWithSignature", [message, b.signature]);
      const ev = logs.find((l) => l.eventName === "UsageReserved");
      if (!ev || ev.eventName !== "UsageReserved") throw new ApiError(502, "TX_REVERTED", "UsageReserved event missing");
      rec.reservationId = ev.args.reservationId.toString();
      rec.reserveTx = hash;
      rec.state = "reserved";
      store.put(rec);
      return json(publicRecord(rec));
    } catch (e) {
      rec.state = "failed_before_service";
      rec.errorCode = e instanceof ApiError ? e.code : "UNKNOWN";
      store.put(rec);
      throw e;
    }
  }

  const em = path.match(/^\/api\/v1\/usage\/(req_[a-f0-9]+)\/execute$/);
  if (em && m === "POST") {
    const b = z.object({ accessToken: z.string(), text: z.string().min(1).max(MAX_INPUT_CHARS) }).parse(body);
    const rec = authorised(store.get(em[1]), b.accessToken);
    if (rec.state === "delivered" || rec.state === "settling" || rec.state === "settled") {
      const cached = outputCache.get(rec.requestId);
      return json({ ...publicRecord(rec), output: cached?.output ?? null, outputAvailable: Boolean(cached), idempotentReplay: true });
    }
    if (rec.state !== "reserved") throw new ApiError(409, "INVALID_STATE", `Request is ${rec.state}; a reservation must be confirmed first`);
    if (!rec.reservationId) throw new ApiError(409, "INVALID_STATE", "No reservation");
    const { keccak256, stringToHex } = await import("viem");
    if (keccak256(stringToHex(b.text)) !== rec.inputHash) throw new ApiError(400, "INPUT_MISMATCH", "Text does not match the quoted input hash");
    // Execute only if the CONTRACT confirms an open reservation matching this exact request.
    const r = await readReservation(BigInt(rec.reservationId));
    const now = await chainNow();
    if (r.statusName !== "Reserved") throw new ApiError(409, r.statusName === "Settled" ? "ALREADY_SETTLED" : "RESERVATION_NOT_OPEN", `Reservation is ${r.statusName}`);
    if (r.customer.toLowerCase() !== rec.customer.toLowerCase() || r.providerId.toString() !== rec.providerId || r.maxAmount.toString() !== rec.maxAmount || r.requestHash !== rec.requestHash) {
      throw new ApiError(409, "RESERVATION_MISMATCH", "Onchain reservation does not match the quoted request");
    }
    if (now + config.executeSafetyMarginSec >= Number(r.expiry)) throw new ApiError(409, "RESERVATION_EXPIRED", "Too little time remains before the reservation expires");
    const use = store.usageToday(rec.customer);
    if (use.global >= config.llm.dailyGlobal || use.customer >= config.llm.dailyPerCustomer) {
      throw new ApiError(429, "BUDGET_EXHAUSTED", "Sample model budget exhausted for today. Your reserved credit stays safe and is releasable after expiry.");
    }
    rec.state = "executing";
    store.put(rec);
    store.bumpUsage(rec.customer); // counted before the call: a verified reservation is never charged to a second model call
    try {
      const out = await summarise(b.text);
      rec.responseHash = responseHashOf(out.output);
      rec.serviceModel = out.model;
      rec.latencyMs = out.latencyMs;
      rec.state = "delivered";
      store.put(rec);
      outputCache.set(rec.requestId, { output: out.output, at: Date.now() });
      sweep();
      return json({ ...publicRecord(rec), output: out.output, usageAmountMicrounits: rec.maxAmount, deliveryStatus: "delivered_awaiting_acceptance" });
    } catch (e) {
      rec.state = "service_failed";
      rec.errorCode = e instanceof ModelError ? e.code : "MODEL_UNAVAILABLE";
      store.put(rec);
      throw new ApiError(502, rec.errorCode, `No completed result: ${(e as Error).message}. Your reserved credit stays reserved until it expires, then you can release it.`, { requestId: rec.requestId, reservationId: rec.reservationId, expiry: rec.expiry });
    }
  }

  const am = path.match(/^\/api\/v1\/usage\/(req_[a-f0-9]+)\/accept$/);
  if (am && m === "POST") {
    const b = z.object({ accessToken: z.string(), signature: hex, nonce: decimalStr, deadline: decimalStr }).parse(body);
    const rec = authorised(store.get(am[1]), b.accessToken);
    if (rec.state === "settled") return json({ ...publicRecord(rec), idempotentReplay: true });
    if (rec.state === "settling") throw new ApiError(409, "IN_PROGRESS", "Settlement is already being submitted");
    if (rec.state !== "delivered" || !rec.reservationId || !rec.responseHash) throw new ApiError(409, "INVALID_STATE", `Request is ${rec.state}`);
    const message = { customer: rec.customer, reservationId: BigInt(rec.reservationId), responseHash: rec.responseHash, amount: BigInt(rec.maxAmount), nonce: BigInt(b.nonce), deadline: BigInt(b.deadline) };
    const signer = await recoverTypedDataAddress({ domain: vaultDomain(dep.chainId, requireVault()), types: ACCEPT_TYPES, primaryType: "DeliveryAcceptance", message, signature: b.signature }).catch(() => null);
    if (signer?.toLowerCase() !== rec.customer.toLowerCase()) throw new ApiError(400, "INVALID_SIGNATURE", "Acceptance signature does not match the delivered response");
    rec.state = "settling";
    store.put(rec);
    try {
      const { hash } = await relay("acceptAndSettle", [message, b.signature]);
      rec.settleTx = hash;
      rec.state = "settled";
      store.put(rec);
      return json(publicRecord(rec));
    } catch (e) {
      rec.state = "delivered"; // still deliverable: the same signed acceptance can be retried while valid
      store.put(rec);
      throw e;
    }
  }

  const gm = path.match(/^\/api\/v1\/usage\/(req_[a-f0-9]+)$/);
  if (gm && m === "GET") {
    const rec = authorised(store.get(gm[1]), url.searchParams.get("accessToken"));
    const chainState = rec.reservationId ? await readReservation(BigInt(rec.reservationId)).catch(() => null) : null;
    const cached = outputCache.get(rec.requestId);
    return json({ ...publicRecord(rec), onchainStatus: chainState?.statusName ?? null, output: cached?.output ?? null });
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
    const ip = srv.requestIP(req)?.address ?? "unknown";
    try {
      return await route(req, url, ip);
    } catch (e) {
      if (e instanceof ApiError) return json({ code: e.code, message: e.message, ...e.extra }, e.status);
      if (e instanceof z.ZodError) return json({ code: "BAD_REQUEST", message: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400);
      console.error(e);
      return json({ code: "INTERNAL", message: "Unexpected server error" }, 500);
    }
  },
});
console.log(`unspent api on :${server.port} network=${NETWORK} vault=${VAULT} provider=${PROVIDER_ID} rpc=${rpcSource} model=${modelConfigured() ? config.llm.model : "NOT CONFIGURED"}`);
