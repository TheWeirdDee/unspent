// Revokes ALL bearer tokens in the metadata store (file or DATABASE_URL). Run with the API STOPPED, then restart it.
import { store, flush, persistence } from "../server/store";
const before = store.all().map((r) => ({ id: r.requestId, state: r.state, revoked: r.accessTokenHash === "revoked" }));
const res = store.revokeAll();
await flush();
console.log(JSON.stringify({ persistence, recordsTotal: res.total, tokensRevokedNow: res.revoked, alreadyRevoked: before.filter((b) => b.revoked).length, inFlightRecordsAffected: before.filter((b) => ["quoted", "reserving", "reserved", "executing", "delivered", "settling"].includes(b.state)).length }));
