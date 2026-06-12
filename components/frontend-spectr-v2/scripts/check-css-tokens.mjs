// AR39 enforcement lint: no raw hex colors in CSS modules — tokens only.
// tokens.css / global.css (non-module files) are exempt: tokens have to
// define their hex somewhere. Zero dependencies on purpose.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..", "src");
const HEX = /#[0-9a-fA-F]{3,8}\b/g;

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.name.endsWith(".module.css")) yield path;
  }
}

if (!existsSync(SRC)) {
  // Fail CLOSED: missing scan root = misconfigured lint, not clean code.
  console.error(`css tokens lint: scan root missing: ${SRC}`);
  process.exit(2);
}

const offenders = [];
for (const file of walk(SRC)) {
  const lines = readFileSync(file, "utf-8").split(/\r?\n/);
  lines.forEach((line, i) => {
    // SVG fragment refs (url(#fade)) are not colors.
    if (line.includes("url(#")) return;
    for (const m of line.matchAll(HEX)) {
      offenders.push(`${relative(SRC, file)}:${i + 1}: ${m[0]}  (${line.trim()})`);
    }
  });
}

if (offenders.length) {
  console.error("Raw hex colors in CSS modules — use tokens.css vars instead:");
  for (const o of offenders) console.error("  " + o);
  process.exit(1);
}
console.log("css tokens lint: clean");
