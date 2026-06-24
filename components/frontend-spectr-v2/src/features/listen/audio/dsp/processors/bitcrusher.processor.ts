import { quantizeSample } from '../quantize';

class BitcrusherProcessor extends AudioWorkletProcessor {
  private phase = 0;
  private held: number[] = [];

  static get parameterDescriptors() {
    return [
      { name: 'bitDepth', defaultValue: 16, minValue: 1, maxValue: 16, automationRate: 'k-rate' },
      { name: 'downsample', defaultValue: 1, minValue: 1, maxValue: 50, automationRate: 'k-rate' },
    ];
  }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0 || !output || output.length === 0) return true;

    const bits = parameters.bitDepth[0];
    const ds = Math.max(1, Math.floor(parameters.downsample[0]));
    const frames = output[0].length;

    for (let i = 0; i < frames; i += 1) {
      const take = this.phase === 0;
      for (let ch = 0; ch < output.length; ch += 1) {
        const inCh = input[ch] ?? input[0];
        if (take) this.held[ch] = quantizeSample(inCh[i], bits);
        output[ch][i] = this.held[ch] ?? 0;
      }
      this.phase = (this.phase + 1) % ds;
    }
    return true;
  }
}

registerProcessor('bitcrusher', BitcrusherProcessor);
