// @vitest-environment jsdom
// "Listen while it analyzes": the analysis page's play button plays the
// uploaded mix (GET /api/versions/{id}/audio?t=<jwt>), the Listen page's
// floor grid + smoke + bloom fill the page behind the box only while it
// plays, the music survives the live → report hand-off, and everything stops
// and is released when the page goes away. No version → no player.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../GenreCorrectChip', () => ({ GenreCorrectChip: () => <span>Correct</span> }));
vi.mock('../../billing/CostTag', () => ({ CostTag: () => <span>Included</span> }));
vi.mock('../../../ui/Coach', () => ({ Coach: () => <span data-testid="coach-mascot" /> }));
vi.mock('../../../ui/SpecialistBot', () => ({ SpecialistBot: () => <span data-testid="spec-bot" /> }));
vi.mock('../../../api/fetcher', () => ({ getAccessToken: () => 'tok-1', fetcher: vi.fn() }));

import type { JobStatusDto } from '../../../api/types';
import { AnalysisCompleteModal } from '../AnalysisCompleteModal';
import { BACKDROP_FADE_MS } from '../LiveListenBackdrop';
import { LivePlayerProvider } from '../LivePlayerProvider';
import { resetNarrationLogs } from '../useLiveNarration';

const job: JobStatusDto = {
  id: 'job-p',
  status: 'processing',
  currentPhase: 'Universal Mix Analysis',
  phasePct: 0,
  versionId: 'v1',
  songId: 's1',
  errorMessage: null,
  dispatchedAt: new Date().toISOString(),
  startedAt: null,
  completedAt: null,
  failedAt: null,
  partial: null,
};

// jsdom has no media playback or Web Audio — minimal, observable stand-ins.
const play = vi.fn(function (this: HTMLMediaElement & { _paused?: boolean }) {
  this._paused = false;
  this.dispatchEvent(new Event('play'));
  return Promise.resolve();
});
const pause = vi.fn(function (this: HTMLMediaElement & { _paused?: boolean }) {
  if (this._paused === false) {
    this._paused = true;
    this.dispatchEvent(new Event('pause'));
  }
});
const ctxClose = vi.fn(() => Promise.resolve());
const ctxCreated = vi.fn();
class FakeAudioContext {
  destination = {};
  constructor() {
    ctxCreated();
  }
  createMediaElementSource() {
    return { connect: vi.fn() };
  }
  createAnalyser() {
    return {
      fftSize: 0,
      smoothingTimeConstant: 0,
      frequencyBinCount: 8,
      connect: vi.fn(),
      getByteFrequencyData: (a: Uint8Array) => a.fill(128),
    };
  }
  resume() {
    return Promise.resolve();
  }
  close = ctxClose;
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
    configurable: true,
    get(this: { _paused?: boolean }) {
      return this._paused ?? true;
    },
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pause);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  play.mockClear();
  pause.mockClear();
  ctxClose.mockClear();
  ctxCreated.mockClear();
  delete (window as unknown as { AudioContext?: unknown }).AudioContext;
  resetNarrationLogs();
});

const page = <AnalysisCompleteModal jobId="job-p" job={job} songName="Neon Meridian" onViewReport={vi.fn()} />;
const playBtn = () => screen.getByTestId('acm-play') as HTMLButtonElement;
const audioEl = () => document.querySelector('audio')!;

describe('live page player', () => {
  it('plays the uploaded mix from the audio endpoint and toggles play/pause', () => {
    render(<LivePlayerProvider versionId="v1">{page}</LivePlayerProvider>);
    const a = audioEl();
    expect(a.getAttribute('src')).toBe('/api/versions/v1/audio?t=tok-1');
    expect(a.getAttribute('crossorigin')).toBe('anonymous');
    expect(playBtn().getAttribute('aria-label')).toBe('Play your track');
    expect(ctxCreated).not.toHaveBeenCalled(); // no AudioContext before a gesture

    fireEvent.click(playBtn());
    expect(play).toHaveBeenCalledTimes(1);
    expect(ctxCreated).toHaveBeenCalledTimes(1); // created on the click
    expect(playBtn().getAttribute('aria-label')).toBe('Pause your track');

    fireEvent.click(playBtn());
    expect(pause).toHaveBeenCalledTimes(1);
    expect(playBtn().getAttribute('aria-label')).toBe('Play your track');

    fireEvent.click(playBtn());
    expect(play).toHaveBeenCalledTimes(2);
    expect(ctxCreated).toHaveBeenCalledTimes(1); // one graph per element, ever
  });

  it('mounts the background visuals only while playing, fading out on pause', () => {
    render(<LivePlayerProvider versionId="v1">{page}</LivePlayerProvider>);
    expect(screen.queryByTestId('acm-listen-bg')).toBeNull();

    fireEvent.click(playBtn());
    const bg = screen.getByTestId('acm-listen-bg');
    expect(bg.getAttribute('data-on')).toBe('true');
    expect(bg.querySelectorAll('canvas').length).toBe(2); // floor grid + smoke/bloom stage

    fireEvent.click(playBtn());
    expect(screen.getByTestId('acm-listen-bg').getAttribute('data-on')).toBe('false');
    act(() => {
      vi.advanceTimersByTime(BACKDROP_FADE_MS);
    });
    expect(screen.queryByTestId('acm-listen-bg')).toBeNull();
  });

  it('keeps playing across the live → report hand-off', () => {
    const { rerender } = render(<LivePlayerProvider versionId="v1"><div key="live">{page}</div></LivePlayerProvider>);
    fireEvent.click(playBtn());
    // A different tree mounts the analysis page in the same commit.
    rerender(<LivePlayerProvider versionId="v1"><section key="report">{page}</section></LivePlayerProvider>);
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(pause).not.toHaveBeenCalled();
    expect(playBtn().getAttribute('aria-label')).toBe('Pause your track');
  });

  it('stops when the page is gone (report opened) and releases everything on unmount', () => {
    const { rerender, unmount } = render(<LivePlayerProvider versionId="v1">{page}</LivePlayerProvider>);
    fireEvent.click(playBtn());
    rerender(<LivePlayerProvider versionId="v1">{null}</LivePlayerProvider>);
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(pause).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('acm-listen-bg')).toBeNull();

    unmount();
    expect(ctxClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('audio')).toBeNull();
  });

  it('pauses the music when leaving the page mid-song', () => {
    const { unmount } = render(<LivePlayerProvider versionId="v1">{page}</LivePlayerProvider>);
    fireEvent.click(playBtn());
    unmount();
    expect(pause).toHaveBeenCalled();
    expect(ctxClose).toHaveBeenCalledTimes(1);
  });

  it('reduced motion: one still frame, no animation loop', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (q: string) =>
        ({ matches: q.includes('reduce'), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as MediaQueryList,
    );
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    render(<LivePlayerProvider versionId="v1">{page}</LivePlayerProvider>);
    fireEvent.click(playBtn());
    expect(screen.getByTestId('acm-listen-bg')).toBeTruthy();
    expect(raf).not.toHaveBeenCalled();
  });

  it('has no player for a job without a version (anon) or outside a provider', () => {
    render(<LivePlayerProvider versionId={null}>{page}</LivePlayerProvider>);
    expect(screen.queryByTestId('acm-play')).toBeNull();
    expect(document.querySelector('audio')).toBeNull();
    cleanup();
    render(page);
    expect(screen.queryByTestId('acm-play')).toBeNull();
    expect(screen.queryByTestId('acm-listen-bg')).toBeNull();
  });
});
