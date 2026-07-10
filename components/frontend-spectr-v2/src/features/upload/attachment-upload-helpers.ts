// Story 3.2 — presigned single-PUT attachment upload (stems / .als / reference).
//
// Flow per file: POST /uploads/attachments/init (server mints the AR20 key +
// presigned URL; jobId derived server-side from the owned version) → one raw
// XHR PUT straight to R2/MinIO → the caller registers the key with the
// kind-specific JSON endpoint (stage-keys / als-key / references/complete-key).
// Failures the caller can fall back on (init + PUT only — zero bytes committed):
// a 501 `presigned_unavailable` ApiError (S3 unconfigured) OR a PresignedPutError
// from the PUT (MinIO/R2 down — init only SIGNS the URL, so it isn't caught until
// the PUT). Registration is the caller's responsibility and must NOT fall back
// (bytes are already in the bucket; a proxy retry could double-create).
import { fetcher } from '../../api/fetcher';
import { PresignedPutError } from './presigned-fallback';

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
      // Non-2xx from the object store (down MinIO, signature reject): zero bytes
      // committed for a single PUT, so this is fallback-eligible.
      else reject(new PresignedPutError(`Attachment upload failed (${xhr.status})`));
    });
    xhr.addEventListener('error', () => reject(new PresignedPutError('Attachment upload network error')));
    // Abort is a user cancel, NOT a storage outage — surface it, never fall back.
    xhr.addEventListener('abort', () => reject(new Error('Attachment upload aborted')));
    xhr.send(file);
  });
}

/**
 * init + PUT (no registration — that's the caller's, and must not fall back).
 * Throws ApiError(501) when S3 is unconfigured, or PresignedPutError when the
 * PUT to a configured-but-down store fails; both are fallback-eligible.
 */
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
