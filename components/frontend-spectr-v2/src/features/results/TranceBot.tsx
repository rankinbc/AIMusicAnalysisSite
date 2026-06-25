// The Coach mascot moved to the shared `ui/` layer so any feature can reuse
// him (see ui/Coach.tsx). These aliases keep the original results-feature
// imports (`TranceBot`, `MiniBot`) working — prefer `Coach` / `CoachMini`
// from `ui/Coach` in new code.
export { Coach as TranceBot, CoachMini as MiniBot } from '../../ui/Coach';
