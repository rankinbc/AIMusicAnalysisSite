# Playwright Fixtures

`test-tone.wav` is consumed by `slice-1-happy-path.spec.ts`. The spec is
intentionally environment-agnostic; any short (5–10 s) WAV/FLAC/MP3 the
analysis pipeline can ingest will pass.

Generate one locally with ffmpeg:

```bash
ffmpeg -f lavfi -i "sine=frequency=440:duration=5" \
    -ar 44100 -ac 2 -c:a pcm_s16le \
    test-tone.wav
```

Or with sox:

```bash
sox -n -r 44100 -c 2 test-tone.wav synth 5 sine 440
```

These fixtures aren't committed because the rest of the repo treats
generated artifacts as ephemeral — the spec is gated on the file's
presence and fails clearly if missing.
