import { expect, test } from '@playwright/test';

// Task P10 — a backend-free smoke over every public (logged-out) page, on
// both a desktop and a phone viewport (see playwright.public.config.ts's
// `desktop`/`phone` projects). No BFF is running: `vite preview` proxies
// `/api/*` to :5000 and those requests simply fail to connect — that is
// expected and NOT asserted on. What IS asserted: the page must render a
// visible h1, must not throw an uncaught exception (a failed fetch has to
// be handled, not left to blow up the page), and must not scroll
// sideways on a phone.
const PAGES = [
  '/',
  '/analyze',
  '/features',
  '/pricing',
  '/trust/no-training',
  '/trust/results-forever',
  '/trust/privacy',
  '/trust/how-its-built',
  '/login',
  '/register',
];

for (const path of PAGES) {
  test(`${path} renders, throws nothing, and fits the viewport`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(path);
    await expect(page.locator('h1').first()).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });
}

test('an unknown URL shows the product 404, not a blank page', async ({ page }) => {
  await page.goto('/definitely-not-a-page');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/doesn.t exist/i);
  await expect(page.getByRole('link', { name: 'Back to home' })).toBeVisible();
});

test('with no backend the Pricing link stays hidden (hidden-by-default)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Pricing' })).toHaveCount(0);
});
