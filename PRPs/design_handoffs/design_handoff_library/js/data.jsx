// data.jsx — mock library (SongDto-shaped + the new `visibility` field) and the
// shared visibility metadata. Spans every state the redesigned card must handle:
// each visibility value, 1→6 versions, analysis present / absent (Report gate),
// empty description / genre / tags (peek + chip omitted), and archived rows.

// ── Visibility model (agreed semantics from the design doc) ──────────────────
const VIS_META = {
  private: { label: 'Private', glyph: '🔒', desc: 'Only you' },
  shared:  { label: 'Shared',  glyph: '🔗', desc: 'Anyone with the link' },
  public:  { label: 'Public',  glyph: '🌐', desc: 'Listed + discoverable' },
};
const VIS_ORDER = ['private', 'shared', 'public'];

// ── Relative-time formatter (mirrors ui/relativeTime.ts house style) ─────────
const MIN = 60e3, HR = 3600e3, DAY = 86400e3;
function formatRelative(d) {
  const ms = Date.now() - new Date(d).getTime();
  if (ms < MIN) return 'just now';
  if (ms < HR) return `${Math.floor(ms / MIN)}m ago`;
  if (ms < DAY) return `${Math.floor(ms / HR)}h ago`;
  if (ms < 7 * DAY) return `${Math.floor(ms / DAY)}d ago`;
  if (ms < 30 * DAY) return `${Math.floor(ms / (7 * DAY))}w ago`;
  return `${Math.floor(ms / (30 * DAY))}mo ago`;
}
const ago = (ms) => new Date(Date.now() - ms).toISOString();

// color shorthand
const col = (l, c, h) => ({ l, c, h });

// version factory — newest last; latest = isCurrent
function versions(specs) {
  return specs.map((s, i) => ({
    id: `v-${Math.random().toString(36).slice(2, 8)}`,
    versionNumber: i + 1,
    label: s.label ?? null,
    isCurrent: i === specs.length - 1,
    createdAt: ago(s.age),
  }));
}
const result = (age) => ({ id: 'a' + Math.random().toString(36).slice(2, 7), jobId: 'j' + Math.random().toString(36).slice(2, 7), createdAt: ago(age) });

