// P7 (bundle diet) — zod is ~13 KB gz for schemas this small (one optional
// string field each, on four public routes). A hand-written validator does
// the same job — keep a string, drop anything else, omit the key entirely
// when absent — without pulling zod into the entry chunk.
export function optionalString<K extends string>(key: K) {
  return (raw: Record<string, unknown>): { [P in K]?: string } =>
    typeof raw[key] === 'string' ? ({ [key]: raw[key] } as { [P in K]?: string }) : {};
}
