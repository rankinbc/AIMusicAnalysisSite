// AR39 enforcement lint: no price literals outside config. Prices live in
// config (frontend src/config/, BFF *Options.cs) and Stripe price objects —
// never hardcoded in components or endpoints.
// Pattern is deliberately narrow (N.99 + optional C# numeric suffix) —
// widen as real price points appear. Known accepted false-positive class:
// a genuine 0.99 DSP/opacity constant would be flagged — move it to a
// named constant in config or restructure; flagging is the safe direction.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const FRONTEND_ROOT = join(HERE, "..", "src");
const BFF_ROOT = join(HERE, "..", "..", "bff", "src");
const TARGETS = [
  {
    root: FRONTEND_ROOT,
    exts: [".ts", ".tsx"],
    // Exempt exactly src/config/** (relative to the scan root) — not any
    // directory that happens to be named "config" — plus test files: tests
    // ASSERT the config-driven rendering ("$12.99/mo"), they don't source
    // prices, so flagging them would forbid exactly the coverage we want.
    allow: (p) =>
      relative(FRONTEND_ROOT, p).split(sep)[0] === "config" ||
      /\.test\.(ts|tsx)$/.test(p) ||
      p.split(sep).includes("__tests__"),
  },
  {
    root: BFF_ROOT,
    exts: [".cs"],
    allow: (p) => /Options\.cs$/.test(p),
  },
];
// N.99 with optional C# numeric-literal suffix (9.99m / 9.99M / f / d).
const PRICE = /\b\d+\.99(?:[mMfFdD])?\b/g;

function* walk(dir, exts) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["bin", "obj", "node_modules"].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path, exts);
    else if (exts.some((e) => entry.name.endsWith(e))) yield path;
  }
}

const offenders = [];
for (const { root, exts, allow } of TARGETS) {
  if (!existsSync(root)) {
    // Fail CLOSED: a vanished scan root means the lint is misconfigured,
    // not that the code is clean.
    console.error(`price literal lint: scan root missing: ${root}`);
    process.exit(2);
  }
  for (const file of walk(root, exts)) {
    if (allow(file)) continue;
    const lines = readFileSync(file, "utf-8").split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const m of line.matchAll(PRICE)) {
        offenders.push(`${relative(join(HERE, ".."), file)}:${i + 1}: ${m[0]}  (${line.trim()})`);
      }
    });
  }
}

if (offenders.length) {
  console.error("Price literals outside config — move to config/Stripe price objects:");
  for (const o of offenders) console.error("  " + o);
  process.exit(1);
}
console.log("price literal lint: clean");
