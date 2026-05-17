import { expect, test } from '@playwright/test';
import path from 'node:path';

// Slice 1 happy path:
//   anon → /  → /login (redirect via _app guard)
//   register a fresh account → land on /library (empty)
//   upload a .wav fixture → land on /songs/$songId/results/$jobId
//   poll until job status === complete (default 5 minute budget)
//   assert final_json is rendered with at least one expected pipeline key
//
// Pre-reqs (run before invoking this spec):
//   * docker compose up -d postgres redis
//   * dotnet ef database update  (migrations applied)
//   * dotnet run --project src/Spectr.Bff
//   * python -m dramatiq app.dramatiq_app  (with audio_analysis installed)
//   * a fixture file at playwright/fixtures/test-tone.wav (5–10 s sine wave is fine)

test.describe.configure({ mode: 'serial' });

test('register, upload, see analysis result', async ({ page }) => {
  test.setTimeout(360_000); // 6 minutes — pipeline can be slow on first cold run.

  // 1. Anon visit → bounced to login.
  await page.goto('/');
  await expect(page).toHaveURL(/\/login(\?.*)?$/);

  // 2. Switch to register, submit fresh credentials.
  await page.getByRole('link', { name: /Create one/i }).click();
  await expect(page).toHaveURL(/\/register$/);

  const stamp = Date.now();
  const email = `slice1+${stamp}@spectr.test`;
  const password = 'correct-horse-battery-staple';
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /Create account/i }).click();

  // 3. Library renders (empty).
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
  await expect(page.getByText(/No songs yet/i)).toBeVisible();

  // 4. Open upload dialog, attach fixture, submit.
  await page.getByRole('button', { name: /Upload your first track/i }).click();
  const fixture = path.resolve(__dirname, 'fixtures', 'test-tone.wav');
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await page.getByRole('button', { name: /^Upload$/ }).click();

  // 5. Lands on results page.
  await expect(page).toHaveURL(/\/songs\/.+\/results\/.+/);

  // 6. Poll for final_json to appear.
  await expect(page.locator('[data-testid="final-json"]')).toBeVisible({
    timeout: 300_000,
  });
  const payload = await page.locator('[data-testid="final-json"]').textContent();
  expect(payload).toBeTruthy();
  // The pipeline emits at least one phase-shaped key; loosely assert one exists.
  expect(payload!).toMatch(/phase1|mix_score|phases/);
});
