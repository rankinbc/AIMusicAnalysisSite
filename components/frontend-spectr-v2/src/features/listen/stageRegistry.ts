export type StageId = 'eq' | 'radial' | 'lights' | 'bloom' | 'orbit' | 'info';

export interface StageDef {
  id: StageId;
  label: string;
  /** Single-char/emoji placeholder; swap for the prototype's inline SVG later. */
  icon: string;
}

// 'grid' (viewer grid) is intentionally omitted — it needs viewer presence data
// that doesn't exist yet. A future Show mode appends it here.
export const STAGES: StageDef[] = [
  { id: 'eq', label: 'EQ bars', icon: '▮▮▮' },
  { id: 'radial', label: 'Radial pulse', icon: '◉' },
  { id: 'lights', label: 'Flashing lights', icon: '▦' },
  { id: 'bloom', label: 'Bloom rings', icon: '◎' },
  { id: 'orbit', label: 'Orbit', icon: '◌' },
  { id: 'info', label: 'Song info', icon: 'ⓘ' },
];
