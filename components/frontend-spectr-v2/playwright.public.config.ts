import { defineConfig, devices } from '@playwright/test';

// Task P10 (public-surfaces-polish) — a SEPARATE, backend-free Playwright
// suite from playwright.config.ts (testDir: './playwright', baseURL
// :5174). This one only ever needs `vite preview` serving the static build
// on its own port (4174) — no BFF, no Postgres, no Redis. Keeping the two
// configs' testDir values disjoint (./playwright vs ./playwright-public)
// means `npx playwright test` from either config never picks up the
// other's specs; confirmed with `--list` in the task report.
export default defineConfig({
  testDir: './playwright-public',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://localhost:4174', trace: 'on-first-retry' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npx vite preview --port 4174 --strictPort',
    url: 'http://localhost:4174',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