const LIBRARY = [
  {
    id: 'song-neon', name: 'Neon Arterial', genreHint: 'Trance', visibility: 'public',
    description: 'Festival-size rolling bassline; the breakdown still needs more air up top.',
    visualTemplate: 'skyline', visualPrimary: col(0.46, 0.16, 270), visualSecondary: col(0.72, 0.13, 210),
    versions: versions([
      { age: 30 * DAY, label: 'rough idea' }, { age: 18 * DAY, label: 'arrangement' },
      { age: 9 * DAY, label: 'mixdown' }, { age: 4 * DAY, label: 'master pass' }, { age: 2 * HR, label: 'loud master' },
    ]),
    latestResult: result(2 * HR),
    tags: [{ id: 't1', name: 'festival', isPublic: true }, { id: 't2', name: 'rolling-bass', isPublic: true }, { id: 't3', name: 'wip-breakdown', isPublic: false }],
    updatedAt: ago(2 * HR), archivedAt: null,
  },
  {
    id: 'song-subrosa', name: 'Sub Rosa', genreHint: 'Techno', visibility: 'shared',
    description: 'Hypnotic 909 loop — sent to Mara for a second opinion on the hats.',
    visualTemplate: 'vinyl', visualPrimary: col(0.72, 0.19, 352), visualSecondary: col(0.30, 0.03, 250),
    versions: versions([{ age: 12 * DAY, label: 'loop' }, { age: 6 * DAY, label: 'full take' }, { age: 20 * HR, label: 'hats fix' }]),
    latestResult: result(20 * HR),
    tags: [{ id: 't4', name: 'peak-time', isPublic: false }, { id: 't5', name: 'feedback', isPublic: false }],
    updatedAt: ago(20 * HR), archivedAt: null,
  },
  {
    id: 'song-glass', name: 'Glasshouse', genreHint: 'House', visibility: 'private',
    description: 'Sunday demo. Chords are nice; needs drums that aren\u2019t a placeholder loop.',
    visualTemplate: 'aurora', visualPrimary: col(0.74, 0.15, 172), visualSecondary: col(0.72, 0.13, 210),
    versions: versions([{ age: 5 * DAY, label: 'demo' }, { age: 3 * DAY, label: null }]),
    latestResult: null, // in progress → no Report
    tags: [{ id: 't6', name: 'demo', isPublic: false }],
    updatedAt: ago(3 * DAY), archivedAt: null,
  },
  {
    id: 'song-lantern', name: 'Paper Lanterns', genreHint: 'Lo-fi', visibility: 'shared',
    description: 'Tape-warm beat for the playlist pitch.',
    visualTemplate: 'cassette', visualPrimary: col(0.76, 0.16, 70), visualSecondary: col(0.40, 0.14, 320),
    versions: versions([
      { age: 22 * DAY, label: 'sketch' }, { age: 14 * DAY, label: 'beat' },
      { age: 8 * DAY, label: 'vox chop' }, { age: 36 * HR, label: 'final-ish' },
    ]),
    latestResult: result(36 * HR),
    tags: [{ id: 't7', name: 'playlist-pitch', isPublic: true }, { id: 't8', name: 'lofi', isPublic: true }, { id: 't9', name: 'tape', isPublic: false }, { id: 't10', name: 'chill', isPublic: false }, { id: 't11', name: 'beat', isPublic: false }],
    updatedAt: ago(36 * HR), archivedAt: null,
  },
  {
    id: 'song-gravity', name: 'Gravity Well', genreHint: 'Drum & Bass', visibility: 'public',
    description: 'Neuro roller. Six versions deep and the low-end finally translates.',
    visualTemplate: 'eq', visualPrimary: col(0.66, 0.17, 285), visualSecondary: col(0.72, 0.18, 25),
    versions: versions([
      { age: 40 * DAY, label: 'idea' }, { age: 31 * DAY, label: 'reese' }, { age: 24 * DAY, label: 'drums' },
      { age: 15 * DAY, label: 'mix v1' }, { age: 7 * DAY, label: 'mix v2' }, { age: 5 * DAY, label: 'master' },
    ]),
    latestResult: result(5 * DAY),
    tags: [{ id: 't12', name: 'neuro', isPublic: true }, { id: 't13', name: 'roller', isPublic: false }],
    updatedAt: ago(5 * DAY), archivedAt: null,
  },
  {
    id: 'song-honest', name: 'Honest Mistake', genreHint: 'Pop', visibility: 'private',
    description: '', // empty → no description peek
    visualTemplate: 'boombox', visualPrimary: col(0.72, 0.18, 25), visualSecondary: col(0.72, 0.13, 210),
    versions: versions([{ age: 6 * HR, label: 'voice memo' }]),
    latestResult: null,
    tags: [],
    updatedAt: ago(6 * HR), archivedAt: null,
  },
  {
    id: 'song-coldopen', name: 'Cold Open', genreHint: 'Ambient', visibility: 'private',
    description: 'Drone intro for the set. Coach flagged a phase issue in the low mids.',
    visualTemplate: 'robot', visualPrimary: col(0.34, 0.10, 250), visualSecondary: col(0.50, 0.13, 165),
    versions: versions([{ age: 11 * DAY, label: 'drone' }, { age: 4 * DAY, label: 'phase fix' }]),
    latestResult: result(4 * DAY),
    tags: [{ id: 't14', name: 'intro', isPublic: false }],
    updatedAt: ago(4 * DAY), archivedAt: null,
  },
  {
    id: 'song-wax', name: 'Wax & Wane', genreHint: 'Hip-Hop', visibility: 'shared',
    description: 'Boom-bap flip — waiting on the verse before I master.',
    visualTemplate: 'spin', visualPrimary: col(0.54, 0.15, 48), visualSecondary: col(0.76, 0.16, 70),
    versions: versions([{ age: 17 * DAY, label: 'flip' }, { age: 10 * DAY, label: 'drums' }, { age: 2 * DAY, label: 'hook' }]),
    latestResult: result(2 * DAY),
    tags: [{ id: 't15', name: 'boom-bap', isPublic: true }, { id: 't16', name: 'sample', isPublic: false }],
    updatedAt: ago(2 * DAY), archivedAt: null,
  },
  {
    id: 'song-marrow', name: 'Marrow', genreHint: null, // no genre chip
    visibility: 'private', description: '', // bare card — exercises every empty-state
    visualTemplate: 'aurora', visualPrimary: col(0.66, 0.17, 285), visualSecondary: col(0.46, 0.16, 270),
    versions: versions([{ age: 90 * MIN, label: null }]),
    latestResult: null, tags: [],
    updatedAt: ago(90 * MIN), archivedAt: null,
  },
  {
    id: 'song-afterglow', name: 'Afterglow', genreHint: 'Trance', visibility: 'private',
    description: 'Old uplifter — superseded by Neon Arterial. Kept for the pad.',
    visualTemplate: 'booth', visualPrimary: col(0.72, 0.19, 352), visualSecondary: col(0.66, 0.17, 285),
    versions: versions([{ age: 120 * DAY, label: 'v1' }, { age: 110 * DAY, label: 'v2' }, { age: 100 * DAY, label: 'v3' }, { age: 92 * DAY, label: 'final' }]),
    latestResult: result(92 * DAY),
    tags: [{ id: 't17', name: 'uplifting', isPublic: false }, { id: 't18', name: 'archive', isPublic: false }],
    updatedAt: ago(92 * DAY), archivedAt: ago(60 * DAY),
  },
  {
    id: 'song-bounce', name: 'Test Bounce 3', genreHint: null, visibility: 'private',
    description: '', visualTemplate: 'aurora', visualPrimary: col(0.30, 0.03, 250), visualSecondary: col(0.34, 0.10, 250),
    versions: versions([{ age: 200 * DAY, label: null }]),
    latestResult: null, tags: [],
    updatedAt: ago(180 * DAY), archivedAt: ago(150 * DAY),
  },
];

Object.assign(window, { LIBRARY, VIS_META, VIS_ORDER, formatRelative });
