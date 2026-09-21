// Task P3 (public-surfaces-polish) — TRUST_PAGES lives here, separate from
// TrustPage.tsx, so PublicFooter (which lists every trust page in its Trust
// nav group) can import the list without pulling in TrustPage's JSX/CSS
// module. TrustPage.tsx re-exports this for backward compatibility.
export const TRUST_PAGES = [
  { path: '/trust/no-training', label: 'No AI training' },
  { path: '/trust/results-forever', label: 'Results forever' },
  { path: '/trust/privacy', label: 'Privacy defaults' },
] as const;
