// P7 (bundle diet, D12) enforcement lint: the entry script (dist/index.html's
// <script type="module">) must stay small enough that a first-time phone
// visitor isn't paying for the whole app before the landing page paints.
// Run AFTER `vite build` — fails closed if dist/index.html is missing.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const INDEX_HTML = join(DIST, 'index.html');

const MAX_RAW = 400_000;
const MAX_GZ = 130_000;

if (!existsSync(INDEX_HTML)) {
  // Fail CLOSED: missing build output = misconfigured lint (run after
  // `vite build`), not clean code.
  console.error(`bundle size lint: ${INDEX_HTML} not found — run \`vite build\` first`);
  process.exit(2);
}

const html = readFileSync(INDEX_HTML, 'utf-8');
const match = html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/);
if (!match) {
  console.error('bundle size lint: no <script type="module" src="..."> found in dist/index.html');
  process.exit(2);
}

const entryPath = join(DIST, match[1].replace(/^\//, ''));
if (!existsSync(entryPath)) {
  console.error(`bundle size lint: entry script not found on disk: ${entryPath}`);
  process.exit(2);
}

const raw = statSync(entryPath).size;
const gz = gzipSync(readFileSync(entryPath)).length;

console.log(
  `bundle size lint: dist${match[1]} — raw ${raw} B, gzip ${gz} B (budget: ${MAX_RAW} B raw / ${MAX_GZ} B gzip)`,
);

if (raw > MAX_RAW || gz > MAX_GZ) {
  console.error(
    `bundle size lint: entry exceeds budget — raw ${raw} B (max ${MAX_RAW} B), gzip ${gz} B (max ${MAX_GZ} B)`,
  );
  process.exit(1);
}
