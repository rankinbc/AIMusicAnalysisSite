import { expect, test } from '@playwright/test';

// Task D11 (Task 8 step) / G7b — the one-click /demo guest sandbox, end to
// end in a real browser:
//
//   /demo → mint-or-resume a guest (device cookie) → viewport-routed
//   destination (demoDestination.ts: >=1024px → Listen rack, narrower →
//   the results/report route) → the persistent guest banner (mounted in
//   GuestShell, _app.tsx) → a reload keeps the SAME guest session → the
//   guest coach answers a typed question in the report's Coach card.
//
// Pre-reqs: same running stack as the other smokes (postgres+redis, BFF in
// Development with DevAutoVerify, worker with LLM_FAKE=1), PLUS a demo
// snapshot installed and `demo_enabled` on (docs/azure-deploy-remaining-work.md
// "Guest demo and guest uploads"). Each test below gets Playwright's default
// FRESH browser context, so each mints its own guest device cookie — none of
// these three tests share a guest session.
//
// HEADLESS ONLY — never pass --headed/--ui on shared/dev machines.

test.describe.configure({ mode: 'serial' });

test('a visitor lands inside a working guest sandbox on desktop', async ({ page }) => {
  test.setTimeout(60_000);

  const redact = (u: string) => u.split('?')[0];
  page.on('request', (r) => {
    if (r.url().includes('/api/')) console.log(`>> ${r.method()} ${redact(r.url())}`);
  });
  page.on('response', (r) => {
    if (r.url().includes('/api/')) console.log(`<< ${r.status()} ${redact(r.url())}`);
  });
  page.on('pageerror', (e) => console.log(`PAGE ERROR: ${e.message}`));

  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('/demo');
  // Owner ruling 2026-10-01: every screen size lands on the demo song's report.
  await expect(page).toHaveURL(/\/songs\/.+\/results\//, { timeout: 20_000 });
  await expect(page.getByText(/as a guest/i)).toBeVisible();

  // Reload restore: the guest session (refresh cookie) survives a hard
  // reload with no local state — same destination, same banner.
  await page.reload();
  await expect(page).toHaveURL(/\/songs\/.+\/results\//, { timeout: 20_000 });
  await expect(page.getByText(/as a guest/i)).toBeVisible();
});

test('a phone lands on the report, not the desktop-only Listen page', async ({ page }) => {
  test.setTimeout(60_000);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/demo');
  await expect(page).toHaveURL(/\/songs\/.+\/results\/.+/, { timeout: 20_000 });
  await expect(page.getByTestId('report-view')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/as a guest/i)).toBeVisible();
});

test('the guest coach answers a typed question', async ({ page }) => {
  test.setTimeout(90_000);

  const redact = (u: string) => u.split('?')[0];
  page.on('request', (r) => {
    if (r.url().includes('/api/')) console.log(`>> ${r.method()} ${redact(r.url())}`);
  });
  page.on('response', (r) => {
    if (r.url().includes('/api/')) console.log(`<< ${r.status()} ${redact(r.url())}`);
  });
  page.on('pageerror', (e) => console.log(`PAGE ERROR: ${e.message}`));

  // Phone width lands directly on the report route (demoDestination.ts),
  // where the Coach card is always mounted — no tab click needed.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/demo');
  await expect(page).toHaveURL(/\/songs\/.+\/results\/.+/, { timeout: 20_000 });
  await expect(page.getByTestId('report-view')).toBeVisible({ timeout: 20_000 });

  const composer = page.getByRole('textbox', { name: 'Coach question input' });
  await expect(composer).toBeEnabled({ timeout: 20_000 });
  await composer.fill('What should I focus on first?');

  const sendBtn = page.getByRole('button', { name: 'Send question' });
  await sendBtn.click();

  // Streaming starts (label flips to Stop) then ends (label flips back) —
  // bounds the wait to the actual reply instead of a fixed sleep.
  await expect(page.getByRole('button', { name: 'Stop coach response' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(sendBtn).toBeVisible({ timeout: 60_000 });

  const lastBotBubble = page.locator('.cmsg.bot .bub').last();
  await expect(lastBotBubble).not.toBeEmpty();
});
