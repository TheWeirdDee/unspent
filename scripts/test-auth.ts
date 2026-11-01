// Negative tests: sensitive operations must need wallet-signed authorisation or the per-request bearer token.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keccak256, stringToHex } from "viem";
import { ACCEPT_TYPES, RESERVE_TYPES, vaultDomain } from "../src/lib/protocol";
import { deployments } from "../src/contracts/deployments";
const API = process.env.API ?? "http://localhost:3001";
const dep = deployments.testnet;
const post = async (path: string, body: unknown) => { const r = await fetch(API + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: (await r.json()) as Record<string, any> }; };
let failed = 0;
const check = (name: string, ok: boolean, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${d}`); if (!ok) failed++; };
const victim = privateKeyToAccount(generatePrivateKey());
const attacker = privateKeyToAccount(generatePrivateKey());
const inputHash = keccak256(stringToHex("hello"));

// A quote can be requested for ANY claimed address; it grants nothing by itself.
const q = await post("/api/v1/usage/quote", { customer: victim.address, providerId: String(dep.providerId), inputHash });
check("quote for a claimed address is just a quote", q.status === 200 && Boolean(q.body.accessToken));
const msg = { customer: victim.address, providerId: BigInt(dep.providerId!), payoutWallet: q.body.payoutWallet, payoutVersion: q.body.payoutVersion, requestHash: q.body.requestHash, maxAmount: BigInt(q.body.maxAmountMicrounits), nonce: BigInt(q.body.nonce), authDeadline: BigInt(q.body.authDeadline), expiry: BigInt(q.body.reservationDeadline) };
const badSig = await attacker.signTypedData({ domain: vaultDomain(dep.chainId, dep.vault as `0x${string}`), types: RESERVE_TYPES, primaryType: "ReserveAuthorisation", message: msg });
const r1 = await post("/api/v1/usage/reservations", { requestId: q.body.requestId, accessToken: q.body.accessToken, signature: badSig });
check("reservation signed by someone else is rejected", r1.status === 400 && r1.body.code === "INVALID_SIGNATURE", `${r1.status} ${r1.body.code}`);
const r2 = await post("/api/v1/usage/reservations", { requestId: q.body.requestId, accessToken: "x".repeat(48), signature: badSig });
check("reservation without the bearer token is rejected", r2.status === 403, `${r2.status} ${r2.body.code}`);
const e1 = await post(`/api/v1/usage/${q.body.requestId}/execute`, { accessToken: q.body.accessToken, text: "hello" });
check("execute without a confirmed onchain reservation is rejected (no model call)", e1.status === 409, `${e1.status} ${e1.body.code}`);
const e2 = await post(`/api/v1/usage/${q.body.requestId}/execute`, { accessToken: "nope", text: "hello" });
check("execute with a wrong token is rejected", e2.status === 403);
const accSig = await attacker.signTypedData({ domain: vaultDomain(dep.chainId, dep.vault as `0x${string}`), types: ACCEPT_TYPES, primaryType: "DeliveryAcceptance", message: { customer: victim.address, reservationId: 1n, responseHash: inputHash, amount: 100000n, nonce: 1n, deadline: 9999999999n } });
const a1 = await post(`/api/v1/usage/${q.body.requestId}/accept`, { accessToken: q.body.accessToken, signature: accSig, nonce: "1", deadline: "9999999999" });
check("acceptance cannot be forged or applied to an unreserved request", a1.status === 409 || a1.status === 400, `${a1.status} ${a1.body.code}`);
const g0 = await fetch(`${API}/api/v1/usage/${q.body.requestId}`); check("reading a request needs the bearer token", g0.status === 403);
const g1 = await fetch(`${API}/api/v1/usage/${q.body.requestId}`, { headers: { authorization: `Bearer ${q.body.accessToken}` } }); check("bearer token grants read of own request record", g1.status === 200);
const o1 = await post("/api/v1/demo/outage", { token: "wrong", active: true }); check("outage toggle needs the operator token", o1.status === 403);
for (const f of ["data/state.json", "server/index.ts", ".env", "scripts/lib.ts"]) { const r = await fetch(`http://localhost:5173/${f}`); const t = await r.text(); check(`dev server does not serve ${f}`, r.status === 403 || r.status === 404 || t.includes("<div id=\"root\">") || t.includes("<!doctype html>"), `HTTP ${r.status}`); }
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
