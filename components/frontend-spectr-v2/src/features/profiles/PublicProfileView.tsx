/* Story 11.8 — pure presentational public profile (static-render testable).
 * The route container owns fetching + owner detection. Hue theming derives
 * banner/avatar colors from the user's stored hues. */
import { Pill } from '../../ui/Pill';

export interface PublicProfile {
  handle: string;
  displayName: string | null;
  bio: string | null;
  publicLink: string | null;
  avatarHue: number | null;
  bannerHue: number | null;
  accent: string | null;
  publicVersions: {
    songName: string;
    versionNumber: number;
    shareToken: string;
    sharedAt: string | null;
  }[];
}

export function PublicProfileView({
  profile,
  isOwner,
}: {
  profile: PublicProfile;
  isOwner?: boolean;
}) {
  const avatarHue = profile.avatarHue ?? 168;
  const bannerHue = profile.bannerHue ?? avatarHue;
  const initial = (profile.displayName ?? profile.handle).charAt(0).toUpperCase();

  return (
    <div data-testid="public-profile" style={{ maxWidth: 760, margin: '0 auto', padding: '0 24px 64px' }}>
      <div
        aria-hidden
        style={{
          height: 120,
          borderRadius: '0 0 16px 16px',
          background: `linear-gradient(135deg, oklch(0.45 0.09 ${bannerHue}), oklch(0.2 0.05 ${bannerHue}))`,
        }}
      />
      <header style={{ display: 'flex', gap: 16, alignItems: 'flex-end', marginTop: -34 }}>
        <div
          style={{
            width: 68, height: 68, borderRadius: '50%', display: 'grid', placeItems: 'center',
            fontSize: 26, fontWeight: 800, color: 'var(--ink-on-accent)',
            background: `oklch(0.72 0.16 ${avatarHue})`, border: '3px solid var(--bg)',
          }}
        >
          {initial}
        </div>
        <div style={{ flex: 1, paddingBottom: 4 }}>
          <h1 style={{ margin: 0, fontSize: 24 }}>{profile.displayName ?? `@${profile.handle}`}</h1>
          <p className="mono" style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--muted)' }}>
            @{profile.handle}
          </p>
        </div>
        {isOwner && (
          <a href="/profile" className="btn sm ghost" data-testid="edit-profile" style={{ marginBottom: 6 }}>
            Edit profile
          </a>
        )}
      </header>

      {profile.bio && <p style={{ marginTop: 14, fontSize: 14, lineHeight: 1.6 }}>{profile.bio}</p>}
      {profile.publicLink && (
        <p style={{ marginTop: 4 }}>
          <a href={profile.publicLink} rel="noreferrer nofollow" target="_blank" className="mono" style={{ fontSize: 12 }}>
            {profile.publicLink}
          </a>
        </p>
      )}

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 15, margin: '0 0 10px' }}>Public tracks</h2>
        {profile.publicVersions.length === 0 ? (
          <p className="mono" data-testid="empty-tracks" style={{ fontSize: 12, color: 'var(--muted)' }}>
            Nothing public yet.
          </p>
        ) : (
          <ul style={{ margin: 0, padding: 0, display: 'grid', gap: 8 }}>
            {profile.publicVersions.map((v) => (
              <li key={v.shareToken} style={{ listStyle: 'none' }}>
                <a
                  href={`/v/${v.shareToken}`}
                  className="card"
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', textDecoration: 'none', color: 'var(--text)' }}
                >
                  <span style={{ flex: 1, fontWeight: 600 }}>{v.songName}</span>
                  <Pill><span className="mono">v{v.versionNumber}</span></Pill>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
