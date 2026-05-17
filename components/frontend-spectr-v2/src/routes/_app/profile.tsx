import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { useSongs } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { normalizeGrade } from '../../features/results/helpers/grade';
import { CoverArt } from '../../ui/CoverArt';
import { GradePill } from '../../ui/GradePill';
import { hueFromId } from '../../ui/hueFromId';
import type { SongDto } from '../../api/types';
import s from './profile.module.css';

export const Route = createFileRoute('/_app/profile')({
  component: ProfilePage,
});

type TabId = 'overview' | 'activity' | 'settings';

function ProfilePage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { data: songs, isLoading, error } = useSongs();
  const [tab, setTab] = useState<TabId>('overview');

  const songList = useMemo(() => songs ?? [], [songs]);

  const stats = useMemo(() => {
    let versions = 0;
    let analyses = 0;
    for (const song of songList) {
      versions += song.versions.length;
      if (song.latestResult) analyses += 1;
    }
    return {
      songs: songList.length,
      versions,
      analyses,
    };
  }, [songList]);

  const activity = useMemo(() => buildActivity(songList), [songList]);

  const handleSignOut = async () => {
    await logout();
    void navigate({ to: '/login' });
  };

  if (isLoading) {
    return (
      <div className={s.page}>
        <p className={`mono ${s.status}`}>Loading profile…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className={s.page}>
        <p className={s.error}>
          Could not load profile: {error instanceof Error ? error.message : String(error)}
        </p>
      </div>
    );
  }

  const email = user?.email ?? '';
  const displayName = user?.displayName?.trim() || emailLocalPart(email) || 'Producer';
  const handle = user?.handle?.trim() ? `@${user.handle.trim()}` : '';
  const initial = displayName.charAt(0).toUpperCase() || '?';

  return (
    <div className={s.page}>
      <Header
        initial={initial}
        displayName={displayName}
        handle={handle}
        email={email}
        stats={stats}
      />

      <TabStrip current={tab} onChange={setTab} stats={stats} activityCount={activity.length} />

      {tab === 'overview' && (
        <OverviewTab songs={songList} activity={activity} />
      )}
      {tab === 'activity' && <ActivityTab activity={activity} />}
      {tab === 'settings' && (
        <SettingsTab
          displayName={displayName}
          handle={user?.handle ?? null}
          email={email}
          onSignOut={handleSignOut}
        />
      )}
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────

interface HeaderProps {
  initial: string;
  displayName: string;
  handle: string;
  email: string;
  stats: { songs: number; versions: number; analyses: number };
}

function Header({ initial, displayName, handle, email, stats }: HeaderProps) {
  return (
    <section className={`card ${s.header}`}>
      <div className={s.headerInner}>
        <div className={s.avatar} aria-hidden="true">
          {initial}
        </div>
        <div className={s.headerMain}>
          <div className={s.nameRow}>
            <span className={s.displayName}>{displayName}</span>
            {handle && <span className={`mono ${s.handle}`}>{handle}</span>}
            <span className="pill cyan">Free plan</span>
          </div>
          <div className={`mono ${s.meta}`}>{email}</div>
          <div className={s.statsRow}>
            <StatBlock label="Songs" value={stats.songs} />
            <StatBlock label="Versions" value={stats.versions} />
            <StatBlock label="Analyses" value={stats.analyses} />
          </div>
        </div>
        <div className={s.headerAside}>
          <span className={s.privacyTag}>Private to you</span>
        </div>
      </div>
    </section>
  );
}

function StatBlock({ label, value, accent }: { label: string; value: number; accent?: 'violet' }) {
  return (
    <div className={s.stat}>
      <div className={s.statValue} data-accent={accent ?? undefined}>
        {value}
      </div>
      <div className={s.statLabel}>{label}</div>
    </div>
  );
}

// ── Tab strip ─────────────────────────────────────────────────────────────

interface TabStripProps {
  current: TabId;
  onChange: (id: TabId) => void;
  stats: { songs: number; analyses: number };
  activityCount: number;
}

function TabStrip({ current, onChange, stats, activityCount }: TabStripProps) {
  const tabs: { id: TabId; label: string; badge: number | null }[] = [
    { id: 'overview', label: 'Overview', badge: null },
    { id: 'activity', label: 'Activity', badge: activityCount || null },
    { id: 'settings', label: 'Settings', badge: null },
  ];
  void stats;
  return (
    <div className={s.tabStrip}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          className={s.tab}
          data-active={current === t.id}
          onClick={() => onChange(t.id)}
        >
          <span>{t.label}</span>
          {t.badge != null && <span className={s.tabBadge}>{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}

// ── Overview tab ──────────────────────────────────────────────────────────

interface OverviewProps {
  songs: SongDto[];
  activity: ActivityItem[];
}

function OverviewTab({ songs, activity }: OverviewProps) {
  const recent = useMemo(() => {
    return [...songs]
      .filter((song) => song.archivedAt == null)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 4);
  }, [songs]);

  return (
    <div className={s.split}>
      <div className={s.column}>
        <div className="card card-body">
          <SectionTitle>Recent songs</SectionTitle>
          {recent.length === 0 ? (
            <div className={s.emptyHint}>
              Upload your first version from the{' '}
              <Link to="/library">library</Link> to see it here.
            </div>
          ) : (
            <div className={s.songList}>
              {recent.map((song) => (
                <SongRow key={song.id} song={song} />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className={s.column}>
        <div className="card card-body">
          <SectionTitle>Account</SectionTitle>
          <div className={s.planCard}>
            <div className={s.planName}>Free plan</div>
            <div className={s.planDescription}>
              Unlimited library size · on-demand AI specialists · single producer workspace
            </div>
          </div>
        </div>

        <div className="card card-body">
          <SectionTitle>Recent activity</SectionTitle>
          {activity.length === 0 ? (
            <div className={s.emptyHint}>No activity yet — upload a track to get started.</div>
          ) : (
            <div className={s.activityList}>
              {activity.slice(0, 5).map((a, i) => (
                <ActivityRow key={`${a.kind}-${i}`} item={a} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Activity tab ──────────────────────────────────────────────────────────

function ActivityTab({ activity }: { activity: ActivityItem[] }) {
  return (
    <div className="card card-body">
      <SectionTitle>Activity feed</SectionTitle>
      {activity.length === 0 ? (
        <div className={s.emptyHint}>No activity yet.</div>
      ) : (
        <div className={s.activityList}>
          {activity.map((a, i) => (
            <ActivityRow key={`${a.kind}-${i}`} item={a} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Settings tab ──────────────────────────────────────────────────────────

interface SettingsProps {
  displayName: string;
  handle: string | null;
  email: string;
  onSignOut: () => void;
}

function SettingsTab({ displayName, handle, email, onSignOut }: SettingsProps) {
  return (
    <div className={s.split}>
      <div className={s.column}>
        <div className="card card-body">
          <SectionTitle>Profile</SectionTitle>
          <div className={s.settingsList}>
            <SettingRow label="Display name" value={displayName} />
            <SettingRow
              label="Handle"
              value={handle ?? 'Not set yet'}
              muted={!handle}
            />
            <SettingRow label="Email" value={email} />
          </div>
        </div>
        <div className="card card-body">
          <SectionTitle>Session</SectionTitle>
          <p className={s.dangerNote}>
            Sign out of this device. Your refresh-token cookie will be cleared.
          </p>
          <button type="button" className="btn sm" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </div>
      <div className={s.column}>
        <div className="card card-body">
          <SectionTitle accent="orange">Danger zone</SectionTitle>
          <p className={s.dangerNote}>
            Export and account-deletion endpoints will land with the Discover slice. The
            buttons below are placeholders.
          </p>
          <div className={s.dangerActions}>
            <button type="button" className="btn sm" disabled>
              ⇣ Export all data
            </button>
            <button type="button" className={`btn sm ${s.dangerBtn}`} disabled>
              Delete account
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Shared pieces ─────────────────────────────────────────────────────────

function SettingRow({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className={s.settingRow}>
      <span className={s.settingLabel}>{label}</span>
      <span className={`${s.settingValue} ${muted ? s.settingValueMuted : ''}`.trim()}>
        {value}
      </span>
      <button type="button" className="btn ghost sm" disabled>
        Edit
      </button>
    </div>
  );
}

function SectionTitle({
  children,
  accent,
}: {
  children: React.ReactNode;
  accent?: 'cyan' | 'violet' | 'orange';
}) {
  const color =
    accent === 'violet'
      ? 'var(--violet)'
      : accent === 'orange'
        ? 'var(--orange)'
        : 'var(--cyan)';
  return (
    <div className={s.sectionTitle} style={{ ['--accent' as never]: color }}>
      {children}
    </div>
  );
}

function SongRow({ song }: { song: SongDto }) {
  const hue = hueFromId(song.id);
  const grade = normalizeGrade(song.latestResult?.grade);
  return (
    <Link
      to="/songs/$songId"
      params={{ songId: song.id }}
      className={s.songRow}
    >
      <CoverArt hue={hue} size="sm" />
      <div className={s.songMain}>
        <div className={s.songName}>{song.name}</div>
        <div className={s.songMeta}>
          {song.versions.length} version{song.versions.length === 1 ? '' : 's'}
          {song.genreHint ? ` · ${song.genreHint}` : ''}
        </div>
      </div>
      {grade && <GradePill grade={grade} size="sm" />}
    </Link>
  );
}

// ── Activity derivation ───────────────────────────────────────────────────

type ActivityKind = 'analysis' | 'song' | 'upload';

interface ActivityItem {
  kind: ActivityKind;
  body: React.ReactNode;
  at: Date;
}

function buildActivity(songs: SongDto[]): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const song of songs) {
    const created = new Date(song.createdAt);
    items.push({
      kind: 'song',
      body: (
        <>
          Created song <strong>{song.name}</strong>
        </>
      ),
      at: created,
    });
    if (song.latestResult) {
      const analyzed = new Date(song.latestResult.createdAt);
      const grade = normalizeGrade(song.latestResult.grade);
      items.push({
        kind: 'analysis',
        body: (
          <>
            Analyzed <strong>{song.name}</strong>
            {grade ? <> — graded <strong>{grade}</strong></> : null}
          </>
        ),
        at: analyzed,
      });
    }
    for (const v of song.versions) {
      const at = new Date(v.createdAt);
      items.push({
        kind: 'upload',
        body: (
          <>
            Uploaded version <strong>v{v.versionNumber}</strong>
            {v.label ? <> — {v.label}</> : null} of <strong>{song.name}</strong>
          </>
        ),
        at,
      });
    }
  }
  items.sort((a, b) => b.at.getTime() - a.at.getTime());
  return items;
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const glyph = item.kind === 'analysis' ? '◐' : item.kind === 'upload' ? '↑' : '✦';
  return (
    <div className={s.activityRow}>
      <div className={s.activityIcon} data-kind={item.kind} aria-hidden="true">
        {glyph}
      </div>
      <div className={s.activityText}>
        <div className={s.activityBody}>{item.body}</div>
        <div className={s.activityTime}>{relativeTime(item.at)}</div>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

function emailLocalPart(email: string): string {
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : email;
}

function relativeTime(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 14) return `${day}d ago`;
  return d.toLocaleDateString();
}
