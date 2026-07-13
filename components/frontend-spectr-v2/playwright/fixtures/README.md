# Playwright Fixtures

`test-tone.wav` is consumed by `smoke-first-run.spec.ts` (story 12.7). It is
generated automatically by `playwright/global-setup.ts` via the
dependency-free writer in `gen-wav.mjs` (5 s stereo 440 Hz sine, 44.1 kHz
16-bit PCM, ~880 KB) — no ffmpeg/sox required, nothing binary committed.

Regenerate manually if needed:

```bash
node playwright/fixtures/gen-wav.mjs
```

The fixture isn't committed because the repo treats generated artifacts as
ephemeral; global-setup recreates it on any machine before the run.
