import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuthContext } from '../../auth/AuthContext';
import type { AuthedUser } from '../../api/types';
import { PublicFooter } from '../PublicFooter';
describe('PublicFooter — a product footer, not a byline', () => {
  const html = renderToStaticMarkup(<PublicFooter />);
  it('groups product, engineering, trust and account links', () => {
    for (const href of ['/analyze', '/demo', '/trust/how-its-built', '/trust/no-training',
      '/trust/results-forever', '/trust/privacy', '/login', '/register']) {
      expect(html).toContain(`href="${href}"`);
    }
    expect(html).toContain(`© ${new Date().getFullYear()} SPECTR`);
  });
  it('carries no personal byline, no repo link, and no pricing link by default', () => {
    expect(html).not.toMatch(/built by/i);
    expect(html).not.toContain('github.com');
    expect(html).not.toContain('href="/pricing"');
  });
  it('swaps the account group for the library when signed in', () => {
    const user: AuthedUser = { id: 'u1', email: 'a@b', displayName: null, tier: 'free' };
    const authed = renderToStaticMarkup(
      <AuthContext.Provider value={{ user, accessToken: 't', isLoading: false } as never}>
        <PublicFooter />
      </AuthContext.Provider>,
    );
    expect(authed).toContain('href="/library"');
    expect(authed).not.toContain('href="/register"');
  });
});
