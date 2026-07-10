// Story 3.1 — presigned-first mix upload (AR17/AR18).
//
// Tries the browser-direct multipart path (init -> PUT parts straight to
// R2/MinIO -> complete); when /uploads/init fails because the presigned path
// is unavailable (501 unconfigured, 503/5xx unreachable, or a network error —
// see shouldFallBackToProxy, story 12.3) it falls back transparently to the
// legacy proxy upload — same return shape, same 0..1 progress (FR1), so
// callers are agnostic to which path ran. Failures past init never fall back.
import { useCallback, useRef, useState } from 'react';

import { fetcher } from '../api/fetcher';
import type { UploadResponse } from '../api/types';
import {
  planParts,
  uploadPartsSequential,
  type PartPlan,
} from '../features/upload/multipart-upload-helpers';
import { shouldFallBackToProxy } from '../features/upload/presigned-fallback';
import { useFileUpload } from './useFileUpload';

interface InitResponse {
  jobId: string;
  key: string;
  uploadId: string;
  partSizeBytes: number;
  parts: { partNumber: number; url: string }[];
}

interface MixUploadFields {
  song_id?: string;
  genre_hint?: string;
  analyze?: boolean;
}

interface MixUploadState {
  isUploading: boolean;
  progress: number; // 0..1
  error: string | null;
}

export function useMixUpload() {
  const legacy = useFileUpload();
  const [state, setState] = useState<MixUploadState>({
    isUploading: false,
    progress: 0,
    error: null,
  });
  const activeXhr = useRef<XMLHttpRequest | null>(null);
  const cancelled = useRef(false);
  // null = unknown (probe on first upload); thereafter cached for the session.
  const presignedAvailable = useRef<boolean | null>(null);

  const putPart = useCallback(
    (file: File) =>
      (url: string, plan: PartPlan, onPartProgress: (loaded: number) => void) =>
        new Promise<string>((resolve, reject) => {
          if (cancelled.current) {
            reject(new Error('Upload aborted'));
            return;
          }
          const xhr = new XMLHttpRequest();
          activeXhr.current = xhr;
          xhr.open('PUT', url);
          // FOOTGUN #1: send ONLY the chunk bytes. No Content-Type, no
          // checksum headers — anything extra breaks the presigned signature.
          xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) onPartProgress(e.loaded);
          });
          xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              // FOOTGUN #2: readable only because bucket CORS exposes ETag.
              const eTag = xhr.getResponseHeader('ETag');
              if (eTag) resolve(eTag);
              else reject(new Error('Part upload returned no ETag (bucket CORS must expose ETag)'));
            } else {
              reject(new Error(`Part ${plan.partNumber} failed (${xhr.status})`));
            }
          });
          xhr.addEventListener('error', () => reject(new Error(`Part ${plan.partNumber} network error`)));
          xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));
          xhr.send(file.slice(plan.start, plan.end));
        }),
    [],
  );

  // Parts + complete only — the caller has already run /uploads/init. Past
  // this point bytes are moving, so failures must SURFACE (abort best-effort,
  // set error, rethrow), never fall back to the proxy: a silent re-upload
  // could push 250 MB twice and double-create versions (story 12.3).
  const uploadPresignedParts = useCallback(
    async (file: File, fields: MixUploadFields, init: InitResponse): Promise<UploadResponse> => {
      try {
        const plans = planParts(file.size, init.partSizeBytes);
        const urlByPart = new Map(init.parts.map((p) => [p.partNumber, p.url]));
        const parts = await uploadPartsSequential({
          plans,
          urlByPart,
          fileSize: file.size,
          putPart: putPart(file),
          onProgress: (fraction) => setState((s) => ({ ...s, progress: fraction })),
        });

        const res = await fetcher<UploadResponse>({
          url: '/uploads/complete',
          method: 'POST',
          data: {
            jobId: init.jobId,
            key: init.key,
            uploadId: init.uploadId,
            parts,
            songId: fields.song_id ?? null,
            genreHint: fields.genre_hint ?? null,
            analyze: fields.analyze ?? null,
          },
        });
        setState((s) => ({ ...s, isUploading: false, progress: 1 }));
        return res;
      } catch (e) {
        // Free the orphaned multipart server-side (best-effort).
        void fetcher({
          url: '/uploads/abort',
          method: 'POST',
          data: { key: init.key, uploadId: init.uploadId },
        }).catch(() => undefined);
        const msg = e instanceof Error ? e.message : 'Upload failed';
        setState((s) => ({ ...s, isUploading: false, error: msg }));
        throw e;
      }
    },
    [putPart],
  );

  const upload = useCallback(
    async (file: File, fields: MixUploadFields = {}): Promise<UploadResponse> => {
      if (presignedAvailable.current === false) return legacy.upload(file, fields);

      cancelled.current = false;
      setState({ isUploading: true, progress: 0, error: null });

      // Init-stage failure = zero bytes moved, so falling back to the proxy
      // is always safe. Story 12.3 broadens the trigger from 501-only to any
      // init 5xx/network failure (MinIO down now answers a typed 503); 4xx
      // gates (403 verify, 409 entitlement, 429) still propagate untouched.
      let init: InitResponse;
      try {
        init = await fetcher<InitResponse>({
          url: '/uploads/init',
          method: 'POST',
          data: {
            fileName: file.name,
            fileSize: file.size,
            contentType: file.type || 'application/octet-stream',
            songId: fields.song_id ?? null,
          },
        });
      } catch (e) {
        if (shouldFallBackToProxy(e)) {
          // Cache for the session: one failed probe, then fast proxy uploads.
          presignedAvailable.current = false;
          setState({ isUploading: false, progress: 0, error: null });
          return legacy.upload(file, fields);
        }
        const msg = e instanceof Error ? e.message : 'Upload failed';
        setState((s) => ({ ...s, isUploading: false, error: msg }));
        throw e;
      }

      const res = await uploadPresignedParts(file, fields, init);
      presignedAvailable.current = true;
      return res;
    },
    [legacy, uploadPresignedParts],
  );

  const cancel = useCallback(() => {
    cancelled.current = true;
    activeXhr.current?.abort();
    legacy.cancel();
  }, [legacy]);

  // Merge state: whichever path is active reports through its own state.
  const isUploading = state.isUploading || legacy.isUploading;
  const progress = legacy.isUploading ? legacy.progress : state.progress;
  const error = state.error ?? legacy.error;

  return { isUploading, progress, error, upload, cancel };
}
