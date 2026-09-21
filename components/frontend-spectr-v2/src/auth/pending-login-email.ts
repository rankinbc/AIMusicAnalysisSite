// Task G5 fix1 item 3 — carries the just-converted guest's email from
// register.tsx to login.tsx WITHOUT putting it in the URL. `?email=` leaked
// two ways: PostHog inits with `capture_pageview: true` so `$current_url`
// (query string included) is captured, AND the address lands in browser
// history/referrers. A module-level variable, read once by the login page
// and cleared right after — no web storage (would survive past the one
// intended read, e.g. a later back-button visit), no URL.
//
// Split into peek + clear (not one destructive "take") so it's safe under
// StrictMode's double-invoked lazy `useState` initializer: peeking twice is
// harmless (both calls see the same value); clearing happens once, from an
// effect, which StrictMode also double-fires but a clear is idempotent.
let pending: string | undefined;

export function setPendingLoginEmail(email: string): void {
  pending = email;
}

export function peekPendingLoginEmail(): string | undefined {
  return pending;
}

export function clearPendingLoginEmail(): void {
  pending = undefined;
}
