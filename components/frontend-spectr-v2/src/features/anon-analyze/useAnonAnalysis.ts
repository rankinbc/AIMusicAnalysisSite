/* Story 6.3 — data layer for the anonymous /analyze funnel.
 *
 * The device identity is a server-minted httpOnly cookie (spectr_device, 4.5)
 * that rides same-origin requests automatically — the client never touches it.
 * Upload is a plain multipart XHR (progress events); poll/results are plain
 * fetches against /api/anon/* (no auth token, no fetcher 401-refresh dance).
 */
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { parseErrorText } from '../../api/error-utils';
import type { JobStatusDto } from '../../api/types';

/** Story 6.3 — the REDUCED anon report (server-gated). The full report is
 *  served only by the authed endpoint after claim. `finalJson` here carries
 *  grade/score/danceability + phase-1 + the single top finding, nothing else. */
export interface AnonReport {
  finalJson: unknown;
  topFinding: string | null;
  totalFindings: number;
}

export interface AnonUploadState {
  isUploading: boolean;
  progress: number; // 0..1
  error: string | null;
}

async function anonGet<T>(url: string): Promise<T | null> {
  // credentials: include — the anon vertical is scoped by the spectr_device
  // cookie; same-origin today (Caddy), but this survives a cross-origin split.
  const res = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'include' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Multipart XHR upload to POST /api/anon/analyses with progress. */
export function useAnonUpload() {
  const [state, setState] = useState<AnonUploadState>({ isUploading: false, progress: 0, error: null });
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const upload = useCallback((file: File): Promise<{ jobId: string }> => {
    setState({ isUploading: true, progress: 0, error: null });
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) setState((s) => ({ ...s, progress: e.loaded / e.total }));
      });
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          setState({ isUploading: false, progress: 1, error: null });
          resolve(JSON.parse(xhr.responseText) as { jobId: string });
          return;
        }
        // 12-1 contract: prefer the server's message; code drives nothing
        // here beyond copy (anon flow has no retry semantics to branch on).
        const message =
          parseErrorText(xhr.responseText).message ?? 'Upload failed. Try again.';
        setState({ isUploading: false, progress: 0, error: message });
        reject(new Error(message));
      });
      xhr.addEventListener('error', () => {
        setState({ isUploading: false, progress: 0, error: 'Network error during upload.' });
        reject(new Error('network'));
      });
      const form = new FormData();
      form.append('file', file);
      xhr.open('POST', '/api/anon/analyses');
      xhr.send(form);
    });
  }, []);

  const cancel = useCallback(() => xhrRef.current?.abort(), []);
  return { ...state, upload, cancel };
}

/** Story 6.4 — the device's latest job: jobId (for /analyze restore) + the
 *  fields the landing resume card needs (status, when, grade-if-complete). */
export interface ResumeInfo {
  jobId: string;
  status: string;
  dispatchedAt: string;
  grade: string | null;
}

/** AC5 (6.3) restore + AC1 (6.4) resume card. Fires once on mount. */
export function useAnonCurrentJob(enabled: boolean) {
  return useQuery({
    queryKey: ['anon', 'jobs', 'current'],
    queryFn: () => anonGet<ResumeInfo>('/api/anon/jobs/current'),
    enabled,
    staleTime: Infinity,
    retry: false,
  });
}

/** Poll the device-scoped job status while processing.
 *
 *  E1.1 — the documented exception to terminalPoll: anonGet maps 404 → NULL
 *  RESOLVED DATA (not an error), so the shared helper's ApiError-404 stop can
 *  never fire here. A streak of 3 consecutive nulls means the job is gone for
 *  this device (cookies blocked, claimed on another device, 72 h purge) —
 *  `lost` flips true and polling stops instead of spinning forever. */
export function useAnonJob(jobId: string | null) {
  const [lost, setLost] = useState(false);
  const nullStreak = useRef(0);
  useEffect(() => {
    nullStreak.current = 0;
    setLost(false);
  }, [jobId]);

  const query = useQuery({
    queryKey: ['anon', 'jobs', jobId],
    queryFn: async () => {
      const r = await anonGet<JobStatusDto>(`/api/anon/jobs/${jobId}`);
      if (r === null) {
        nullStreak.current += 1;
        if (nullStreak.current >= 3) setLost(true);
      } else {
        nullStreak.current = 0;
      }
      return r;
    },
    enabled: Boolean(jobId),
    refetchInterval: (q) => {
      if (nullStreak.current >= 3) return false;
      if (q.state.errorUpdateCount >= 3) return false;
      const s = q.state.data?.status;
      return s === 'complete' || s === 'failed' ? false : 2000;
    },
    retry: false,
  });
  return { ...query, lost };
}

/** Device-scoped REDUCED results once the job completes. */
export function useAnonResults(jobId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['anon', 'results', jobId],
    queryFn: () => anonGet<AnonReport>(`/api/anon/jobs/${jobId}/results`),
    enabled: Boolean(jobId) && enabled,
    staleTime: Infinity,
  });
}
