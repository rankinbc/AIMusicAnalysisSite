import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Story 6.3 (AC8) — the anonymous instant-analysis funnel, end to end:
//
//   /analyze → drop test-tone.wav (zero forms) → progress storyline
//   → report renders (grade hero + streaming readiness) with BlurLock
//   → inline register (device cookie rides the POST; 4.5 claim re-parents)
//   → report unlocks + claim banner → /library shows the account shell
//
// Pre-reqs: same stack as smoke-first-run (postgres+redis, BFF in Development
// with DevAutoVerify, venv worker with LLM_FAKE=1). The device cookie is
// Secure — fine in the browser (localhost exception), unlike raw HttpClient.
//
// HEADLESS ONLY — never pass --headed/--ui on shared/dev machines.

test.describe.configure({ mode: 'serial' });

test('anon funnel: drop → analyze → blurred report → claim', async ({ page }) => {
  test.setTimeout(360_000);

  const redact = (u: string) => u.split('?')[0];
  page.on('request', (r) => {
    if (r.url().includes('/api/')) console.log(`>> ${r.method()} ${redact(r.url())}`);
  });
  page.on('response', (r) => {
    if (r.url().includes('/api/')) console.log(`<< ${r.status()} ${redact(r.url())}`);
  });
  page.on('pageerror', (e) => console.log(`PAGE ERROR: ${e.message}`));

  // 1. The funnel page: full-bleed drop zone, zero form fields.
  await page.goto('/analyze');
  await expect(page.getByTestId('anon-drop-zone')).toBeVisible();
  await expect(page.getByText('WAV · FLAC · MP3 · ≤250 MB')).toBeVisible();

  // 2. Drop the fixture (via the hidden file input — drag-drop is the same
  //    code path through onFile).
  const fixture = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'test-tone.wav');
  await page.getByTestId('anon-file-input').setInputFiles(fixture);

  // 3. Progress storyline appears while the worker runs.
  await expect(page.getByTestId('anon-progress')).toBeVisible({ timeout: 30_000 });

  // 4. The report renders when the pipeline completes: hero + streaming
  //    readiness visible, deeper content BlurLocked with the claim CTA.
  await expect(page.getByTestId('anon-report')).toBeVisible({ timeout: 300_000 });
  await expect(page.getByText('Streaming readiness')).toBeVisible();
  const claimCta = page.getByRole('button', { name: 'Create free account' }).first();
  await expect(claimCta).toBeVisible();

  // 5. Refresh restore (AC5): reload mid-report — the device cookie brings
  //    the same report back with no local state.
  await page.reload();
  await expect(page.getByTestId('anon-report')).toBeVisible({ timeout: 30_000 });

  // 6. Inline register over the visible report (AC4). Fresh email; the
  //    device cookie rides the POST and the server claims the report.
  await page.getByRole('button', { name: 'Create free account' }).first().click();
  await expect(page.getByTestId('inline-register')).toBeVisible();
  await page.getByLabel('Email').fill(`anon-funnel+${Date.now()}@spectr.test`);
  await page.getByLabel('Password').fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: /Create free account/ }).last().click();

  // 7. Claim banner: report is yours; verification gates the NEXT analysis.
  await expect(page.getByTestId('claim-banner')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('claim-banner')).toContainText(/next/i);

  // 8. The account is real — the library shell loads authed.
  await page.goto('/library');
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByRole('link', { name: 'Library', exact: true })).toBeVisible();
});
