import { dbToLin, msToCoef } from '../dbScale';
import { stepGate, type GateRtState } from '../gateMath';

class GateProcessor extends AudioWorkletProcessor {
  private state: GateRtState = { env: 0, gain: 1, hold: 0 };
  private frame = 0;

  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -40, minValue: -80, maxValue: 0, automationRate: 'k-rate' },
      { name: 'attack', defaultValue: 1, minValue: 0, maxValue: 50, automationRate: 'k-rate' },
      { name: 'hold', defaultValue: 10, minValue: 0, maxValue: 500, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 100, minValue: 0, maxValue: 1000, automationRate: 'k-rate' },
      { name: 'floor', defaultValue: -80, minValue: -80, maxValue: 0, automationRate: 'k-rate' },
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

    const p = {
      thresholdLin: dbToLin(parameters.threshold[0]),
      floorLin: dbToLin(parameters.floor[0]),
      attackCoef: msToCoef(parameters.attack[0], sampleRate),
      releaseCoef: msToCoef(parameters.release[0], sampleRate),
      holdSamples: (parameters.hold[0] / 1000) * sampleRate,
    };

    const frames = output[0].length;
    const detect = input[0];
    for (let i = 0; i < frames; i += 1) {
      this.state = stepGate(this.state, detect[i], p);
      const gain = this.state.gain;
      for (let ch = 0; ch < output.length; ch += 1) {
        const inCh = input[ch] ?? input[0];
        output[ch][i] = inCh[i] * gain;
      }
    }

    this.frame += frames;
    if (this.frame >= sampleRate / 30) {
      this.frame = 0;
      this.port.postMessage({
        reductionDb: 20 * Math.log10(Math.max(this.state.gain, 1e-6)),
        open: this.state.gain > 0.5,
      });
    }
    return true;
  }
}

registerProcessor('gate', GateProcessor);
