// Playwright global setup (story 12.7): make sure the WAV fixture exists.
// Generated, never committed — the repo treats generated artifacts as
// ephemeral, and the dependency-free generator removes the ffmpeg/sox
// requirement the old fixtures/README described.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export default async function globalSetup(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fixture = path.join(here, 'fixtures', 'test-tone.wav');
  if (!existsSync(fixture)) {
    const { generateWav } = await import('./fixtures/gen-wav.mjs');
    generateWav(fixture);
    console.log(`[global-setup] generated ${fixture}`);
  }
}
