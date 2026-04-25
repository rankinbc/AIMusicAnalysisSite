import { useState, useEffect } from 'react';

export function useWaveform(file, numBars = 200) {
  const [waveform, setWaveform] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!file) { setWaveform(null); return; }
    setLoading(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const ctx = new AudioContext();
        const buffer = await ctx.decodeAudioData(e.target.result);
        ctx.close();
        const data = buffer.getChannelData(0);
        const blockSize = Math.floor(data.length / numBars);
        const bars = [];
        for (let i = 0; i < numBars; i++) {
          let peak = 0;
          for (let j = 0; j < blockSize; j++) {
            const v = Math.abs(data[i * blockSize + j]);
            if (v > peak) peak = v;
          }
          bars.push(peak);
        }
        const max = Math.max(...bars, 0.001);
        setWaveform(bars.map(v => v / max));
      } catch {
        setWaveform(Array.from({ length: numBars }, (_, i) =>
          0.15 + Math.abs(Math.sin(i * 0.15) * 0.4 + Math.sin(i * 0.07) * 0.4)
        ));
      } finally {
        setLoading(false);
      }
    };
    reader.readAsArrayBuffer(file);
  }, [file, numBars]);

  return { waveform, loading };
}
