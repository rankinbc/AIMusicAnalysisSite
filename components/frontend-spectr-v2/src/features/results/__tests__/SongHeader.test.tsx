// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SongHeader } from '../SongHeader';

// GenreCorrectChip owns a mutation; it is out of scope here.
vi.mock('../GenreCorrectChip', () => ({ GenreCorrectChip: () => null }));

afterEach(cleanup);

const base = {
  songId: 's',
  versionId: 'v',
  versionLabel: 'v1',
  trackName: 'Demo: Sample track',
  genre: null,
  durationSeconds: 74,
  inputs: { mix: true, stems: false, als: false, reference: false },
  findingCount: 3,
  suggestionCount: 2,
  onAddInputs: () => {},
};

describe('SongHeader', () => {
  it('shows the song description (a demo track credit) under the title', () => {
    render(<SongHeader {...base} description="Sample analysis of a demo track, used only as a SPECTR demo." />);
    expect(screen.getByText(/used only as a SPECTR demo/)).toBeTruthy();
  });

  it('renders no description line when there is none', () => {
    const { container } = render(<SongHeader {...base} description={null} />);
    expect(container.querySelector('.rh-desc')).toBeNull();
  });

  it('ticks only the inputs that were analysed and offers to add the rest', () => {
    render(<SongHeader {...base} />);
    expect(screen.getByText('Primary mix')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add stems/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add \.als/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add reference/ })).toBeTruthy();
  });
});
