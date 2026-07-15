// Story 5.10 / UX-DR44 enforcement lint: no `outline: none` (or `outline: 0`)
// without a visible focus replacement in the SAME file. A replacement is a
// `:focus` / `:focus-visible` rule that declares a box-shadow, a border-color,
// or a non-none outline. tokens.css is exempt (no rules there); global.css is
// scanned — it owns the app-wide ring and must never lose it. Zero deps.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..", "src");
// Also catches `outline: none !important` — the most aggressive removal must
// not be the one that escapes the lint.
const OUTLINE_NONE = /outline:\s*(none|0)\s*(!important\s*)?[;}]/;
// A :focus/:focus-visible selector whose block carries a visible indicator.
// (?![\w-]) keeps :focus-within from counting; box-shadow: none doesn't count.
// KNOWN LIMIT: file-scoped, not selector-paired — one compliant :focus block
// whitelists the whole file (redesign.css especially). Selector pairing needs
// a real CSS parser; revisit if a regression ever slips through.
const FOCUS_REPLACEMENT =
  /:focus(-visible)?(?![\w-])[^{}]*\{[^}]*(box-shadow:\s*(?!none)|border-color|outline:\s*(?!none|0)[^;}]+)/s;

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.name.endsWith(".css") && entry.name !== "tokens.css") yield path;
  }
}

if (!existsSync(SRC)) {
  console.error(`focus ring lint: scan root missing: ${SRC}`);
  process.exit(2);
}

const offenders = [];
for (const file of walk(SRC)) {
  const css = readFileSync(file, "utf-8");
  if (!OUTLINE_NONE.test(css)) continue;
  if (FOCUS_REPLACEMENT.test(css)) continue;
  const line = css.split(/\r?\n/).findIndex((l) => OUTLINE_NONE.test(l)) + 1;
  offenders.push(`${relative(SRC, file)}:${line}`);
}

if (offenders.length) {
  console.error(
    "outline: none without a visible :focus/:focus-visible replacement (box-shadow, border-color, or outline) in the same file:",
  );
  for (const o of offenders) console.error("  " + o);
  process.exit(1);
}
console.log("focus ring lint: clean");
