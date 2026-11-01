// Generates a self-contained local page (no network assets, no keys) that shows the exact Arc mainnet deployment and
// provider-registration transactions and has the owner's own MetaMask sign them. Nothing is broadcast by this script.
//   forge build && bun scripts/mainnet-console.ts <out.html>      (serve it from localhost, e.g. python -m http.server)
import { readFileSync, writeFileSync } from "node:fs";
import { keccak256, stringToHex, toFunctionSelector, sha256 } from "viem";
import { deployments } from "../src/contracts/deployments";

const out = process.argv[2];
if (!out) throw new Error("usage: mainnet-console.ts <out.html> [expectedOwner]");
const expectedOwner = (process.argv[3] ?? "").toLowerCase();
if (expectedOwner && !/^0x[0-9a-f]{40}$/.test(expectedOwner)) throw new Error("expectedOwner must be a 0x address");
const art = JSON.parse(readFileSync(new URL("../contracts/out/UnspentVault.sol/UnspentVault.json", import.meta.url), "utf8"));
const m = deployments.mainnet;
const testnet = deployments.testnet;
if (m.chainId !== 5042 || m.usdc.toLowerCase() !== "0x3600000000000000000000000000000000000000") throw new Error("unexpected mainnet config");

const creation: string = art.bytecode.object;
const ctorArg = m.usdc.toLowerCase().slice(2).padStart(64, "0");
const deployData = creation + ctorArg;
const metadata = testnet.providerMetadata as string;
const cfg = {
  chainId: 5042,
  chainIdHex: "0x" + (5042).toString(16),
  chainName: m.name,
  rpc: m.rpcUrls[0],
  explorer: m.explorer,
  usdc: m.usdc,
  deployData,
  deployDataSha256: sha256(deployData as `0x${string}`),
  creationKeccak: keccak256(creation as `0x${string}`),
  registerSelector: toFunctionSelector("registerProvider(address,bytes32)"),
  metadata,
  metadataHash: keccak256(stringToHex(metadata)),
  expectedOwner,
  // Explicit limits so the wallet's up-front balance check is not inflated by its own default max fee. Arc base fee floor is 20 gwei.
  deployGas: 2_430_000,
  registerGas: 120_000,
  maxFeePerGas: 30_000_000_000,
  maxPriorityFeePerGas: 3_000_000_000,
};

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>UNSPENT mainnet console (local)</title>
<style>
 body{font:15px/1.5 system-ui,sans-serif;max-width:860px;margin:24px auto;padding:0 16px;background:#0e1214;color:#e6eaec}
 h1{font-size:22px} h2{font-size:17px;margin-top:28px} code,.mono{font-family:ui-monospace,Consolas,monospace;font-size:13px;word-break:break-all}
 table{border-collapse:collapse;width:100%;margin:8px 0} td{border-top:1px solid #2a3338;padding:6px 8px;vertical-align:top} td:first-child{color:#9aa7ad;width:30%}
 button{font:inherit;padding:10px 16px;border-radius:8px;border:0;background:#33c9b0;color:#032;cursor:pointer;margin:6px 8px 6px 0} button:disabled{opacity:.4;cursor:not-allowed}
 .warn{background:#3a2a10;border:1px solid #7a5a20;padding:10px 12px;border-radius:8px} .ok{color:#5be3a5} .bad{color:#ff7a7a} input{width:100%;padding:8px;background:#161d20;color:inherit;border:1px solid #2a3338;border-radius:6px;font:13px ui-monospace,Consolas,monospace}
</style></head><body>
<h1>UNSPENT mainnet console <small>(runs on your computer; holds no keys)</small></h1>
<p class="warn"><b>Real money.</b> Arc mainnet (chain 5042). Each button asks MetaMask to sign one transaction; nothing is sent until you confirm it in MetaMask. MetaMask will show its own review of the page: you may see a warning for this local page too; read every field below against MetaMask's popup.</p>
<h2>1. Connect</h2>
<button id="connect">Connect MetaMask</button> <span id="acct" class="mono">not connected</span>
<table>
 <tr><td>Wallet network</td><td id="net">-</td></tr>
 <tr><td>Live gas price</td><td id="gp" class="mono">-</td></tr>
</table>
<button id="switch" disabled>Switch MetaMask to Arc mainnet (5042)</button>

<h2>2. Deploy UnspentVault</h2>
<table>
 <tr><td>Network</td><td>${cfg.chainName}, chain ${cfg.chainId}</td></tr>
 <tr><td>From</td><td class="mono" id="d-from">-</td></tr>
 <tr><td>To</td><td>none: contract creation</td></tr>
 <tr><td>Value</td><td>0</td></tr>
 <tr><td>Constructor argument</td><td class="mono">usdc = ${cfg.usdc} (the only argument; the vault has no owner, pause, upgrade or sweep)</td></tr>
 <tr><td>Creation code keccak256</td><td class="mono">${cfg.creationKeccak}</td></tr>
 <tr><td>Transaction data</td><td class="mono"><span id="d-len"></span> bytes; SHA-256 <span id="d-sha"></span> <span id="d-sha-ok"></span></td></tr>
 <tr><td>Gas estimate (live)</td><td class="mono" id="d-gas">-</td></tr>
 <tr><td>Fee estimate</td><td class="mono" id="d-fee">-</td></tr>
 <tr><td>Limits this page sets</td><td class="mono">gas limit ${cfg.deployGas.toLocaleString("en-US")}; max fee ${cfg.maxFeePerGas / 1e9} gwei; priority tip ${cfg.maxPriorityFeePerGas / 1e9} gwei. The most the transaction can ever cost is ${(cfg.deployGas * cfg.maxFeePerGas / 1e18).toFixed(4)} USDC; the expected cost is the fee estimate above.</td></tr>
 <tr><td>Required signer</td><td class="mono">${expectedOwner || "(any)"} <span id="d-who"></span></td></tr>
</table>
<button id="deploy" disabled>Send deployment transaction (MetaMask will ask you to confirm)</button>
<div id="d-out" class="mono"></div>

<h2>3. Register the provider (after deployment)</h2>
<table>
 <tr><td>Vault address</td><td><input id="r-vault" placeholder="0x… (filled automatically after step 2)"></td></tr>
 <tr><td>Payout wallet</td><td><input id="r-payout" placeholder="0x… the address that will receive provider payments"></td></tr>
 <tr><td>Method</td><td class="mono">registerProvider(address payoutWallet, bytes32 metadataHash) selector ${cfg.registerSelector}</td></tr>
 <tr><td>metadataHash</td><td class="mono">${cfg.metadataHash}<br>= keccak256 of ${JSON.stringify(cfg.metadata).replace(/</g, "&lt;")}</td></tr>
 <tr><td>Signer = provider owner</td><td class="mono" id="r-from">-</td></tr>
 <tr><td>Value / gas</td><td>0 / about 96,547 gas used (limit ${cfg.registerGas.toLocaleString("en-US")}, max fee ${cfg.maxFeePerGas / 1e9} gwei, tip ${cfg.maxPriorityFeePerGas / 1e9} gwei)</td></tr>
</table>
<button id="register" disabled>Send registerProvider transaction</button>
<div id="r-out" class="mono"></div>

<script>
const CFG = ${JSON.stringify(cfg)};
let eth = null, account = null;
const $ = (id) => document.getElementById(id);
const fmt = (wei) => (Number(wei) / 1e18).toFixed(6) + " USDC";
const pad = (h) => h.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const hex = (n) => "0x" + BigInt(n).toString(16);
const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(a);
async function pickProvider() {
  const found = [];
  const on = (e) => found.push(e.detail);
  window.addEventListener("eip6963:announceProvider", on);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise((r) => setTimeout(r, 400));
  window.removeEventListener("eip6963:announceProvider", on);
  const mm = found.find((f) => f.info.rdns === "io.metamask") || found[0];
  return mm ? mm.provider : window.ethereum || null;
}
async function refresh() {
  if (!eth) return;
  const cid = parseInt(await eth.request({ method: "eth_chainId" }), 16);
  const ok = cid === CFG.chainId;
  $("net").innerHTML = "chain " + cid + (ok ? ' <span class="ok">Arc mainnet</span>' : ' <span class="bad">not Arc mainnet</span>');
  $("switch").disabled = ok || !account;
  $("d-from").textContent = $("r-from").textContent = account || "-";
  try { const gp = BigInt(await eth.request({ method: "eth_gasPrice" })); $("gp").textContent = Number(gp) / 1e9 + " gwei"; window.__gp = gp; } catch {}
  const rightWho = !CFG.expectedOwner || (account && account.toLowerCase() === CFG.expectedOwner);
  $("d-who").innerHTML = account ? (rightWho ? '<span class="ok">(connected account matches)</span>' : '<span class="bad">(connected account is DIFFERENT: switch account in MetaMask)</span>') : "";
  $("deploy").disabled = !(ok && account && rightWho && !window.__deploying);
  $("register").disabled = !(ok && account && rightWho && isAddr($("r-vault").value) && isAddr($("r-payout").value));
  if (ok && account) {
    try {
      const g = BigInt(await eth.request({ method: "eth_estimateGas", params: [{ from: account, data: CFG.deployData }] }));
      $("d-gas").textContent = g.toString() + " gas"; $("d-fee").textContent = fmt(g * (window.__gp || 0n)) + " at the live gas price";
    } catch (e) { $("d-gas").textContent = "estimate failed: " + (e.message || e); }
  }
}
async function waitReceipt(hash, el) {
  el.innerHTML = "Submitted: <b>" + hash + "</b> (waiting for confirmation)";
  for (;;) {
    const r = await eth.request({ method: "eth_getTransactionReceipt", params: [hash] });
    if (r) return r;
    await new Promise((s) => setTimeout(s, 3000));
  }
}
$("connect").onclick = async () => {
  eth = await pickProvider();
  if (!eth) { $("acct").textContent = "no wallet found"; return; }
  const a = await eth.request({ method: "eth_requestAccounts" });
  account = a[0];
  $("acct").textContent = account;
  eth.on && eth.on("chainChanged", refresh); eth.on && eth.on("accountsChanged", (x) => { account = x[0] || null; refresh(); });
  await refresh();
};
$("switch").onclick = async () => {
  try { await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CFG.chainIdHex }] }); }
  catch (e) {
    await eth.request({ method: "wallet_addEthereumChain", params: [{ chainId: CFG.chainIdHex, chainName: CFG.chainName, rpcUrls: [CFG.rpc], nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, blockExplorerUrls: [CFG.explorer] }] });
  }
  await refresh();
};
$("deploy").onclick = async () => {
  window.__deploying = true; $("deploy").disabled = true;
  try {
    const hash = await eth.request({ method: "eth_sendTransaction", params: [{ from: account, data: CFG.deployData, gas: hex(CFG.deployGas), maxFeePerGas: hex(CFG.maxFeePerGas), maxPriorityFeePerGas: hex(CFG.maxPriorityFeePerGas) }] });
    const r = await waitReceipt(hash, $("d-out"));
    $("d-out").innerHTML = "Tx <b>" + hash + "</b><br>status " + (r.status === "0x1" ? '<span class="ok">success</span>' : '<span class="bad">FAILED</span>') + ", block " + parseInt(r.blockNumber, 16) + "<br>contract address: <b>" + r.contractAddress + '</b><br><a style="color:#33c9b0" target="_blank" rel="noopener" href="' + CFG.explorer + "/tx/" + hash + '">view on explorer</a>. Send me this hash; I will verify the code on the chain before you register.';
    if (r.contractAddress) $("r-vault").value = r.contractAddress;
  } catch (e) { $("d-out").innerHTML = '<span class="bad">' + (e.code === 4001 ? "Rejected in MetaMask. Nothing was sent." : (e.message || e)) + "</span>"; window.__deploying = false; }
  refresh();
};
$("register").onclick = async () => {
  $("register").disabled = true;
  const data = CFG.registerSelector + pad($("r-payout").value) + pad(CFG.metadataHash);
  try {
    const hash = await eth.request({ method: "eth_sendTransaction", params: [{ from: account, to: $("r-vault").value, data, gas: hex(CFG.registerGas), maxFeePerGas: hex(CFG.maxFeePerGas), maxPriorityFeePerGas: hex(CFG.maxPriorityFeePerGas) }] });
    const r = await waitReceipt(hash, $("r-out"));
    $("r-out").innerHTML = "Tx <b>" + hash + "</b><br>status " + (r.status === "0x1" ? '<span class="ok">success</span>' : '<span class="bad">FAILED</span>') + ", block " + parseInt(r.blockNumber, 16) + ". Send me this hash.";
  } catch (e) { $("r-out").innerHTML = '<span class="bad">' + (e.code === 4001 ? "Rejected in MetaMask. Nothing was sent." : (e.message || e)) + "</span>"; }
  refresh();
};
for (const id of ["r-vault", "r-payout"]) $(id).oninput = refresh;
$("d-len").textContent = (CFG.deployData.length - 2) / 2;
$("d-sha").textContent = CFG.deployDataSha256;
crypto.subtle.digest("SHA-256", Uint8Array.from(CFG.deployData.slice(2).match(/../g).map((b) => parseInt(b, 16)))).then((buf) => {
  const h = "0x" + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  $("d-sha-ok").innerHTML = h === CFG.deployDataSha256 ? '<span class="ok">(recomputed in this page: matches)</span>' : '<span class="bad">MISMATCH, do not send</span>';
});
</script></body></html>`;
writeFileSync(out, html);
console.log(`wrote ${out}`);
console.log(`deploy tx data: ${(deployData.length - 2) / 2} bytes, sha256 ${cfg.deployDataSha256}`);
console.log(`creation keccak256: ${cfg.creationKeccak}`);
console.log(`registerProvider selector ${cfg.registerSelector}, metadataHash ${cfg.metadataHash}`);
