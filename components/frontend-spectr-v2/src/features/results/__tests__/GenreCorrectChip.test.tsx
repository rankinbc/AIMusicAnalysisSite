// @vitest-environment jsdom
// Item 1 (genre confirm/correct chip): the trigger opens a fixed genre
// choice list, picking one fires useConfirmGenre with the expected payload,
// and reaching a terminal rerun-job status toasts + clears the pending state.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { confirmGenreMock, toastSuccessMock, toastErrorMock, rerunState } = vi.hoisted(() => ({
  confirmGenreMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  rerunState: { status: undefined as string | undefined },
}));

vi.mock('../../../api/hooks', () => ({
  GENRE_HINT_OPTIONS: ['trance', 'house', 'techno', 'dnb', 'other'],
  useConfirmGenre: () => ({ mutate: confirmGenreMock }),
  useRerunJobStatus: () => ({ data: rerunState.status ? { status: rerunState.status } : undefined }),
}));
vi.mock('sonner', () => ({ toast: { success: toastSuccessMock, error: toastErrorMock } }));

import { GenreCorrectChip } from '../GenreCorrectChip';

type MutateOptions = { onSuccess: (res: { jobId: string }) => void; onError: () => void };

describe('GenreCorrectChip', () => {
  beforeEach(() => {
    confirmGenreMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    rerunState.status = undefined;
  });
  afterEach(() => {
    cleanup();
    rerunState.status = undefined;
  });

  it('shows a "Correct" trigger, not the option list, by default', () => {
    render(<GenreCorrectChip jobId="job-1" genre="house" />);
    expect(screen.getByText('Correct')).toBeTruthy();
    expect(screen.queryByText('Techno')).toBeNull();
  });

  it('clicking the trigger reveals every OTHER genre option, excluding the current one', () => {
    render(<GenreCorrectChip jobId="job-1" genre="house" />);
    fireEvent.click(screen.getByText('Correct'));
    expect(screen.getByText('Techno')).toBeTruthy();
    expect(screen.getByText('Trance')).toBeTruthy();
    expect(screen.getByText('Dnb')).toBeTruthy();
    expect(screen.getByText('Other')).toBeTruthy();
    expect(screen.queryByText('House')).toBeNull(); // current genre isn't offered
  });

  it('picking an option calls useConfirmGenre.mutate with that genre hint', () => {
    render(<GenreCorrectChip jobId="job-1" genre="house" />);
    fireEvent.click(screen.getByText('Correct'));
    fireEvent.click(screen.getByText('Techno'));

    expect(confirmGenreMock).toHaveBeenCalledTimes(1);
    expect(confirmGenreMock.mock.calls[0][0]).toBe('techno');
  });

  it('enters the "Updating…" state once the mutation resolves with a rerun jobId', () => {
    render(<GenreCorrectChip jobId="job-1" genre="house" />);
    fireEvent.click(screen.getByText('Correct'));
    fireEvent.click(screen.getByText('Techno'));

    const opts = confirmGenreMock.mock.calls[0][1] as MutateOptions;
    act(() => opts.onSuccess({ jobId: 'rerun-1' }));

    expect(screen.getByText('Updating…')).toBeTruthy();
  });

  it('toasts success and clears pending state when the rerun job completes', () => {
    const { rerender } = render(<GenreCorrectChip jobId="job-1" genre="house" />);
    fireEvent.click(screen.getByText('Correct'));
    fireEvent.click(screen.getByText('Techno'));
    const opts = confirmGenreMock.mock.calls[0][1] as MutateOptions;
    act(() => opts.onSuccess({ jobId: 'rerun-1' }));

    rerunState.status = 'complete';
    rerender(<GenreCorrectChip jobId="job-1" genre="house" />);

    expect(toastSuccessMock).toHaveBeenCalledWith(
      'Genre corrected — score and findings updated.',
    );
  });

  it('toasts an error and clears pending state when the rerun job fails', () => {
    const { rerender } = render(<GenreCorrectChip jobId="job-1" genre="house" />);
    fireEvent.click(screen.getByText('Correct'));
    fireEvent.click(screen.getByText('Techno'));
    const opts = confirmGenreMock.mock.calls[0][1] as MutateOptions;
    act(() => opts.onSuccess({ jobId: 'rerun-1' }));

    rerunState.status = 'failed';
    rerender(<GenreCorrectChip jobId="job-1" genre="house" />);

    expect(toastErrorMock).toHaveBeenCalledWith(
      'Could not apply the genre correction. Try again.',
    );
  });
});
