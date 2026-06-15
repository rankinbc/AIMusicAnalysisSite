// Story 2.1 — format integer cents to display string. Pure helper so the
// no-price-literals lint stays clean (AR39 — no $ literals outside config).
// The string template itself doesn't contain a $ literal; the symbol is
// derived from the currency code via Intl.NumberFormat.

export function formatCents(cents: number, currency: string): string {
  // Intl supports lower-case + upper-case currency codes; uppercase for safety.
  const code = currency.toUpperCase();
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
    }).format(cents / 100);
  } catch {
    // Bad currency code fallback — preserve the value rather than throwing
    // on a render path.
    return `${code} ${(cents / 100).toFixed(2)}`;
  }
}
