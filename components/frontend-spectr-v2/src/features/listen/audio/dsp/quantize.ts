// Mid-rise bit-depth quantizer over [-1, 1]. bitDepth 1..16; higher = finer steps.
export function quantizeSample(x: number, bitDepth: number): number {
  const bits = Math.max(1, Math.min(16, bitDepth));
  const q = Math.pow(2, bits - 1);
  return Math.round(x * q) / q;
}
