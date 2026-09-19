// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SongDto, VersionDto } from '../../../api/types';
import s from '../../../routes/_app/library.module.css';

// React act() environment flag (suppresses the act-not-configured warning).
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── Module mocks (all referenced vars are `mock`-prefixed per Vitest hoisting) ──
const mockNavigate = vi.fn();
const mockDeleteMutateAsync = vi.fn().mockResolvedValue(undefined);
const mockArchiveMutateAsync = vi.fn().mockResolvedValue(undefined);
const mockRestoreMutateAsync = vi.fn().mockResolvedValue(undefined);
const mockSongs: { data: SongDto[] } = { data: [] };

vi.mock('@tanstack/react-router', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Link: ({ children, onClick, className }: any) => (
    <a className={className} onClick={onClick} href="#">
      {children}
    </a>
  ),
  useNavigate: () => mockNavigate,
}));

vi.mock('../../../api/hooks', () => ({
  useSongs: () => ({ data: mockSongs.data, isLoading: false, error: null }),
  useArchiveSong: () => ({ mutateAsync: mockArchiveMutateAsync, isPending: false }),
  useRestoreSong: () => ({ mutateAsync: mockRestoreMutateAsync, isPending: false }),
  useDeleteSong: () => ({ mutateAsync: mockDeleteMutateAsync, isPending: false }),
}));

