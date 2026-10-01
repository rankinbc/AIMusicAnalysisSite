// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('../../listen-rack/useRackPresets', () => ({ useRackPresets: () => ({ data: [] }) }));

import { SendToListenCard } from '../SendToListenCard';

beforeEach(() => navigate.mockReset());
afterEach(cleanup);

const base = { jobId: 'j', fixRack: null, onOpenGamePlan: () => {} };

describe('SendToListenCard', () => {
  // A first-time visitor (e.g. the demo) has queued nothing yet — Listen must
  // still open the track, or the Listen page is unreachable from the report.
  it('Listen opens the Listen page even with nothing queued', () => {
    render(<SendToListenCard {...base} versionId="v1" committedCount={0} />);
    fireEvent.click(screen.getByRole('button', { name: /^Listen$/ }));
    expect(navigate).toHaveBeenCalledWith({
      to: '/listen-rack/$versionId',
      params: { versionId: 'v1' },
      search: {},
    });
  });

  it('Listen is not offered as a button before a version exists', () => {
    render(<SendToListenCard {...base} versionId={null} committedCount={0} />);
    expect(screen.queryByRole('button', { name: /^Listen$/ })).toBeNull();
  });
});
