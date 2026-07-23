/* SPECTR · Listen V3 (PRP-6) — bookmark hooks. Authed bookmarks live server-side
 * (GET/POST/DELETE /me/bookmarks). An anon viewer on a shared version bookmarks
 * via /v/{token}/bookmark — the server row counts toward the author signal, but
 * the anon's PERSONAL list is browser-local (D4.4 — no durable anon library). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetcher } from '../../api/fetcher';
import type { AnonBookmarkRequest, BookmarkDto, CreateBookmarkRequest } from '../../api/types';

const myBookmarksKey = ['me', 'bookmarks'] as const;

export function useMyBookmarks() {
  return useQuery({
    queryKey: myBookmarksKey,
    queryFn: () => fetcher<BookmarkDto[]>({ url: '/me/bookmarks', method: 'GET' }),
  });
}

// Bookmark a version (+ optional t/note/identityVisible) or a share token. Dedup
// + identity-visible toggle are server-side; a repeat call returns the existing row.
export function useCreateBookmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateBookmarkRequest) =>
      fetcher<BookmarkDto>({ url: '/me/bookmarks', method: 'POST', data: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: myBookmarksKey }),
    meta: { errorToast: 'Could not save the bookmark.' },
  });
}

export function useDeleteBookmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetcher<void>({ url: `/me/bookmarks/${id}`, method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: myBookmarksKey }),
    meta: { errorToast: 'Could not delete the bookmark.' },
  });
}

// Anon (or authed-via-link) bookmark through the share token. Mirrors into the
// browser-local store so the anon can see their own bookmarks for this version.
export function usePostAnonBookmark(token: string, versionId: string) {
  return useMutation({
    mutationFn: (body: AnonBookmarkRequest) =>
      fetcher<BookmarkDto>({ url: `/v/${token}/bookmark`, method: 'POST', data: body }),
    onSuccess: (bm) => rememberLocalBookmark(versionId, bm),
  });
}

// ── browser-local fallback for the anon's "my bookmarks" (D4.4) ───────────────
const LOCAL_KEY = 'spectr.anonBookmarks';
type LocalStore = Record<string, BookmarkDto[]>; // versionId -> bookmarks

function readLocal(): LocalStore {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}') as LocalStore;
  } catch {
    return {};
  }
}

export function localBookmarksFor(versionId: string): BookmarkDto[] {
  return readLocal()[versionId] ?? [];
}

function rememberLocalBookmark(versionId: string, bm: BookmarkDto): void {
  const store = readLocal();
  const list = store[versionId] ?? [];
  if (list.some((b) => b.id === bm.id)) return;
  store[versionId] = [bm, ...list];
  localStorage.setItem(LOCAL_KEY, JSON.stringify(store));
}
