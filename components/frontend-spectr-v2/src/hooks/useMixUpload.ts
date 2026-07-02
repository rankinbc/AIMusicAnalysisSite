// Story 3.1 — presigned-first mix upload (AR17/AR18).
//
// Tries the browser-direct multipart path (init -> PUT parts straight to
// R2/MinIO -> complete); when the server answers 501 `presigned_unavailable`
// (Storage:S3 unconfigured) it falls back transparently to the legacy
// proxy upload — same return shape, same 0..1 progress (FR1), so callers
// are agnostic to which path ran.
import { useCallback, useRef, useState } from 'react';

import { ApiError, fetcher } from '../api/fetcher';
import type { UploadResponse } from '../api/types';
import {
  planParts,
  uploadPartsSequential,
  type PartPlan,
} from '../features/upload/multipart-upload-helpers';
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

  const uploadPresigned = useCallback(
    async (file: File, fields: MixUploadFields): Promise<UploadResponse> => {
      cancelled.current = false;
      setState({ isUploading: true, progress: 0, error: null });

      const init = await fetcher<InitResponse>({
        url: '/uploads/init',
        method: 'POST',
        data: {
          fileName: file.name,
          fileSize: file.size,
          contentType: file.type || 'application/octet-stream',
          songId: fields.song_id ?? null,
        },
      });

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
      try {
        const res = await uploadPresigned(file, fields);
        presignedAvailable.current = true;
        return res;
      } catch (e) {
        if (e instanceof ApiError && e.status === 501) {
          presignedAvailable.current = false;
          setState((s) => ({ ...s, error: null }));
          return legacy.upload(file, fields);
        }
        throw e;
      }
    },
    [legacy, uploadPresigned],
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
