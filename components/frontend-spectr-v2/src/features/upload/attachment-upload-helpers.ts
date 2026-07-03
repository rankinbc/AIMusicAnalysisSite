// Story 3.2 — presigned single-PUT attachment upload (stems / .als / reference).
//
// Flow per file: POST /uploads/attachments/init (server mints the AR20 key +
// presigned URL; jobId derived server-side from the owned version) → one raw
// XHR PUT straight to R2/MinIO → the caller registers the key with the
// kind-specific JSON endpoint (stage-keys / als-key / references/complete-key).
// A 501 `presigned_unavailable` ApiError propagates so callers fall back to
// the legacy proxy FormData path (mirror of useMixUpload's contract).
import { fetcher } from '../../api/fetcher';

export type AttachmentKind = 'stem' | 'als' | 'reference';

export interface AttachmentInitResponse {
  key: string;
  url: string;
  stemId: string | null;
  referenceId: string | null;
}

export function putToPresignedUrl(
  url: string,
  file: File,
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    // FOOTGUN #1 (3.1): raw bytes only — extra headers break the signature.
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded, e.total);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Attachment upload failed (${xhr.status})`));
    });
    xhr.addEventListener('error', () => reject(new Error('Attachment upload network error')));
    xhr.addEventListener('abort', () => reject(new Error('Attachment upload aborted')));
    xhr.send(file);
  });
}

/** init + PUT; throws ApiError(501) when presigned storage is unavailable. */
export async function uploadAttachmentPresigned(opts: {
  file: File;
  kind: AttachmentKind;
  versionId?: string;
  onProgress?: (loaded: number, total: number) => void;
}): Promise<AttachmentInitResponse> {
  const init = await fetcher<AttachmentInitResponse>({
    url: '/uploads/attachments/init',
    method: 'POST',
    data: {
      kind: opts.kind,
      versionId: opts.versionId ?? null,
      fileName: opts.file.name,
      fileSize: opts.file.size,
    },
  });
  await putToPresignedUrl(init.url, opts.file, opts.onProgress);
  return init;
}
