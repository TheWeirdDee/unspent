// Guards the API image against importing a file the Dockerfile never copies.
//
// This exists because it happened: server/chain.ts began importing ../src/lib/retry, the image copied only
// protocol.ts and money.ts from src/lib, and the deployed container died at boot with "Cannot find module
// '../src/lib/retry'". Typecheck, unit tests and the build all passed locally, because the whole repository was on disk;
// only the container had the smaller file set.
//
// The check reads the Dockerfile's COPY lines, builds the same file set in a temporary directory, and asks Bun to bundle
// server/index.ts there. A missing import fails resolution, which is exactly the deploy failure reproduced locally.
//
// Usage: bun run check:docker
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename } from "node:path";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf8");

/** Resolve each COPY line into the (source, destination) pairs Docker would apply. */
function copySteps(): { src: string; dest: string }[] {
  const steps: { src: string; dest: string }[] = [];
  for (const raw of dockerfile.split(/\r?\n/)) {
    const line = raw.trim();
    if (!/^COPY\s/i.test(line) || /--from=/.test(line)) continue;
    const parts = line.split(/\s+/).slice(1);
    const dest = parts.pop();
    if (!dest) continue;
    for (const src of parts) steps.push({ src, dest });
  }
  return steps;
}

const steps = copySteps();
if (!steps.length) {
  console.error("Dockerfile has no COPY lines; refusing to pass");
  process.exit(1);
}

const sandbox = mkdtempSync(join(tmpdir(), "unspent-image-"));
let failed = false;
try {
  // Docker semantics: a directory destination receives each source by name; a single directory source is merged in.
  for (const line of dockerfile.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts[0]?.toUpperCase() !== "COPY" || /--from=/.test(line)) continue;
    const sources = parts.slice(1, -1);
    const dest = parts[parts.length - 1];
    if (!sources.length || !dest) continue;
    const dirDest = dest === "." || dest === "./" || dest.endsWith("/") || !/\.[a-z0-9]+$/i.test(dest);
    for (const src of sources) {
      const from = join(ROOT, src);
      const singleDir = sources.length === 1 && dirDest && statSync(from).isDirectory();
      const to = singleDir ? join(sandbox, dest) : join(sandbox, dest, basename(src));
      mkdirSync(singleDir ? to : dirname(to), { recursive: true });
      cpSync(from, to, { recursive: true });
    }
  }

  const entry = join(sandbox, "server", "index.ts");
  const out = join(sandbox, ".bundle");
  // `--packages=external` leaves node_modules out of it: this check is about the image's own files, not its dependencies.
  const proc = Bun.spawnSync(["bun", "build", entry, "--target=bun", "--packages=external", "--outdir", out], {
    cwd: sandbox,
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = `${proc.stdout.toString()}\n${proc.stderr.toString()}`;
  if (proc.exitCode !== 0) {
    failed = true;
    console.error("The API image cannot resolve its imports. Files copied by the Dockerfile:");
    for (const s of steps) console.error(`  ${s.src} -> ${s.dest}`);
    console.error("\n" + output.trim().split("\n").slice(0, 15).join("\n"));
    const missing = output.match(/Cannot find module "([^"]+)" from "([^"]+)"/);
    if (missing) {
      const from = relative(sandbox, missing[2]).replace(/\\/g, "/");
      console.error(`\nHint: ${from} imports "${missing[1]}"; add the resolved file to a COPY line.`);
    }
  } else {
    console.log(`API image imports resolve (${steps.length} COPY steps, server/index.ts bundles)`);
  }
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

if (failed) process.exit(1);
