// @vitest-environment jsdom
/* Wave-3 E7.1 (Task 10) — the minimal owner share/invite dialog: settings
 * load renders the visibility select + listen link + invite list; a created
 * invite appends to the list after the invalidation refetch. Mirrors the
 * SharePublishDialog test harness (fetch stub). */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { InviteDto, ShareSettingsDto } from '../../../api/types';
import { VersionShareDialog } from '../VersionShareDialog';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SETTINGS: ShareSettingsDto = {
  versionId: 'v1',
  visibility: 'unlisted',
  shareToken: 'tok-abc',
  showVerdicts: true,
  commentsPolicy: 'link',
  suggestionsAllowed: true,
  bookmarkingAllowed: true,
  sessionHostPolicy: 'owner_only',
  sessionJoinPolicy: 'invited',
  enabledAt: '2026-07-01T00:00:00Z',
};

function invite(over: Partial<InviteDto>): InviteDto {
  return {
    id: 'i1',
    scope: 'version',
    songVersionId: 'v1',
    role: 'reviewer',
    status: 'pending',
    invitedEmail: null,
    invitedHandle: 'kojo',
    token: 'inv-tok-1',
    createdAt: '2026-07-01T00:00:00Z',
    acceptedAt: null,
    ...over,
  };
}

/** Stateful fetch stub: GET share/invites; POST invites appends. */
function stubApi(invites: InviteDto[]) {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/share')) return json(SETTINGS);
      if (url.endsWith('/invites') && method === 'POST') {
        const created = invite({ id: `i${invites.length + 1}`, invitedHandle: 'newperson', token: `inv-tok-${invites.length + 1}` });
        invites.push(created);
        return json(created);
      }
      if (url.endsWith('/invites')) return json([...invites]);
      return new Response(null, { status: 404 });
    }),
  );
}

function renderOpen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <VersionShareDialog open onOpenChange={() => {}} versionId="v1" songName="Night Drive" />
    </QueryClientProvider>,
  );
}

describe('VersionShareDialog (E7.1)', () => {
  it('renders visibility, the /v/{token} listen link, and the invite list', async () => {
    stubApi([invite({})]);
    renderOpen();

    const select = (await screen.findByLabelText(/Visibility/)) as HTMLSelectElement;
    expect(select.value).toBe('unlisted');

    const linkInput = (await screen.findByDisplayValue(/\/v\/tok-abc$/)) as HTMLInputElement;
    expect(linkInput.value).toContain('/v/tok-abc');
    expect(screen.getByText('↻ Rotate')).toBeTruthy();

    expect(await screen.findByText('@kojo')).toBeTruthy();
    expect(screen.getByText('pending')).toBeTruthy();
    expect(screen.getByText('Revoke')).toBeTruthy();
  });

  it('created invite appends to the list (invalidation refetch)', async () => {
    stubApi([invite({})]);
    renderOpen();
    await screen.findByText('@kojo');

    fireEvent.click(screen.getByText('Invite'));
    expect(await screen.findByText('@newperson')).toBeTruthy();
    // The original invite is still listed — appended, not replaced.
    expect(screen.getByText('@kojo')).toBeTruthy();
  });
});
