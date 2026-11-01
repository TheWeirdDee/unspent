// Exact integer USDC maths. Ledger values are bigint micro-USDC (6 decimals, the ERC-20 view).
// Never use these for native gas values (18 decimals): gas is shown by the wallet, not by this app.
export const USDC_DECIMALS = 6;
const SCALE = 10n ** BigInt(USDC_DECIMALS);

/** Parses a plain decimal string such as "1", "0.10", "12.345678". Returns null if invalid or too precise. */
export function parseUsdc(input: string): bigint | null {
  const s = input.trim();
  if (!/^\d+(\.\d{0,6})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole) * SCALE + BigInt(frac.padEnd(USDC_DECIMALS, "0") || "0");
}

/** Formats micro-USDC as a fixed decimal string. minFraction 2 -> "0.90", 6 -> "0.900000". */
export function formatUsdc(value: bigint, minFraction = 2): string {
  const negative = value < 0n;
  const v = negative ? -value : value;
  const whole = v / SCALE;
  let frac = (v % SCALE).toString().padStart(USDC_DECIMALS, "0");
  while (frac.length > minFraction && frac.endsWith("0")) frac = frac.slice(0, -1);
  const w = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${w}${frac ? `.${frac}` : ""}`;
}

export const PRICE_PER_CALL = 100_000n; // 0.10 USDC
