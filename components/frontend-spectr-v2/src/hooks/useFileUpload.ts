// XHR-based upload hook. Fetch API has no upload progress event; we need XHR
// to wire xhr.upload.addEventListener('progress', ...) for the progress bar.
import { useCallback, useRef, useState } from 'react';

import { parseErrorText } from '../api/error-utils';
import { ApiError, getFreshAccessToken, resolveRetryToken } from '../api/fetcher';
import type { UploadResponse } from '../api/types';

interface UploadFields {
  song_id?: string;
  genre_hint?: string;
  // Omit to keep the default (BFF analyzes on upload). Set false to defer the
  // analysis dispatch — the unified-upload flow uploads the mix with analyze=false
  // and dispatches a single job downstream.
  analyze?: boolean;
}

interface UploadState {
  isUploading: boolean;
  progress: number; // 0..1
  error: string | null;
}

export function useFileUpload() {
  const [state, setState] = useState<UploadState>({
    isUploading: false,
    progress: 0,
    error: null,
  });
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const upload = useCallback(
    async (file: File, fields: UploadFields = {}): Promise<UploadResponse> => {
      const form = new FormData();
      form.append('file', file);
      if (fields.song_id) form.append('song_id', fields.song_id);
      if (fields.genre_hint) form.append('genre_hint', fields.genre_hint);
      if (fields.analyze !== undefined) form.append('analyze', String(fields.analyze));

      setState({ isUploading: true, progress: 0, error: null });

      // E3.9: retry ONCE on 401 only — the retry re-sends the whole body, so the
      // preflight freshness check below keeps it rare.
      let retried = false;
      const attempt = (token: string | null): Promise<UploadResponse> =>
        new Promise<UploadResponse>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhrRef.current = xhr;
          xhr.open('POST', '/api/versions/');
          xhr.withCredentials = true;
          if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

          xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
              setState((s) => ({ ...s, progress: e.loaded / e.total }));
            }
          });

          xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              setState((s) => ({ ...s, isUploading: false }));
              try {
                resolve(JSON.parse(xhr.responseText) as UploadResponse);
              } catch (e) {
                reject(e);
              }
            } else if (xhr.status === 401 && !retried) {
              retried = true;
              // D9 fix round 2 (item 1): never retry with a superseded
              // refresh's token — resolveRetryToken() only ever hands back a
              // token that's genuinely fresh or the CURRENT module token
              // (and only if it differs from `token`, the one that just
              // 401'd), so a guest upload can never carry a stale real
              // user's stale bearer.
              void resolveRetryToken(token).then((fresh) => {
                if (fresh) {
                  resolve(attempt(fresh));
                } else {
                  const msg = 'Session expired — sign in again to upload.';
                  setState((s) => ({ ...s, isUploading: false, error: msg }));
                  reject(new Error(msg));
                }
              });
            } else {
              const msg =
                parseErrorText(xhr.responseText).message ?? `Upload failed (${xhr.status})`;
              setState((s) => ({ ...s, isUploading: false, error: msg }));
              // D10 fix1 — reject with the same ApiError shape fetcher() throws
              // (status + parsed body) so guest_restricted/guest_busy detection
              // (mutation-error-toast.ts's handleGuestRestricted) works
              // identically across the fetch and XHR upload paths.
              let body: unknown;
              try {
                body = JSON.parse(xhr.responseText);
              } catch {
                body = undefined;
              }
              reject(new ApiError(xhr.status, body, msg));
            }
          });
          xhr.addEventListener('error', () => {
            setState((s) => ({ ...s, isUploading: false, error: 'Network error' }));
            reject(new Error('Network error'));
          });
          xhr.addEventListener('abort', () => {
            setState((s) => ({ ...s, isUploading: false }));
            reject(new Error('Upload aborted'));
          });

          xhr.send(form);
        });

      return attempt(await getFreshAccessToken());
    },
    [],
  );

  const cancel = useCallback(() => {
    xhrRef.current?.abort();
  }, []);

  return { ...state, upload, cancel };
}
