// Tanh saturation curve. drive 0 -> linear y=x. drive 1 -> strong tanh(5x)
// compression. 1024 samples between -1..1. Moved verbatim from useAudioGraph.
export function makeSatCurve(drive: number): Float32Array {
  const n = 1024;
  const out = new Float32Array(n);
  const k = 1 + drive * 4;
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i += 1) {
    const x = (i / (n - 1)) * 2 - 1;
    out[i] = Math.tanh(k * x) / norm;
  }
  return out;
}
