// Task P4 (public-surfaces-polish) — the tiny set of public, non-secret
// facts about where SPECTR is hosted and where its source lives. Origin
// matches the production domain in infra/Caddyfile ({$SPECTR_DOMAIN});
// repoUrl/ciUrl match the actual git remote (`git remote -v`) and the
// workflow file at .github/workflows/ci.yml.
export const SITE = {
  origin: 'https://spectrmix.com',
  repoUrl: 'https://github.com/rankinbc/AIMusicAnalysisSite',
  ciUrl: 'https://github.com/rankinbc/AIMusicAnalysisSite/actions/workflows/ci.yml',
} as const;
