/* Story 11.11 AC3/AC4 — static-render coverage for the /v/{token} discovery
 * CTAs. The route container decides WHICH renders (anon → register, authed
 * non-owner → follow); these pure pieces carry the rendering contract. */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FollowProducerCta, RegisterCta } from '../ProducerCta';

describe('RegisterCta', () => {
  it('carries the share attribution AND a next back to the share page', () => {
    const html = renderToStaticMarkup(<RegisterCta token="tok-1" ownerHandle="aurora" />);
    expect(html).toContain('data-testid="register-cta"');
    expect(html).toContain('via=share_tok-1');
    expect(html).toContain(`next=${encodeURIComponent('/v/tok-1')}`);
    expect(html).toContain('follow @aurora');
  });

  it('falls back to generic copy without an owner handle', () => {
    const html = renderToStaticMarkup(<RegisterCta token="tok-1" ownerHandle={null} />);
    expect(html).toContain('Analyze your own track free');
  });
});

describe('FollowProducerCta', () => {
  it('renders the follow button and links the producer to /u/{handle}', () => {
    const html = renderToStaticMarkup(
      <FollowProducerCta ownerHandle="aurora" ownerDisplayName="Aurora" isFollowing={false} />,
    );
    expect(html).toContain('data-testid="follow-producer-cta"');
    expect(html).toContain('href="/u/aurora"');
    expect(html).toContain('+ Follow @aurora');
    expect(html).toContain('Aurora');
  });

  it('shows the following state', () => {
    const html = renderToStaticMarkup(
      <FollowProducerCta ownerHandle="aurora" ownerDisplayName={null} isFollowing />,
    );
    expect(html).toContain('Following ✓');
    expect(html).toContain('@aurora'); // display-name fallback
  });
});
