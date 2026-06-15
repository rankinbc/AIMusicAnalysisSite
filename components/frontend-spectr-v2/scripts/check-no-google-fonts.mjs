// Story 1.7 / UX-DR1 enforcement: no Google Fonts references anywhere in
// the frontend source tree. Fonts must be self-hosted from /public/fonts/
// for GDPR cleanliness — no third-party request on page load.
//
// Scans src/, public/, index.html, and (defensively) the package.json file
// for any URL pointing at fonts.googleapis.com or fonts.gstatic.com.
// Zero dependencies on purpose, same idiom as check-css-tokens.mjs.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SCAN_DIRS = ["src", "public"];
// Root-level config files that could inject a font URL into the build
// pipeline or HTML head. Add to this list rather than walking the root
// (which would also scan node_modules, dist/, requirements/, etc.).
const SCAN_FILES = [
  "index.html",
  "package.json",
  "vite.config.ts",
  "vitest.config.ts",
  "tsconfig.json",
];
const SCAN_EXT = /\.(html|tsx?|jsx?|css|mjs|js|json)$/;
// Generated artifacts may include URLs in API examples or doc strings —
// not author-edited, so excluded from the lint scope.
const SKIP_PATHS = [
  join("src", "api", "generated"),
  join("src", "routeTree.gen.ts"),
];
const NEEDLES = [/fonts\.googleapis\.com/, /fonts\.gstatic\.com/];

function isSkipped(path) {
  const rel = relative(ROOT, path);
  return SKIP_PATHS.some((skip) => rel === skip || rel.startsWith(skip + "\\") || rel.startsWith(skip + "/"));
}

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (isSkipped(path)) continue;
    if (entry.isDirectory()) yield* walk(path);
    else if (SCAN_EXT.test(entry.name)) yield path;
  }
}

const offenders = [];
function scan(file) {
  if (!existsSync(file)) return;
  if (statSync(file).isDirectory()) return;
  const lines = readFileSync(file, "utf-8").split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const needle of NEEDLES) {
      if (needle.test(line)) {
        offenders.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
        break;
      }
    }
  });
}

for (const dir of SCAN_DIRS) for (const file of walk(join(ROOT, dir))) scan(file);
for (const file of SCAN_FILES) scan(join(ROOT, file));

if (offenders.length) {
  console.error(
    "Google Fonts reference found — self-host instead (UX-DR1):",
  );
  for (const o of offenders) console.error("  " + o);
  process.exit(1);
}
console.log("no-google-fonts lint: clean");
