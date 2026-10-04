import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const FE = resolve(__dirname, '../../..');
const ROOT = resolve(FE, '../..');
const sitemap = readFileSync(resolve(FE, 'public/sitemap.xml'), 'utf8');
const caddy = readFileSync(resolve(ROOT, 'infra/Caddyfile'), 'utf8');
const shells = readFileSync(resolve(ROOT, 'components/bff/src/Spectr.Bff/Endpoints/PublicSiteEndpoints.cs'), 'utf8');
const paths = [...sitemap.matchAll(/<loc>https:\/\/spectrmix\.com([^<]*)<\/loc>/g)].map((m) => m[1] || '/');
const botLine = caddy.split('\n').find((l) => l.trim().startsWith('path / ')) ?? '';
const routeFile = (p: string) => (p === '/' ? 'index.tsx' : `${p.slice(1).replaceAll('/', '.')}.tsx`);

describe('public surface parity — sitemap ↔ Caddy bot split ↔ BFF shell ↔ route file', () => {
  it('lists exactly the indexable pages', () => {
    expect(paths.sort()).toEqual(['/', '/analyze', '/features', '/trust/how-its-built', '/trust/no-training',
      '/trust/privacy', '/trust/results-forever'].sort());
  });

  it.each(paths)('%s unfurls and exists', (p) => {
    const tokens = botLine.trim().split(/\s+/);
    expect(tokens).toContain(p);
    if (p !== '/') expect(tokens).toContain(`${p}/`);
    expect(shells).toContain(`path: "${p}"`);
    expect(existsSync(resolve(FE, 'src/routes', routeFile(p)))).toBe(true);
  });

  it('robots.txt points at the sitemap and keeps the demo out of the index', () => {
    const robots = readFileSync(resolve(FE, 'public/robots.txt'), 'utf8');
    expect(robots).toContain('Sitemap: https://spectrmix.com/sitemap.xml');
    expect(robots).toContain('Disallow: /demo');
  });
});
