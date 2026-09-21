// Task G5 (spec G-D1/G-D4) — the /analyze entry point's upload sequencing.
// A first-time visitor gets a guest session minted (startDemo()) before the
// ordinary mix upload; an already-signed-in visitor (a real user OR an
// EXISTING guest) skips straight to the upload — startDemo() must never be
// called again for either (idempotent per device, but there's no reason to
// pay the round trip, and it must never fire for a signed-in non-guest).
//
// Pure orchestration, no React — unit-testable without mounting AnalyzePage.
import type { AuthedUser, UploadResponse } from '../../api/types';

/** Thrown only when the guest session itself could not start. The caller
 *  (AnalyzePage) uses this to show "uploads aren't available right now"
 *  instead of blaming the upload, which never ran. Preserves the original
 *  error's message (and keeps it as `cause`) so upstream code/copy that
 *  matches on message text keeps working. */
export class GuestStartFailedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'GuestStartFailedError';
  }
}

export interface StartGuestUploadDeps {
  user: AuthedUser | null;
  startDemo: () => Promise<unknown>;
  upload: (file: File) => Promise<UploadResponse>;
}

export async function startGuestUpload(
  deps: StartGuestUploadDeps,
  file: File,
): Promise<UploadResponse> {
  if (!deps.user) {
    try {
      await deps.startDemo();
    } catch (err) {
      throw new GuestStartFailedError(
        err instanceof Error ? err.message : 'Could not start a guest session.',
        { cause: err },
      );
    }
  }
  return deps.upload(file);
}
