export interface StemControl {
  id: string;       // stem id (GUID) — stems are id-keyed, not role-keyed
  volume: number;   // 0..1
  mute: boolean;
  solo: boolean;
}

// Effective linear gain per stem id. Mute always wins; if any stem is soloed,
// only soloed stems are audible.
export function computeStemGains(stems: StemControl[]): Record<string, number> {
  const anySolo = stems.some((s) => s.solo);
  const out: Record<string, number> = {};
  for (const s of stems) {
    if (s.mute) { out[s.id] = 0; continue; }
    if (anySolo && !s.solo) { out[s.id] = 0; continue; }
    out[s.id] = s.volume;
  }
  return out;
}
