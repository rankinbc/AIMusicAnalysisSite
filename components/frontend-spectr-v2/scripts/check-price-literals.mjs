// AR39 enforcement lint: no price literals outside config. Prices live in
// config (frontend src/config/, BFF appsettings / *Options.cs) and Stripe
// price objects — never hardcoded in components or endpoints.
// Pattern is deliberately narrow (N.99) — widen as real price points appear.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TARGETS = [
  {
    root: join(HERE, "..", "src"),
    exts: [".ts", ".tsx"],
    allow: (p) => p.split(sep).includes("config"),
  },
  {
    root: join(HERE, "..", "..", "bff", "src"),
    exts: [".cs"],
    allow: (p) => /Options\.cs$/.test(p) || /appsettings.*\.json$/.test(p),
  },
];
const PRICE = /\b\d+\.99\b/;

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
  if (!existsSync(root)) continue;
  for (const file of walk(root, exts)) {
    if (allow(file)) continue;
    const lines = readFileSync(file, "utf-8").split(/\r?\n/);
    lines.forEach((line, i) => {
      const m = line.match(PRICE);
      if (m) offenders.push(`${relative(join(HERE, ".."), file)}:${i + 1}: ${m[0]}  (${line.trim()})`);
    });
  }
}

if (offenders.length) {
  console.error("Price literals outside config — move to config/Stripe price objects:");
  for (const o of offenders) console.error("  " + o);
  process.exit(1);
}
console.log("price literal lint: clean");