vi.mock('../../../components/NewSongDialog', () => ({ NewSongDialog: () => null }));
vi.mock('../../../components/UnifiedUploadDialog', () => ({ UnifiedUploadDialog: () => null }));
vi.mock('../../../components/SongEditDialog', () => ({ SongEditDialog: () => null }));
vi.mock('../../../components/ConfirmDialog', () => ({
  // Deterministic stub: renders the title + a confirm button wired to onConfirm.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConfirmDialog: ({ open, title, confirmLabel, onConfirm }: any) =>
    open ? (
      <div role="alertdialog">
        <h2>{title}</h2>
        <button type="button" onClick={() => onConfirm()}>
          {confirmLabel}
        </button>
      </div>
    ) : null,
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { SongsLibrarySection } from '../SongsLibrarySection';

// ── helpers ───────────────────────────────────────────────────────────────────
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();

function version(n: number, over: Partial<VersionDto> = {}): VersionDto {
  return {
    id: `ver-${n}`,
    songId: 'song',
    versionNumber: n,
    label: null,
    isCurrent: false,
    filePath: '',
    createdAt: iso(n),
    alsFilePath: null,
    referencePath: null,
    ...over,
  };
}

function song(over: Partial<SongDto> = {}): SongDto {
  return {
    id: `id-${Math.random().toString(36).slice(2, 7)}`,
    name: 'Untitled',
    genreHint: null,
    createdAt: iso(10),
    updatedAt: iso(1),
    archivedAt: null,
    versions: [version(1)],
    latestResult: null,
    tags: [],
    ...over,
  };
}

let root: Root;
let container: HTMLDivElement;

function render(ui: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(ui);
  });
}

function click(el: Element | null | undefined) {
  if (!el) throw new Error('click target missing');
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function cardFor(name: string): HTMLElement {
  const link = [...document.querySelectorAll('a')].find((a) => a.textContent === name);
  if (!link) throw new Error(`no card for "${name}"`);
  const article = link.closest('article');
  if (!article) throw new Error(`card "${name}" not an article`);
  return article as HTMLElement;
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

beforeEach(() => {
  mockSongs.data = [];
});

describe('SongsLibrarySection — gating, strip', () => {
  it('renders song cards with no grade/score leaked anywhere', () => {
    mockSongs.data = [
      song({ id: 'p', name: 'SongOne' }),
      song({ id: 's', name: 'SongTwo' }),
      song({ id: 'u', name: 'SongThree' }),
    ];
    render(<SongsLibrarySection />);

    expect(cardFor('SongOne')).toBeTruthy();
    expect(cardFor('SongTwo')).toBeTruthy();
    expect(cardFor('SongThree')).toBeTruthy();
    // No grade pill / score text leaked onto the page.
    expect(document.body.textContent).not.toMatch(/\/100/);
    expect(document.body.textContent?.toLowerCase()).not.toContain('grade');
  });

  it('shows the description peek only when a non-empty description exists', () => {
    mockSongs.data = [
      song({ name: 'WithDesc', description: 'a rolling bassline' }),
      song({ name: 'BlankDesc', description: '   ' }),
      song({ name: 'NullDesc', description: null }),
    ];
    render(<SongsLibrarySection />);
    expect(cardFor('WithDesc').querySelector(`.${s.descPeek}`)).not.toBeNull();
    expect(cardFor('BlankDesc').querySelector(`.${s.descPeek}`)).toBeNull();
    expect(cardFor('NullDesc').querySelector(`.${s.descPeek}`)).toBeNull();
  });

  it('renders the version strip as display-only (no buttons inside it)', () => {
    mockSongs.data = [song({ name: 'Striped', versions: [version(1), version(2), version(3)] })];
    render(<SongsLibrarySection />);
    const strip = cardFor('Striped').querySelector(`.${s.vstrip}`);
    expect(strip).not.toBeNull();
    expect(strip!.querySelectorAll('button').length).toBe(0);
  });
});

describe('SongsLibrarySection — Play + Report', () => {
  it('Play navigates to the latest version in the listen rack', () => {
    mockSongs.data = [
      song({
        id: 'sg',
        name: 'PlayMe',
        versions: [version(1), version(2), version(3, { id: 'ver-latest' })],
      }),
    ];
    render(<SongsLibrarySection />);
    const play = cardFor('PlayMe').querySelector('button[title="Play latest version"]');
    click(play);
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/listen-rack/$versionId',
      params: { versionId: 'ver-latest' },
    });
  });

  it('shows Analysis Results only when latestResult is present', () => {
    mockSongs.data = [
      song({
        id: 'a',
        name: 'Analyzed',
        latestResult: { id: 'an', jobId: 'job-7', createdAt: iso(1), grade: null, score: null },
      }),
      song({ id: 'b', name: 'Pending', latestResult: null }),
    ];
    render(<SongsLibrarySection />);
    const withResult = [...cardFor('Analyzed').querySelectorAll('button')].some((b) =>
      b.textContent?.includes('Analysis Results'),
    );
    const withoutResult = [...cardFor('Pending').querySelectorAll('button')].some((b) =>
      b.textContent?.includes('Analysis Results'),
    );
    expect(withResult).toBe(true);
    expect(withoutResult).toBe(false);

    // …and it routes to the report for the latest analysis job.
    const reportBtn = [...cardFor('Analyzed').querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Analysis Results'),
    );
    click(reportBtn);
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/songs/$songId/results/$jobId',
      params: { songId: 'a', jobId: 'job-7' },
    });
  });
});

describe('SongsLibrarySection — filters + counts', () => {
  function dataset(): SongDto[] {
    return [
      song({ id: '1', name: 'S1' }),
      song({ id: '2', name: 'S2' }),
      song({ id: '3', name: 'S3' }),
      song({ id: '4', name: 'S4' }),
      song({ id: '5', name: 'Arc', archivedAt: iso(3) }),
    ];
  }

  function pill(label: string): HTMLElement {
    const el = [...document.querySelectorAll(`.${s.filterPill}`)].find((p) =>
      p.textContent?.includes(label),
    );
    if (!el) throw new Error(`no pill ${label}`);
    return el as HTMLElement;
  }

  it('pill counts reflect the (archived-excluded) library', () => {
    mockSongs.data = dataset();
    render(<SongsLibrarySection />);
    expect(pill('All').textContent).toContain('4'); // archived excluded
    expect(pill('Archived').textContent).toContain('1');
  });

  it('clicking Archived filters the grid to only archived songs', () => {
    mockSongs.data = dataset();
    render(<SongsLibrarySection />);
    click(pill('Archived'));
    // Only the archived song shows now.
    expect(document.querySelectorAll('article').length).toBe(1);
    expect(cardFor('Arc')).toBeTruthy();
  });
});

