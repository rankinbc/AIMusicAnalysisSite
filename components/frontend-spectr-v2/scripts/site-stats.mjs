// Recounts the numbers the engineering page prints. `--json` → counts;
// `--write` → re-floor stats.generated.json; no flag → both, human-readable.
// Counting rules: PRPs/public-surfaces-polish.md §3.3 (the drift test in
// src/features/engineering/__tests__/site-stats.test.ts runs THIS script,
// so the rules live in one place).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FE = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(FE, '..', '..');
const SKIP = new Set(['node_modules', 'dist', 'bin', 'obj', '.venv', 'venv', '__pycache__']);
const OUT = join(FE, 'src', 'features', 'engineering', 'stats.generated.json');

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP.has(e.name)) walk(join(dir, e.name), out);
    } else out.push(join(dir, e.name).replaceAll('\\', '/'));
  }
  return out;
}

const matches = (files, re) =>
  files.reduce((n, f) => n + (readFileSync(f, 'utf8').match(re)?.length ?? 0), 0);

const feTests = walk(join(FE, 'src')).filter((f) => /\.test\.tsx?$/.test(f));
const bffTests = walk(join(ROOT, 'components', 'bff', 'tests')).filter((f) => f.endsWith('.cs'));
const py = ['worker', 'analysis', 'shared', 'workerdash']
  .flatMap((c) => walk(join(ROOT, 'components', c)))
  .filter((f) => /\/test_[^/]+\.py$/.test(f));
const endpoints = walk(join(ROOT, 'components', 'bff', 'src', 'Spectr.Bff', 'Endpoints')).filter(
  (f) => f.endsWith('.cs'),
);
const migrations = readdirSync(join(ROOT, 'components', 'bff', 'src', 'Spectr.Data', 'Migrations')).filter(
  (f) => f.endsWith('.cs') && !f.endsWith('.Designer.cs') && !f.includes('ModelSnapshot'),
);

export const counts = {
  frontendTestFiles: feTests.length,
  frontendTestCases: matches(feTests, /^\s*(?:it|test)(?:\.each\b[^\n]*?)?\(/gm),
  bffTestClasses: bffTests.filter((f) => f.endsWith('Tests.cs')).length,
  bffTestCases: matches(bffTests, /^\s*\[(?:Skippable)?(?:Fact|Theory)\b/gm),
  pythonTestFiles: py.length,
  endpoints: matches(endpoints, /\.Map(?:Get|Post|Put|Patch|Delete)\(/g),
  migrations: migrations.length,
  tables: matches([join(ROOT, 'components', 'bff', 'src', 'Spectr.Data', 'AppDbContext.cs')], /public\s+DbSet</g),
  specialistPrompts: readdirSync(join(ROOT, 'components', 'worker', 'prompts', 'experts')).filter((f) =>
    f.endsWith('.md'),
  ).length,
};

const floor = (n) => (n >= 100 ? Math.floor(n / 10) * 10 : Math.floor(n / 5) * 5);

const args = new Set(process.argv.slice(2));
if (args.has('--json')) {
  process.stdout.write(JSON.stringify(counts));
} else {
  const floors = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, floor(v)]));
  if (args.has('--write')) {
    writeFileSync(
      OUT,
      `${JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), floors }, null, 2)}\n`,
    );
  }
  console.table(Object.fromEntries(Object.keys(counts).map((k) => [k, { count: counts[k], floor: floors[k] }])));
}
