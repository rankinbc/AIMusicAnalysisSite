// Dependency-free WAV fixture generator (story 12.7). Writes a 5 s stereo
// 440 Hz sine at 44.1 kHz / 16-bit PCM (~880 KB) — small enough to upload
// fast, long enough for the librosa phases to produce a real report.
// Invoked by playwright/global-setup.ts when test-tone.wav is absent; can
// also be run directly: node playwright/fixtures/gen-wav.mjs [outPath]
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function generateWav(outPath) {
  const sampleRate = 44100;
  const seconds = 5;
  const channels = 2;
  const freq = 440;
  const frames = sampleRate * seconds;
  const dataBytes = frames * channels * 2;

  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // PCM chunk size
  buf.writeUInt16LE(1, 20); // PCM format
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * 2, 28); // byte rate
  buf.writeUInt16LE(channels * 2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);

  for (let i = 0; i < frames; i++) {
    // -6 dBFS headroom so the analyzer never flags synthetic clipping.
    const sample = Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 16383);
    const off = 44 + i * channels * 2;
    buf.writeInt16LE(sample, off);
    buf.writeInt16LE(sample, off + 2);
  }

  writeFileSync(outPath, buf);
  return outPath;
}

// Direct CLI use.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'test-tone.wav');
  generateWav(out);
  console.log(`wrote ${out}`);
}