describe('SongsLibrarySection — tag refine row', () => {
  function dataset(): SongDto[] {
    return [
      song({ id: '1', name: 'Festy', tags: [{ id: 'a', name: 'festival' }] }),
      song({ id: '2', name: 'Demoy', tags: [{ id: 'b', name: 'demo' }] }),
      song({
        id: '3',
        name: 'Both',
        tags: [
          { id: 'c', name: 'festival' },
          { id: 'd', name: 'demo' },
        ],
      }),
    ];
  }
  function tagChip(name: string): HTMLElement {
    const el = [...document.querySelectorAll(`.${s.tagChip}`)].find((c) =>
      c.textContent?.startsWith(`#${name}`),
    );
    if (!el) throw new Error(`no tag chip ${name}`);
    return el as HTMLElement;
  }

  it('union-filters by selected tags and clears', () => {
    mockSongs.data = dataset();
    render(<SongsLibrarySection />);
    // Select #demo → Demoy + Both.
    click(tagChip('demo'));
    expect([...document.querySelectorAll('article a')].map((a) => a.textContent).sort()).toContain(
      'Demoy',
    );
    expect(document.querySelectorAll('article').length).toBe(2);

    // Add #festival → union now matches all three.
    click(tagChip('festival'));
    expect(document.querySelectorAll('article').length).toBe(3);

    // Clear resets.
    const clear = document.querySelector(`.${s.tagClear}`);
    click(clear);
    expect(document.querySelectorAll('article').length).toBe(3);
    expect(document.querySelector(`.${s.tagClear}`)).toBeNull();
  });

  it('clicking a card tag toggles the same filter', () => {
    mockSongs.data = dataset();
    render(<SongsLibrarySection />);
    const cardTag = [...cardFor('Festy').querySelectorAll('button')].find(
      (b) => b.textContent === 'festival',
    );
    click(cardTag);
    // festival → Festy + Both.
    expect(document.querySelectorAll('article').length).toBe(2);
  });
});

describe('SongsLibrarySection — kebab menu', () => {
  function openMenu(name: string) {
    const trigger = cardFor(name).querySelector('button[aria-label="Song actions"]');
    click(trigger);
  }

  it('Delete opens a confirm dialog, then calls the hard-delete hook', async () => {
    mockSongs.data = [song({ id: 'del-1', name: 'Doomed', versions: [version(1), version(2)] })];
    render(<SongsLibrarySection />);
    openMenu('Doomed');

    const delItem = [...document.querySelectorAll('[role="menuitem"]')].find(
      (b) => b.textContent?.trim().endsWith('Delete'),
    );
    click(delItem);

    // Confirm dialog (stubbed) is now open with the destructive copy.
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent).toContain('Doomed');

    const confirm = [...dialog!.querySelectorAll('button')].find(
      (b) => b.textContent === 'Delete song',
    );
    await act(async () => {
      confirm!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(mockDeleteMutateAsync).toHaveBeenCalledWith('del-1');
  });

  it('Archive calls the archive hook for an active song', async () => {
    mockSongs.data = [song({ id: 'arc-1', name: 'Keeper', archivedAt: null })];
    render(<SongsLibrarySection />);
    openMenu('Keeper');
    const archiveItem = [...document.querySelectorAll('[role="menuitem"]')].find(
      (b) => b.textContent?.trim().endsWith('Archive'),
    );
    await act(async () => {
      archiveItem!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(mockArchiveMutateAsync).toHaveBeenCalledWith('arc-1');
  });
});
