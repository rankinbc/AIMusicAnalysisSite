import type { EffectId } from '../EffectUnit';

export type ChainEndpoint = EffectId | 'IN' | 'OUT';

// Ordered source->dest links to connect for a given chain order.
// 'IN' = the chain's stable input node, 'OUT' = its stable output node.
export function chainLinks(order: EffectId[]): Array<[ChainEndpoint, ChainEndpoint]> {
  if (order.length === 0) return [['IN', 'OUT']];
  const links: Array<[ChainEndpoint, ChainEndpoint]> = [['IN', order[0]]];
  for (let i = 0; i < order.length - 1; i += 1) {
    links.push([order[i], order[i + 1]]);
  }
  links.push([order[order.length - 1], 'OUT']);
  return links;
}

// True iff `order` is exactly the multiset of `known` (rejects missing,
// extra, and duplicate ids). Used to validate a reorder before touching
// the audio graph.
export function isPermutation(
  order: readonly EffectId[],
  known: readonly EffectId[],
): boolean {
  if (order.length !== known.length) return false;
  const a = [...order].sort();
  const b = [...known].sort();
  return a.every((id, i) => id === b[i]);
}
