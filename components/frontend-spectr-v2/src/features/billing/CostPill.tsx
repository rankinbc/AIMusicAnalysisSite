import s from './CostTag.module.css';

// The CostTag pill look without the per-user entitlement maths — for places
// (the public /pricing page) that show the LIST price to anyone, signed in
// or not. `credits` always comes from the server price list.
export function CostPill({ credits }: { credits: number }) {
  return <span className={`mono ${s.tag}`}>{`${credits} ◆`}</span>;
}
