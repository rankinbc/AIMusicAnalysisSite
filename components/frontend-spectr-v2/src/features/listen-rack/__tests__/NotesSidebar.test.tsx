/* Listen Rack — private workbench: the notes sidebar is now notes-only (no
 * chat/room tabs). Render-level smoke: renders notes, highlights the active
 * note, and clicking a note calls onNote. */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TrackNote } from '../data';
import { NotesSidebar } from '../NotesSidebar';

afterEach(cleanup);

const NOTES: TrackNote[] = [
  { id: 'n1', t: 18, text: 'Opener feels right', pinned: true },
  { id: 'n2', t: 64, text: 'Drop A bass check', pinned: false },
];

describe('NotesSidebar', () => {
  it('renders every note', () => {
    render(<NotesSidebar notes={NOTES} activeNote={null} onNote={vi.fn()} />);
    expect(screen.getByText('Opener feels right')).toBeTruthy();
    expect(screen.getByText('Drop A bass check')).toBeTruthy();
  });

  it('highlights the active note', () => {
    render(<NotesSidebar notes={NOTES} activeNote="n2" onNote={vi.fn()} />);
    const active = screen.getByText('Drop A bass check').closest('button');
    const inactive = screen.getByText('Opener feels right').closest('button');
    expect(active?.className).toContain('on');
    expect(inactive?.className).not.toContain('on');
  });

  it('clicking a note calls onNote with that note', () => {
    const onNote = vi.fn();
    render(<NotesSidebar notes={NOTES} activeNote={null} onNote={onNote} />);
    screen.getByText('Opener feels right').closest('button')?.click();
    expect(onNote).toHaveBeenCalledWith(NOTES[0]);
  });
});
