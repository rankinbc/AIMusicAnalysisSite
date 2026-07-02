import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PublicProfileView, type PublicProfile } from '../PublicProfileView';

// Story 11.8 (AC5) — static-render coverage: populated + empty profiles.

function profile(over: Partial<PublicProfile> = {}): PublicProfile {
  return {
    handle: 'maek',
    displayName: 'Mae Karlsson',
    bio: 'Trance producer. 138 or nothing.',
    publicLink: 'https://maek.example',
    avatarHue: 168,
    bannerHue: 280,
    accent: null,
    publicVersions: [
      { songName: 'Aurora', versionNumber: 3, shareToken: 'tokA', sharedAt: '2026-07-01T00:00:00Z' },
      { songName: 'Neon Skyline', versionNumber: 1, shareToken: 'tokB', sharedAt: null },
    ],
    ...over,
  };
}

describe('PublicProfileView (story 11.8)', () => {
  it('renders name, handle, bio, link and public tracks', () => {
    const html = renderToStaticMarkup(<PublicProfileView profile={profile()} />);
    expect(html).toContain('Mae Karlsson');
    expect(html).toContain('@maek');
    expect(html).toContain('138 or nothing');
    expect(html).toContain('https://maek.example');
    expect(html).toContain('Aurora');
    expect(html).toContain('/v/tokA');
    expect(html).toContain('v3');
  });

  it('themes from the stored hues', () => {
    const html = renderToStaticMarkup(<PublicProfileView profile={profile()} />);
    expect(html).toContain('oklch(0.72 0.16 168'); // avatar hue
    expect(html).toContain('280'); // banner hue in the gradient
  });

  it('shows Edit profile only for the owner', () => {
    expect(renderToStaticMarkup(<PublicProfileView profile={profile()} isOwner />))
      .toContain('data-testid="edit-profile"');
    expect(renderToStaticMarkup(<PublicProfileView profile={profile()} />))
      .not.toContain('data-testid="edit-profile"');
  });

  it('renders the empty state when nothing is public', () => {
    const html = renderToStaticMarkup(
      <PublicProfileView profile={profile({ publicVersions: [], bio: null, publicLink: null, displayName: null })} />,
    );
    expect(html).toContain('Nothing public yet');
    expect(html).toContain('@maek'); // falls back to handle for the title
  });
});
