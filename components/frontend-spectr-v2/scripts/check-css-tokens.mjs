// AR39 enforcement lint: no raw hex colors in CSS modules — tokens only.
// tokens.css / global.css (non-module files) are exempt: tokens have to
// define their hex somewhere. Zero dependencies on purpose.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..", "src");
const HEX = /#[0-9a-fA-F]{3,8}\b/;

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.name.endsWith(".module.css")) yield path;
  }
}

const offenders = [];
for (const file of walk(SRC)) {
  const lines = readFileSync(file, "utf-8").split(/\r?\n/);
  lines.forEach((line, i) => {
    const m = line.match(HEX);
    if (m) offenders.push(`${relative(SRC, file)}:${i + 1}: ${m[0]}  (${line.trim()})`);
  });
}

if (offenders.length) {
  console.error("Raw hex colors in CSS modules — use tokens.css vars instead:");
  for (const o of offenders) console.error("  " + o);
  process.exit(1);
}
console.log("css tokens lint: clean");
