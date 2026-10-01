import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetcherMock = vi.fn();
vi.mock('../../../api/fetcher', () => ({ fetcher: (...a: unknown[]) => fetcherMock(...a) }));

import type { AuthedUser, GuestStateDto } from '../../../api/types';
import { guestHasOwnUploads } from '../../demo/useGuestState';
import { guestMayOpenLibrary } from '../library-guard';

const guest = { id: 'g', email: 'g@x', isGuest: true } as AuthedUser;
const realUser = { id: 'r', email: 'r@x', isGuest: false } as AuthedUser;
const state = (uploadsUsed: number): GuestStateDto => ({
  uploadsUsed, uploadsMax: 2, analysesUsed: 0, analysesMax: 6, coachMessagesUsed: 0,
  coachMessagesMax: 20, expiresAt: null, stemsMaxFiles: 12, stemsMaxMb: 300,
  referencesUsed: 0, referencesMax: 1,
});

describe('guestHasOwnUploads', () => {
  it('true once the guest has an upload of their own', () => {
    expect(guestHasOwnUploads(state(1))).toBe(true);
  });
  it('false for the seeded-demo-only guest (uploadsUsed excludes audio/demo/)', () => {
    expect(guestHasOwnUploads(state(0))).toBe(false);
  });
  it('false while the state is unknown', () => {
    expect(guestHasOwnUploads(undefined)).toBe(false);
  });
});

describe('guestMayOpenLibrary', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    queryClient = new QueryClient();
    fetcherMock.mockReset();
  });
  afterEach(() => queryClient.clear());

  it('real user: open, no guest-state fetch', async () => {
    expect(await guestMayOpenLibrary({ queryClient, auth: { user: realUser } })).toBe(true);
    expect(fetcherMock).not.toHaveBeenCalled();
  });

  it('guest with only the seeded demo: closed', async () => {
    fetcherMock.mockResolvedValue(state(0));
    expect(await guestMayOpenLibrary({ queryClient, auth: { user: guest } })).toBe(false);
    expect(fetcherMock).toHaveBeenCalledWith({ url: '/me/guest', method: 'GET' });
  });

  it('guest who uploaded a track: open', async () => {
    fetcherMock.mockResolvedValue(state(1));
    expect(await guestMayOpenLibrary({ queryClient, auth: { user: guest } })).toBe(true);
  });

  it('guest-state fetch fails: closed (never a broken library)', async () => {
    fetcherMock.mockRejectedValue(new Error('boom'));
    expect(await guestMayOpenLibrary({ queryClient, auth: { user: guest } })).toBe(false);
  });

  it('refetches after invalidation, so a fresh upload opens the library', async () => {
    fetcherMock.mockResolvedValueOnce(state(0)).mockResolvedValueOnce(state(1));
    expect(await guestMayOpenLibrary({ queryClient, auth: { user: guest } })).toBe(false);
    await queryClient.invalidateQueries({ queryKey: ['me', 'guest'] });
    expect(await guestMayOpenLibrary({ queryClient, auth: { user: guest } })).toBe(true);
  });
});
