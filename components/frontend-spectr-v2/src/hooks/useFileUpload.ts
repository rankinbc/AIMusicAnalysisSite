// XHR-based upload hook. Fetch API has no upload progress event; we need XHR
// to wire xhr.upload.addEventListener('progress', ...) for the progress bar.
import { useCallback, useRef, useState } from 'react';

import { getAccessToken } from '../api/fetcher';
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
    (file: File, fields: UploadFields = {}): Promise<UploadResponse> =>
      new Promise<UploadResponse>((resolve, reject) => {
        const form = new FormData();
        form.append('file', file);
        if (fields.song_id) form.append('song_id', fields.song_id);
        if (fields.genre_hint) form.append('genre_hint', fields.genre_hint);
        if (fields.analyze !== undefined) form.append('analyze', String(fields.analyze));

        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;
        xhr.open('POST', '/api/versions/');
        xhr.withCredentials = true;
        const token = getAccessToken();
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

        setState({ isUploading: true, progress: 0, error: null });

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            setState((s) => ({ ...s, progress: e.loaded / e.total }));
          }
        });

        xhr.addEventListener('load', () => {
          setState((s) => ({ ...s, isUploading: false }));
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText) as UploadResponse);
            } catch (e) {
              reject(e);
            }
          } else {
            const msg = safeParseError(xhr.responseText) ?? `Upload failed (${xhr.status})`;
            setState((s) => ({ ...s, error: msg }));
            reject(new Error(msg));
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
      }),
    [],
  );

  const cancel = useCallback(() => {
    xhrRef.current?.abort();
  }, []);

  return { ...state, upload, cancel };
}

function safeParseError(text: string): string | null {
  try {
    const o = JSON.parse(text) as { error?: string; title?: string };
    return o.error ?? o.title ?? null;
  } catch {
    return null;
  }
}
