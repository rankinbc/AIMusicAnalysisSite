// XHR-based staging upload for bulk stems — needs XHR (not fetch) for the
// upload-progress event. Posts all picked files in one multipart request to
// /api/versions/{id}/stems/stage (field name "files").
import { useCallback, useRef, useState } from 'react';

import { getAccessToken } from '../api/fetcher';
import type { StageStemsResponse } from '../api/types';

interface State {
  isUploading: boolean;
  progress: number; // 0..1
  error: string | null;
}

export function useStemStaging(versionId: string) {
  const [state, setState] = useState<State>({ isUploading: false, progress: 0, error: null });
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const stage = useCallback(
    (files: File[]): Promise<StageStemsResponse> =>
      new Promise<StageStemsResponse>((resolve, reject) => {
        const form = new FormData();
        for (const f of files) form.append('files', f, f.name);

        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;
        xhr.open('POST', `/api/versions/${versionId}/stems/stage`);
        xhr.withCredentials = true;
        const token = getAccessToken();
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

        setState({ isUploading: true, progress: 0, error: null });

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) setState((s) => ({ ...s, progress: e.loaded / e.total }));
        });
        xhr.addEventListener('load', () => {
          setState((s) => ({ ...s, isUploading: false }));
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText) as StageStemsResponse);
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
    [versionId],
  );

  const cancel = useCallback(() => xhrRef.current?.abort(), []);

  return { ...state, stage, cancel };
}

function safeParseError(text: string): string | null {
  try {
    const o = JSON.parse(text) as { error?: string; title?: string };
    return o.error ?? o.title ?? null;
  } catch {
    return null;
  }
}
