import { dbToLin, msToCoef } from '../dbScale';
import { stepLimiter, type LimiterRtState } from '../limiterMath';

const MAX_LOOKAHEAD_SEC = 0.01;

class LimiterProcessor extends AudioWorkletProcessor {
  private buf: Float32Array[] = [];
  private widx = 0;
  private size = 0;
  private state: LimiterRtState = { gain: 1 };
  private frame = 0;

  static get parameterDescriptors() {
    return [
      { name: 'ceiling', defaultValue: -1, minValue: -12, maxValue: 0, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 50, minValue: 1, maxValue: 500, automationRate: 'k-rate' },
      { name: 'lookahead', defaultValue: 5, minValue: 0, maxValue: 10, automationRate: 'k-rate' },
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

    const chs = output.length;
    if (this.size === 0 || this.buf.length < chs) {
      this.size = Math.ceil(MAX_LOOKAHEAD_SEC * sampleRate) + 1;
      this.buf = Array.from({ length: chs }, () => new Float32Array(this.size));
    }

    const ceilingLin = dbToLin(parameters.ceiling[0]);
    const releaseCoef = msToCoef(parameters.release[0], sampleRate);
    const look = Math.min(
      this.size - 1,
      Math.max(0, Math.round((parameters.lookahead[0] / 1000) * sampleRate)),
    );
    const frames = output[0].length;

    for (let i = 0; i < frames; i += 1) {
      for (let ch = 0; ch < chs; ch += 1) {
        const inCh = input[ch] ?? input[0];
        this.buf[ch][this.widx] = inCh[i];
      }
      let peak = 0;
      for (let k = 0; k <= look; k += 1) {
        const idx = (this.widx - k + this.size) % this.size;
        for (let ch = 0; ch < chs; ch += 1) {
          const a = Math.abs(this.buf[ch][idx]);
          if (a > peak) peak = a;
        }
      }
      this.state = stepLimiter(this.state, peak, { ceilingLin, releaseCoef });
      const ridx = (this.widx - look + this.size) % this.size;
      for (let ch = 0; ch < chs; ch += 1) {
        output[ch][i] = this.buf[ch][ridx] * this.state.gain;
      }
      this.widx = (this.widx + 1) % this.size;
    }

    this.frame += frames;
    if (this.frame >= sampleRate / 30) {
      this.frame = 0;
      this.port.postMessage({ reductionDb: 20 * Math.log10(Math.max(this.state.gain, 1e-6)) });
    }
    return true;
  }
}

registerProcessor('limiter', LimiterProcessor);
