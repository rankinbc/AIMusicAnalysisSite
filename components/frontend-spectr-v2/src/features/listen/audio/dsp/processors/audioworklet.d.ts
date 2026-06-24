// Ambient declarations for the AudioWorklet global scope. Processors run there
// (not in the DOM), so these globals are not in the DOM lib. Minimal — only what
// the processors in this folder use.
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessor,
): void;

declare const sampleRate: number;
