export function hueFromId(id: string | null | undefined): number {
  if (!id) return 168;
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) % 360;
  }
  return h;
}
