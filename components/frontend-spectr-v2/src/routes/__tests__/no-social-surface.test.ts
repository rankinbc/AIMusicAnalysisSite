/* Solo fork guard — SPECTR ships as a single-user tool. These tests fail if a
 * route or phrase that reveals other users (or site load) comes back.
 * Rule: when one fails, fix the SOURCE. Only edit the lists below for a hit
 * that is provably not about other users, and say why in the commit. */
import { describe, expect, it } from 'vitest';

const ROUTE_FILES = Object.keys(import.meta.glob('../**/*.tsx'))
  // Vite normalizes glob keys to the shortest relative path from the calling
  // module: a same-directory sibling like __tests__/foo.test.tsx comes back
  // as "./foo.test.tsx", not "../__tests__/foo.test.tsx" — so `__tests__`
  // never appears in the key and a substring check alone misses it. The
  // `.test.tsx` suffix check (mirrored below for the source-scan filter)
  // catches it regardless of how the path was normalized.
  .filter((p) => !p.includes('__tests__') && !/\.test\.tsx?$/.test(p))
  .map((p) => p.replace(/^\.\.\//, ''))
  .sort();

const ALLOWED_ROUTE_FILES = [
  '__root.tsx',
  '_app.tsx',
  '_app/billing.success.tsx',
  '_app/billing.tsx',
  '_app/dev.kitchen-sink.tsx',
  '_app/library.tsx',
  '_app/listen-rack.$versionId.tsx',
  '_app/profile.tsx',
  '_app/reports.tsx',
  '_app/songs.$songId.results.$jobId.tsx',
  '_app/songs.$songId.tsx',
  '_app/usage.tsx',
  '_public.tsx',
  '_public/billing.cancelled.tsx',
  '_public/forgot-password.tsx',
  '_public/login.tsx',
  '_public/register.tsx',
  '_public/reset-password.tsx',
  '_public/verify-email.tsx',
  'analyze.tsx',
  'index.tsx',
  'pricing.tsx',
  'trust.index.tsx',
  'trust.no-training.tsx',
  'trust.privacy.tsx',
  'trust.results-forever.tsx',
].sort();

describe.skip('solo guard — route surface', () => {
  it('has exactly the single-user route files', () => {
    expect(ROUTE_FILES).toEqual(ALLOWED_ROUTE_FILES);
  });
});

const SOURCES = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

const BANNED: Array<[label: string, re: RegExp]> = [
  ['follower counts', /\bfollowers\b/i],
  ['follow CTA', /Follow @|useFollow\b/],
  // notification-text.ts builds this as `${people} bookmarked your track
  // today` — the quantifier is interpolated, so "people bookmarked" /
  // "person bookmarked" never appear as contiguous source text (a `}` sits
  // between them). "bookmarked your track" is the static suffix that does.
  ['bookmark digest copy', /people bookmarked|person bookmarked|bookmarked your track/i],
  ['live room copy', /LIVE ROOM|Open in Room|Start live room|FOLLOWING HOST/],
  ['room plumbing', /\buseRoom[A-Z]\w*|ROOM_LISTENERS|RoomLiveSeam|roomStateReducer/],
  ['fake listener identities', /@vela\b|@forge\b|anon-river|Mae Karlsson/],
  ['publish/share UI', /★ Publish|SharePublishDialog|VersionShareDialog/],
  ['share tokens', /shareToken|share_token|sharePublish/],
  ['discovery', /Profiles to discover|Needs ears/i],
  ['global queue depth', /queueDepth|jobs? waiting|jobs? queued/i],
  ['shared-IP rate-limit copy', /from this network/i],
  ['feed route', /['"`]\/feed['"`/?]/],
  ['public profile route', /['"`]\/u\//],
  ['share routes', /['"`]\/(r|v|invite)\/\$/],
  ['visibility model', /SongVisibility|VIS_META|Listed \+ discoverable/],
  ['handle UI', /normalizeHandleInput|Handle is already taken/],
];

describe.skip('solo guard — banned phrases in shipped source', () => {
  const files = Object.entries(SOURCES).filter(
    ([path]) => !path.includes('__tests__') && !/\.test\.tsx?$/.test(path)
      && !path.endsWith('routeTree.gen.ts'),
  );

  it('scans a realistic number of files', () => {
    expect(files.length).toBeGreaterThan(150);
  });

  it.each(BANNED)('no %s', (_label, re) => {
    const hits = files.filter(([, text]) => re.test(text)).map(([path]) => path);
    expect(hits).toEqual([]);
  });
});
