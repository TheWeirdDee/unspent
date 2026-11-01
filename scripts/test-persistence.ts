// Proves metadata survives an API restart when DATABASE_URL (Postgres) is set. Spawns two API processes on :3002.
import { keccak256, stringToHex } from "viem";
import { deployments } from "../src/contracts/deployments";
const url = process.env.TEST_DATABASE_URL!;
const start = () => Bun.spawn(["bun", "--env-file=.env", "server/index.ts"], { env: { ...process.env, PORT: "3002", DATABASE_URL: url }, stdout: "pipe", stderr: "pipe" });
const ready = async () => { for (let i = 0; i < 40; i++) { try { const r = await fetch("http://localhost:3002/api/v1/health"); if (r.ok) return (await r.json()) as { persistence: string }; } catch { /* starting */ } await Bun.sleep(250); } throw new Error("api did not start"); };
let p = start();
const h1 = await ready();
const q = await (await fetch("http://localhost:3002/api/v1/usage/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ customer: "0x000000000000000000000000000000000000dEaD", providerId: String(deployments.testnet.providerId), inputHash: keccak256(stringToHex("persist")) }) })).json() as { requestId: string; accessToken: string };
await Bun.sleep(500); p.kill(); await p.exited;
p = start(); await ready();
const after = await fetch(`http://localhost:3002/api/v1/usage/${q.requestId}`, { headers: { authorization: `Bearer ${q.accessToken}` } });
const wrong = await fetch(`http://localhost:3002/api/v1/usage/${q.requestId}`, { headers: { authorization: "Bearer nope" } });
console.log(JSON.stringify({ persistenceMode: h1.persistence, recordSurvivedRestart: after.status === 200, wrongTokenStillRejected: wrong.status === 403 }));
p.kill();
