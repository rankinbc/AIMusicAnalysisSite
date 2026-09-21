# Public Surfaces Polish — Implementation Plan (Workstream P)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SPECTR's logged-out surfaces honest, legible to a non-audio technical visitor, phone-safe and failure-proof: error/404 screens, a public `creditsEnabled` flag that hides Pricing while credits are off, a demo CTA + product footer, a "How it's built" page with self-verifying numbers, a plain-language sample report, link-preview parity, a bundle diet, phone fixes, small edge hardening and a backend-free public smoke in CI.

**Architecture:** Public pages stay provider-free static-renderable React (plain `<a>`, `useOptionalAuth`). One new anonymous field on the existing `GET /api/billing/plans`. Thin route files, page components under `src/features/*` so they code-split. Observability SDKs become dynamic imports behind their env keys.

**Tech Stack:** React 19, Vite 6, TS strict (`verbatimModuleSyntax`, `exactOptionalPropertyTypes`), TanStack Router file routes, CSS Modules + `src/styles/tokens.css`, vitest + Testing Library, Playwright; ASP.NET Core .NET 10 minimal API + xUnit; Caddy; docker compose.

**Spec:** `PRPs/public-surfaces-polish.md` (binding — decisions D1–D16, page outline §3, counting rules §3.3, live checks §4).

Paths: `FE` = `components/frontend-spectr-v2`, `BFF` = `components/bff/src/Spectr.Bff`, `BFFT` = `components/bff/tests/Spectr.Bff.Tests`.

## Global Constraints

- Worktree `C:/Users/badmin/projects/spectr-solo`, branch `solo`. Never touch `C:/Users/badmin/projects/AIMusicAnalysisSite` or `master`.
- Never stage `features/results/AnalysisCompleteModal.tsx`/`.module.css` (another session's uncommitted work).
- Never edit `NoSocialSurfaceTests.cs`. The ONLY permitted edit to `src/routes/__tests__/no-social-surface.test.ts` is adding the single line for `trust.how-its-built.tsx` to `ALLOWED_ROUTE_FILES` (owner-approved 2026-09-20) — Task P4, nowhere else.
- Generated sheets `features/results/redesign-v3-tabs.css` are do-not-edit (overrides go in hand-written sheets; `features/results/redesign.css` is imported nowhere — editing it does nothing).
- CSS Modules + tokens only, `lint:css` rejects raw hex, no inline styles unless dynamic, no new runtime dependencies. `import type` mandatory. No file over ~500 lines.
- Copy guardrails (spec D16): no match for the guard's banned regexes (`jobs? waiting|jobs? queued`, `queueDepth`, `\bfollowers\b`, `isPublic`, `>pub<`); BFF shell copy never contains `invite`, `follower`, `public profile`; no `N.99` literal outside `src/config/**`; no `*` on `/pricing`.
- Gates — frontend (from `FE`): `npx tsc -b`, `npm run lint`, `npm run lint:css`, `npm run lint:prices`, `npm run lint:focus`, `npm run build`, `npx vitest run`; BFF (from `components/bff`): `dotnet build && dotnet test --artifacts-path <scratch>` with `127.0.0.1` env overrides (a wedged wslrelay black-holes localhost: `ConnectionStrings__Postgres` Host=127.0.0.1, `Redis__ConnectionString=127.0.0.1:6379`). **ALL gates after ANY edit.**
- vitest default environment is `node` (only `src/features/listen-rack/**` and `src/features/song/**` are globbed to jsdom) so DOM tests need the `// @vitest-environment jsdom` docblock as line 1.
- Brace `beforeEach(() => { mock.mockReset(); })` — an unbraced hook returns the mock and vitest calls it as teardown.
- jsdom has no layout: every CSS/layout claim is measured in Chrome at 390 px and 1440 px (spec §4) and the numbers go in the task report.
- Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Stage by path. Never `--no-verify`. Never push. Foreground test runs only. Implementers never dispatch subagents.
- **Order:** P1, P2, P5 → *(sibling plan `PRPs/guest-demo-sandbox-plan.md` through D9 — `/demo` exists)* → P3 → P4 → P6 → P8 → P7 → P9 → P10. Controller: no push between P3 and P4.

---

### Task P1: Error and 404 screens, stale-chunk reload

**Files**
- Create: `FE/src/lib/chunk-reload.ts`, `FE/src/lib/__tests__/chunk-reload.test.ts`
- Create: `FE/src/components/{NotFoundScreen,RouteErrorScreen,AppCrashFallback}.tsx`, `FE/src/components/StatusScreen.module.css`, `FE/src/components/__tests__/status-screens.test.tsx`
- Modify: `FE/src/lib/sentry.ts` (add `reportError`), `FE/src/main.tsx:9-10,42-51,71-94`

**Interfaces**
- Produces: `STALE_CHUNK_RE: RegExp`; `isStaleChunkError(err: unknown): boolean`; `reloadOnceForStaleChunk(deps?: { now?: number; storage?: Pick<Storage,'getItem'|'setItem'> | null; reload?: () => void }): boolean`; `installChunkReloadListener(opts?: { target?: EventTarget; storage?: Pick<Storage,'getItem'|'setItem'> | null; reload?: () => void; now?: () => number }): () => void`; `reportError(err: unknown): void`; components `NotFoundScreen()`, `RouteErrorScreen(props: ErrorComponentProps)`, `AppCrashFallback()`.

- [ ] **Step 1 — failing test** `FE/src/lib/__tests__/chunk-reload.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { installChunkReloadListener, isStaleChunkError, reloadOnceForStaleChunk } from '../chunk-reload';
function fakeStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
}
describe('chunk-reload', () => {
  it('recognises the dynamic-import failures browsers actually throw', () => {
    expect(isStaleChunkError(new TypeError('Failed to fetch dynamically imported module: /assets/x.js'))).toBe(true);
    expect(isStaleChunkError(new Error('Importing a module script failed.'))).toBe(true);
    expect(isStaleChunkError(new Error('error loading dynamically imported module'))).toBe(true);
    expect(isStaleChunkError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isStaleChunkError('nope')).toBe(false);
  });
  it('reloads once, refuses inside the five-minute window, allows again after it', () => {
    const storage = fakeStorage();
    const reload = vi.fn();
    expect(reloadOnceForStaleChunk({ now: 1_000, storage, reload })).toBe(true);
    expect(reloadOnceForStaleChunk({ now: 1_000 + 299_000, storage, reload })).toBe(false);
    expect(reloadOnceForStaleChunk({ now: 1_000 + 300_001, storage, reload })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
  it('never reloads when storage is unavailable (no guard = possible loop)', () => {
    const reload = vi.fn();
    expect(reloadOnceForStaleChunk({ now: 1, storage: null, reload })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
  it('the vite:preloadError listener swallows the event only when it reloaded', () => {
    const target = new EventTarget();
    const reload = vi.fn();
    const off = installChunkReloadListener({ target, storage: fakeStorage(), reload, now: () => 5 });
    const first = new Event('vite:preloadError', { cancelable: true });
    target.dispatchEvent(first);
    expect(first.defaultPrevented).toBe(true);
    const second = new Event('vite:preloadError', { cancelable: true });
    target.dispatchEvent(second);
    expect(second.defaultPrevented).toBe(false); // surfaces → RouteErrorScreen
    off();
    target.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2 — RED:** `npx vitest run src/lib/__tests__/chunk-reload.test.ts` → fails (module missing).
- [ ] **Step 3 — implement** `FE/src/lib/chunk-reload.ts`:

```ts
/* A deploy while a tab is open turns the next lazy navigation into a failed
 * dynamic import. One guarded reload fixes it; an unguarded one is a loop. */
const KEY = 'spectr:chunk-reload-at';
const WINDOW_MS = 5 * 60_000;
export const STALE_CHUNK_RE =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i;
type GuardStorage = Pick<Storage, 'getItem' | 'setItem'>;
interface ReloadDeps { now?: number; storage?: GuardStorage | null; reload?: () => void }
function sessionStore(): GuardStorage | null {
  try { return window.sessionStorage; } catch { return null; }
}
export function isStaleChunkError(err: unknown): boolean {
  return err instanceof Error && STALE_CHUNK_RE.test(err.message);
}
export function reloadOnceForStaleChunk(deps: ReloadDeps = {}): boolean {
  const storage = deps.storage === undefined ? sessionStore() : deps.storage;
  if (!storage) return false;
  const now = deps.now ?? Date.now();
  try {
    const last = Number(storage.getItem(KEY) ?? 0);
    if (last > 0 && now - last < WINDOW_MS) return false;
    storage.setItem(KEY, String(now));
  } catch { return false; }
  (deps.reload ?? (() => window.location.reload()))();
  return true;
}
export function installChunkReloadListener(opts: {
  target?: EventTarget; storage?: GuardStorage | null; reload?: () => void; now?: () => number;
} = {}): () => void {
  const target = opts.target ?? window;
  const onError = (e: Event) => {
    const deps: ReloadDeps = { now: (opts.now ?? Date.now)() };
    if (opts.storage !== undefined) deps.storage = opts.storage;
    if (opts.reload) deps.reload = opts.reload;
    if (reloadOnceForStaleChunk(deps)) e.preventDefault();
  };
  target.addEventListener('vite:preloadError', onError);
  return () => target.removeEventListener('vite:preloadError', onError);
}
```

- [ ] **Step 4 — GREEN**, then **failing test** `FE/src/components/__tests__/status-screens.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const spies = vi.hoisted(() => ({ reportError: vi.fn(), reloadOnce: vi.fn(() => true) }));
vi.mock('../../lib/sentry', () => ({ reportError: spies.reportError }));
vi.mock('../../lib/chunk-reload', async (orig) => ({
  ...(await orig<typeof import('../../lib/chunk-reload')>()),
  reloadOnceForStaleChunk: spies.reloadOnce,
}));
import { NotFoundScreen } from '../NotFoundScreen';
import { RouteErrorScreen } from '../RouteErrorScreen';
describe('status screens', () => {
  beforeEach(() => { spies.reportError.mockReset(); spies.reloadOnce.mockClear(); });
  afterEach(() => { cleanup(); });
  it('404 keeps the product on screen: chrome, heading, two ways out, its own title', () => {
    render(<NotFoundScreen />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/doesn.t exist/i);
    expect(screen.getByRole('link', { name: 'Back to home' }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: 'Analyze a track' }).getAttribute('href')).toBe('/analyze');
    expect(screen.getByText('Analyze free')).toBeTruthy(); // PublicChrome, anon variant
    expect(document.title).toBe('Page not found — SPECTR');
  });
  it('a route error is reported once and offers reload + home', () => {
    const err = new Error('boom');
    render(<RouteErrorScreen error={err} reset={() => {}} />);
    expect(spies.reportError).toHaveBeenCalledTimes(1);
    expect(spies.reportError).toHaveBeenCalledWith(err);
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to home' }).getAttribute('href')).toBe('/');
  });
  it('a stale-chunk error triggers the guarded reload instead of a report', () => {
    render(<RouteErrorScreen error={new TypeError('Failed to fetch dynamically imported module: /assets/a.js')} reset={() => {}} />);
    expect(spies.reloadOnce).toHaveBeenCalledTimes(1);
    expect(spies.reportError).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5 — implement.**
  - `lib/sentry.ts`: add `export function reportError(err: unknown): void { if (!DSN) return; Sentry.captureException(err); }` (P7 swaps the internals; the name stays).
  - `StatusScreen.module.css`: `.shell` (max-width 560px, centred, `padding: 96px 24px`), `.title` (Syne, `clamp(26px,4vw,36px)`), `.body` (`color: var(--text-2)`), `.actions` (flex, gap 12px, wrap). Tokens only.
  - `NotFoundScreen`: `usePageMeta('Page not found — SPECTR')`; `<PublicChrome />`; `<main className={s.shell}>` with `<span className="label">404</span>`, `<h1>This page doesn&rsquo;t exist.</h1>`, `<p>The link may be old, or the address mistyped.</p>`, `<a href="/" className="btn primary">Back to home</a>`, `<a href="/analyze" className="btn ghost">Analyze a track</a>`.
  - `RouteErrorScreen({ error }: ErrorComponentProps)` (`import type { ErrorComponentProps } from '@tanstack/react-router'`): `useEffect(() => { if (isStaleChunkError(error)) { reloadOnceForStaleChunk(); return; } reportError(error); }, [error]);` — same shell, h1 "Something went wrong on this page.", p "The error has been reported. Reloading usually fixes it.", `<button type="button" className="btn primary" onClick={() => window.location.reload()}>Reload page</button>`, `<a href="/" className="btn ghost">Back to home</a>`.
  - `AppCrashFallback`: the same shell WITHOUT `PublicChrome` (it renders outside the auth provider), copy "Something broke." / "The error has been reported. Reload to continue." + reload button.
  - `main.tsx`: `createRouter({ …, defaultPreload: 'intent', defaultNotFoundComponent: NotFoundScreen, defaultErrorComponent: RouteErrorScreen })`; inside the existing `try {}` add `installChunkReloadListener();`; `fallback={<AppCrashFallback />}` (removes the inline-hex block at `:76-84`).
- [ ] **Step 6 — GREEN + ALL gates. Live:** unknown URL at 390/1440 px → screen renders, `scrollWidth <= clientWidth`; spec §4 item 9 (build → preview → rebuild → navigate → one reload; second failure within 5 min → error screen).
- [ ] **Step 7 — commit** `feat(public): real 404 and route-error screens; one guarded reload for stale chunks`.

---

### Task P2: Public `creditsEnabled`; Pricing hidden until the server says yes

**Files**
- Create: `BFF/Services/PublicCredits.cs`, `BFFT/PublicCreditsTests.cs`
- Modify: `BFF/DTOs/BillingDtos.cs:18-25`, `BFF/Endpoints/BillingEndpoints.cs:74-83`, `BFF/Endpoints/PublicSiteEndpoints.cs:17,60-67`, `BFFT/BillingEndpointsTests.cs` (after `:136`), `BFFT/PublicSiteShellTests.cs`
- Create: `FE/src/lib/public-plans.ts`, `FE/src/components/PricingLink.tsx`, `FE/src/lib/__tests__/public-plans.test.tsx`, `FE/src/features/pricing/{PricingPage,PricingPlansView,PricingOffView,PricingLoadingView}.tsx`, `FE/src/features/pricing/__tests__/pricing-states.test.tsx`
- Move (git mv): `FE/src/routes/pricing.module.css` → `FE/src/features/pricing/pricing.module.css`
- Modify: `FE/src/routes/pricing.tsx` (thin shell), `FE/src/api/types.ts:30-36`, `FE/src/components/PublicChrome.tsx:26`, `FE/src/features/landing/LandingPage.tsx:53,70`, `FE/src/features/trust/TrustPage.tsx:40`
- Update tests: `features/landing/__tests__/landing.test.tsx:7,20,75,83-97`, `features/trust/__tests__/trust.test.tsx:5,73-77`, `routes/__tests__/kitchen-sink-axe.test.tsx:7`, `features/anon-analyze/__tests__/funnel-events.test.tsx:29`

**Interfaces**
- Produces (BFF): `PlansResponse(…, string Currency, bool? CreditsEnabled = null)`; `PublicCredits.ResolveAsync(IConfiguration config, Func<CancellationToken, Task<Dictionary<string,string>>> loadFlags, ILogger logger, CancellationToken ct): Task<bool?>`.
- Produces (FE): `PlansResponse.creditsEnabled?: boolean | null`; `loadPublicPlans(): Promise<PlansResponse | null>`; `resetPublicPlansForTests(): void`; `useCreditsEnabled(): boolean | null`; `PricingLink(props: { className?: string; children?: ReactNode })`; `PricingPlansView(props)` (pure move of today's markup — every value the markup closes over becomes a prop: at least `plans: PlansResponse | null`, `pending: 'monthly' | 'annual' | null`, `onCheckout: (cadence: 'monthly' | 'annual') => void`), `PricingOffView()`, `PricingLoadingView(props: { failed: boolean })`, `PricingPage()`.

- [ ] **Step 1 — failing BFF tests.** `BFFT/PublicCreditsTests.cs`:

```csharp
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Spectr.Bff.Services;
using Xunit;
namespace Spectr.Bff.Tests;
public sealed class PublicCreditsTests
{
    private static IConfiguration Config(string? value)
    {
        var data = new Dictionary<string, string?>();
        if (value is not null) data["Credits:Enabled"] = value;
        return new ConfigurationBuilder().AddInMemoryCollection(data).Build();
    }
    private static Func<CancellationToken, Task<Dictionary<string, string>>> Flags(Dictionary<string, string> f) => _ => Task.FromResult(f);
    private static readonly Func<CancellationToken, Task<Dictionary<string, string>>> Throws = _ => throw new InvalidOperationException("db down");
    [Fact]
    public async Task Config_Key_Wins_And_Never_Touches_The_Database() =>
        Assert.False(await PublicCredits.ResolveAsync(Config("false"), Throws, NullLogger.Instance, default));
    [Theory]
    [InlineData("false", false)]
    [InlineData("true", true)]
    public async Task Flag_Row_Decides_When_Config_Is_Silent(string flag, bool expected) =>
        Assert.Equal(expected, await PublicCredits.ResolveAsync(
            Config(null), Flags(new() { ["credits_enabled"] = flag }), NullLogger.Instance, default));
    [Fact]
    public async Task Missing_Everywhere_Means_On() =>
        Assert.True(await PublicCredits.ResolveAsync(Config(null), Flags(new()), NullLogger.Instance, default));
    [Fact]
    public async Task A_Failed_Flag_Read_Is_Unknown_Not_A_Guess() =>
        Assert.Null(await PublicCredits.ResolveAsync(Config(null), Throws, NullLogger.Instance, default));
}
```

Add to `BillingEndpointsTests.cs`:

```csharp
[SkippableFact]
public async Task Get_Plans_Reports_Credits_Enabled()
{
    TestDb.Require(TestDb.RedisUp(_factory), "Redis");
    var (factory, _) = BuildWithFakeStripe();
    var on = factory.WithWebHostBuilder(b => b.UseSetting("Credits:Enabled", "true")).CreateClient();
    var off = factory.WithWebHostBuilder(b => b.UseSetting("Credits:Enabled", "false")).CreateClient();
    var onBody = await (await on.GetAsync("/api/billing/plans")).Content.ReadFromJsonAsync<PlansResponse>();
    var offBody = await (await off.GetAsync("/api/billing/plans")).Content.ReadFromJsonAsync<PlansResponse>();
    Assert.True(onBody!.CreditsEnabled);
    Assert.False(offBody!.CreditsEnabled);
    Assert.True(offBody.ProMonthlyCents > 0); // cents still served — the page decides what to show
}
```

Add to `PublicSiteShellTests.cs`:

```csharp
[Fact]
public async Task Pricing_Shell_Tells_The_Truth_When_Credits_Are_Off()
{
    var client = _factory.WithWebHostBuilder(b => b.UseSetting("Credits:Enabled", "false")).CreateClient();
    var html = await (await client.GetAsync("/pricing")).Content.ReadAsStringAsync();
    Assert.Contains("<title>Pricing — SPECTR</title>", html);
    Assert.Contains("Free while we launch", html);
    Assert.DoesNotContain("per-release credits", html);
}
```

- [ ] **Step 2 — RED** (compile error: `PublicCredits`, `CreditsEnabled`).
- [ ] **Step 3 — implement BFF.**

`Services/PublicCredits.cs` — a static class with the single method from **Interfaces**, implementing spec D6's three steps verbatim: (1) `config["Credits:Enabled"]` non-empty → `EntitlementService.CreditsEnabled(config, new Dictionary<string, string>())` with NO call to `loadFlags`; (2) else `EntitlementService.CreditsEnabled(config, await loadFlags(ct))`; (3) `catch (Exception ex) when (ex is not OperationCanceledException)` → `logger.LogWarning` and `return null`.

`GetPlans` becomes `private static async Task<IResult> GetPlans(IOptions<PricingDisplayOptions> opts, EntitlementService entitlements, IConfiguration config, ILoggerFactory loggers, CancellationToken ct)` and passes `CreditsEnabled: await PublicCredits.ResolveAsync(config, entitlements.GetFlagsAsync, loggers.CreateLogger("PublicCredits"), ct)`. `PricingShell` becomes `async Task<IResult>` with the same injected services (minimal-API handler parameters) and, when the result is `false`, uses description "SPECTR is free while we launch — paid plans are switched off. Reports stay yours forever.", heading "Free while we launch.", body "Unlimited analyses, the full coach and every specialist. Paid plans are switched off for now."; otherwise today's strings. Title unchanged.
- [ ] **Step 4 — GREEN BFF**, then **failing FE test** `FE/src/lib/__tests__/public-plans.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlansResponse } from '../../api/types';
import { PricingLink } from '../../components/PricingLink';
import { loadPublicPlans, resetPublicPlansForTests, useCreditsEnabled } from '../public-plans';
const plans = (over: Partial<PlansResponse> = {}): PlansResponse => ({
  proMonthlyCents: 100, proAnnualCents: 1000, creditPack5Cents: 500, creditPack10Cents: 900, currency: 'USD', ...over,
});
const ok = (body: unknown) => () => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
describe('public plans', () => {
  beforeEach(() => { resetPublicPlansForTests(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  it('asks the server once per page load, however many callers', async () => {
    const f = vi.fn(ok(plans({ creditsEnabled: true })));
    vi.stubGlobal('fetch', f);
    const [a, b] = await Promise.all([loadPublicPlans(), loadPublicPlans()]);
    expect(a).toEqual(b);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('never rejects: a network failure and a 500 both resolve null', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    expect(await loadPublicPlans()).toBeNull();
    resetPublicPlansForTests();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('nope', { status: 500 }))));
    expect(await loadPublicPlans()).toBeNull();
  });
  it.each([
    [{ creditsEnabled: true }, true],
    [{ creditsEnabled: false }, false],
    [{ creditsEnabled: null }, null],
    [{}, null], // an older BFF without the field is "unknown", not "on"
  ] as const)('useCreditsEnabled(%o) → %s', async (over, expected) => {
    vi.stubGlobal('fetch', vi.fn(ok(plans(over))));
    const { result } = renderHook(() => useCreditsEnabled());
    expect(result.current).toBeNull(); // hidden-by-default before the answer
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await waitFor(() => expect(result.current).toBe(expected));
  });
  it('PricingLink renders nothing until the server says credits are on', async () => {
    vi.stubGlobal('fetch', vi.fn(ok(plans({ creditsEnabled: true }))));
    render(<PricingLink className="x" />);
    expect(screen.queryByRole('link', { name: 'Pricing' })).toBeNull();
    const link = await screen.findByRole('link', { name: 'Pricing' });
    expect(link.getAttribute('href')).toBe('/pricing');
  });
  it('PricingLink stays hidden when credits are off', async () => {
    const f = vi.fn(ok(plans({ creditsEnabled: false })));
    vi.stubGlobal('fetch', f);
    render(<PricingLink />);
    await waitFor(() => expect(f).toHaveBeenCalled());
    await Promise.resolve();
    expect(screen.queryByRole('link', { name: 'Pricing' })).toBeNull();
  });
});
```

`FE/src/features/pricing/__tests__/pricing-states.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../lib/analytics', () => ({ capture: vi.fn() }));
import { resetPublicPlansForTests } from '../../../lib/public-plans';
import { PricingPage } from '../PricingPage';
const body = (creditsEnabled: boolean | null) => JSON.stringify({
  proMonthlyCents: 100, proAnnualCents: 1000, creditPack5Cents: 500, creditPack10Cents: 900, currency: 'USD', creditsEnabled,
});
describe('PricingPage states', () => {
  beforeEach(() => { resetPublicPlansForTests(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  it('credits off: says so, offers analyze + demo, shows no plan grid', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(body(false), { status: 200 }))));
    render(<PricingPage />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Free while we launch.' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Analyze a track' }).getAttribute('href')).toBe('/analyze');
    expect(screen.getByRole('link', { name: 'Explore the demo' }).getAttribute('href')).toBe('/demo');
    expect(screen.queryByText('Honest billing. No asterisks.')).toBeNull();
    expect(document.body.textContent).not.toContain('*');
  });
  it('credits on: the existing plans page', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(body(true), { status: 200 }))));
    render(<PricingPage />);
    expect(await screen.findByText('Honest billing. No asterisks.')).toBeTruthy();
  });
  it('before the answer, and when it never comes: neutral page, no plan copy', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    render(<PricingPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Pricing' })).toBeTruthy();
    expect(await screen.findByText(/couldn.t load/i)).toBeTruthy();
    expect(screen.queryByText('Honest billing. No asterisks.')).toBeNull();
  });
});
```

- [ ] **Step 5 — RED**, then implement `FE/src/lib/public-plans.ts`:

```ts
/* What a LOGGED-OUT page may know about pricing. One request per page load,
 * shared by every caller; never rejects. Provider-free on purpose — it is
 * read by PublicChrome, which must stay static-render testable. */
import { useEffect, useState } from 'react';
import type { PlansResponse } from '../api/types';
let inflight: Promise<PlansResponse | null> | null = null;
export function loadPublicPlans(): Promise<PlansResponse | null> {
  inflight ??= (async () => {
    try {
      const res = await fetch('/api/billing/plans', { headers: { Accept: 'application/json' } });
      return res.ok ? ((await res.json()) as PlansResponse) : null;
    } catch {
      return null;
    }
  })();
  return inflight;
}
export function resetPublicPlansForTests(): void { inflight = null; }
/** true/false only when the server said so; null = unknown → callers HIDE. */
export function useCreditsEnabled(): boolean | null {
  const [value, setValue] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void loadPublicPlans().then((p) => {
      if (alive) setValue(typeof p?.creditsEnabled === 'boolean' ? p.creditsEnabled : null);
    });
    return () => { alive = false; };
  }, []);
  return value;
}
```

`PricingLink`: `const on = useCreditsEnabled(); return on === true ? <a href="/pricing" className={className}>{children ?? 'Pricing'}</a> : null;`. `PricingPage`: state `'loading' | 'failed' | PlansResponse` from `loadPublicPlans()` (keep `capture('pricing_viewed')` on mount and `usePageMeta`); `creditsEnabled === true` → `PricingPlansView`, `=== false` → `PricingOffView`, otherwise `PricingLoadingView failed={state === 'failed' || flag unknown}`. `PricingPlansView` is a **pure move** of `routes/pricing.tsx:119-222` plus the checkout handlers' state passed as props — no copy edits. `routes/pricing.tsx` keeps only `createFileRoute('/pricing')({ component: PricingPage })` importing from `../features/pricing/PricingPage`. `types.ts`: add `creditsEnabled?: boolean | null;`. Replace the three raw Pricing anchors (`PublicChrome.tsx:26`, `LandingPage.tsx:70`, `TrustPage.tsx:40`) with `<PricingLink className={…} />`; wrap the landing's "See pricing" CTA (`:53`) so it renders only when `useCreditsEnabled() === true` (P3 replaces it).
- [ ] **Step 6 — update pinned tests:** `landing.test.tsx:20,75` → `expect(html).not.toContain('href="/pricing"')`; its `PricingPage` block (`:83-97`) renders `<PricingPlansView plans={null} pending={null} onCheckout={() => {}} />` (same assertions); `trust.test.tsx:5,73-77` and `kitchen-sink-axe.test.tsx:7` import `PricingPlansView` from `features/pricing` (axe also runs over `<PricingOffView />`); `funnel-events.test.tsx:29` imports `../../pricing/PricingPage` and stubs `fetch` to a pending promise.
- [ ] **Step 7 — GREEN + ALL gates (frontend + BFF). Live:** with the dev BFF (credits off) → no Pricing link in chrome/footers, `/pricing` shows the off state; stub `creditsEnabled:true` via `page.route` → link appears, "Sign in" x-position unchanged (spec §4.3).
- [ ] **Step 8 — commit** `feat(public): pricing stays hidden until the server says credits are on`.

---

### Task P5: Plain-language sample report

**Files**
- Modify: `FE/src/features/landing/sample-report.ts`, `FE/src/features/landing/SampleReportEmbed.tsx`, `FE/src/features/landing/landing.module.css`
- Create: `FE/src/features/landing/__tests__/sample-plain.test.tsx`

**Interfaces**
- Produces: `SampleFinding.plain: string`; `SampleReport.plainSummary: string` (copy verbatim from spec D9).
- Consumes: `GLOSSARY` from `features/results/glossary-terms.ts` (`readonly (readonly [string, string])[]`).

- [ ] **Step 1 — failing test:**

```tsx
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GLOSSARY } from '../../results/glossary-terms';
import { SampleReportEmbed } from '../SampleReportEmbed';
import { SAMPLE_REPORT } from '../sample-report';
describe('sample report — readable without audio vocabulary', () => {
  it('every finding has a plain sentence, in words only (no invented numbers)', () => {
    for (const f of SAMPLE_REPORT.findings) {
      expect(f.plain.length).toBeGreaterThan(40);
      expect(f.plain).not.toMatch(/\d/);
    }
    expect(SAMPLE_REPORT.plainSummary).not.toMatch(/\d/);
  });
  it('the plain lines are visible text, not tooltips', () => {
    const html = renderToStaticMarkup(<SampleReportEmbed />);
    for (const f of SAMPLE_REPORT.findings) expect(html).toContain(f.plain.slice(0, 30));
    expect(html).toContain('In plain English');
    expect(html).not.toContain('gtip');
  });
  it('glosses LUFS from the shared glossary and links the full report in the demo', () => {
    const html = renderToStaticMarkup(<SampleReportEmbed />);
    const lufs = GLOSSARY.find(([term]) => term === 'LUFS');
    expect(lufs).toBeDefined();
    expect(html).toContain(lufs![1].slice(0, 40));
    expect(html).toContain('href="/demo"');
  });
  it('the numbers still match the canonical pipeline sample', () => {
    const raw = JSON.parse(readFileSync(
      resolve(__dirname, '../../../../../../schemas/samples/sample1_8aeef3b4.json'), 'utf8',
    )) as { grade: string; overall_score: number; danceability_score: number;
            phases: Array<{ phase: number; data: { bpm: number; lufs: number; detected_key: string } }> };
    const p1 = raw.phases.find((p) => p.phase === 1)!.data;
    expect(SAMPLE_REPORT.grade).toBe(raw.grade);
    expect(SAMPLE_REPORT.overallScore).toBe(Math.round(raw.overall_score));
    expect(SAMPLE_REPORT.danceability).toBe(raw.danceability_score);
    expect(SAMPLE_REPORT.bpm).toBe(Math.round(p1.bpm));
    expect(SAMPLE_REPORT.lufs.toFixed(1)).toBe(p1.lufs.toFixed(1));
    expect(SAMPLE_REPORT.detectedKey).toBe(p1.detected_key);
  });
});
```

- [ ] **Step 2 — RED. Step 3 — implement:** add the two fields with the spec D9 copy; in the embed render `<p className={s.plainSummary}>{r.plainSummary}</p>` above the list, under each finding `<span className={s.findingPlain}><span className={`mono ${s.plainTag}`}>In plain English</span> {f.plain}</span>`, after the pills `<p className={s.gloss}><span className="mono">LUFS</span> — {lufsDefinition}</p>`, and in the caption add `{' '}<a href="/demo">See a full report in the demo →</a>`. CSS: `.findingPlain`/`.plainSummary`/`.gloss` in `landing.module.css`, tokens only (`color: var(--text-2)`, 13px, `line-height: 1.5`); the finding `<li>` becomes a two-row grid so the plain line sits under the text.
- [ ] **Step 4 — GREEN + ALL gates** (`landing.test.tsx:43-64` must stay green untouched). **Live:** at 390 px the embed has no horizontal overflow and each plain line wraps inside the card (spec §4.5).
- [ ] **Step 5 — commit** `feat(landing): the sample report explains itself in plain English`.

---

### Task P3: Demo CTA, chrome link, one product footer  *(after sibling D9)*

**Files**
- Create: `FE/src/components/PublicFooter.tsx`, `FE/src/components/PublicFooter.module.css`, `FE/src/components/__tests__/public-footer.test.tsx`, `FE/src/features/trust/trust-pages.ts`
- Modify: `FE/src/features/landing/LandingPage.tsx:48-54,68-78`, `FE/src/components/PublicChrome.tsx`, `PublicChrome.module.css`, `FE/src/features/trust/TrustPage.tsx:10-14,36-41`, `FE/src/features/pricing/{PricingPlansView,PricingOffView}.tsx`, `FE/src/lib/analytics.ts:28-42`
- Update tests: `features/landing/__tests__/landing.test.tsx` (chrome + landing blocks)

**Interfaces**
- Consumes: route `/demo` and (if present) `'demo_cta_clicked'` in `EventName` from sibling D9; `PricingLink` (P2).
- Produces: `TRUST_PAGES` from `features/trust/trust-pages.ts` (re-exported by `TrustPage.tsx`); `PublicFooter()`; `EventName` includes `'demo_cta_clicked'` (add only if absent).

- [ ] **Step 1 — failing tests.** `public-footer.test.tsx`:

```tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuthContext } from '../../auth/AuthContext';
import type { AuthedUser } from '../../api/types';
import { PublicFooter } from '../PublicFooter';
describe('PublicFooter — a product footer, not a byline', () => {
  const html = renderToStaticMarkup(<PublicFooter />);
  it('groups product, engineering, trust and account links', () => {
    for (const href of ['/analyze', '/demo', '/trust/how-its-built', '/trust/no-training',
      '/trust/results-forever', '/trust/privacy', '/login', '/register']) {
      expect(html).toContain(`href="${href}"`);
    }
    expect(html).toContain(`© ${new Date().getFullYear()} SPECTR`);
  });
  it('carries no personal byline, no repo link, and no pricing link by default', () => {
    expect(html).not.toMatch(/built by/i);
    expect(html).not.toContain('github.com');
    expect(html).not.toContain('href="/pricing"');
  });
  it('swaps the account group for the library when signed in', () => {
    const user: AuthedUser = { id: 'u1', email: 'a@b', displayName: null, tier: 'free' };
    const authed = renderToStaticMarkup(
      <AuthContext.Provider value={{ user, accessToken: 't', isLoading: false } as never}>
        <PublicFooter />
      </AuthContext.Provider>,
    );
    expect(authed).toContain('href="/library"');
    expect(authed).not.toContain('href="/register"');
  });
});
```

In `landing.test.tsx` add/replace: chrome block → `expect(html).toContain('href="/trust/how-its-built"')`; landing block → `expect(html).toContain('data-testid="landing-demo-cta"')`, `expect(html).toContain('href="/demo"')`, `expect(html).toContain('Explore the demo')`, `expect(html).not.toContain('See pricing')`, and `expect((html.match(/href="\/demo"/g) ?? []).length).toBeGreaterThanOrEqual(1)`.
- [ ] **Step 2 — RED. Step 3 — implement:** secondary CTA `<a href="/demo" className="btn ghost" data-testid="landing-demo-cta" onClick={() => capture('demo_cta_clicked', { source: 'landing' })}>Explore the demo</a>` — if D9 already placed a landing demo CTA, keep ONE (this slot, this test id). `PublicChrome`: `<a href="/trust/how-its-built" className={`${s.navLink} ${s.navOptional}`}>How it&rsquo;s built</a>` before `<PricingLink className={s.navLink} />`; CSS `@media (max-width: 480px) { .navOptional { display: none; } .chrome { padding: 12px 16px; } .nav { gap: 12px; } }`. `PublicFooter`: `<footer>` with four `<nav aria-label="…">` groups (Product: Analyze a track, Explore the demo, `<PricingLink>`; Engineering: How it's built; Trust: `TRUST_PAGES`; Account: Sign in + Create account, or Open library via `useOptionalAuth`), then `<p className="mono">© {new Date().getFullYear()} SPECTR</p>`; grid `repeat(auto-fit, minmax(150px, 1fr))`. Replace `LandingPage.tsx:68-78`, `TrustPage.tsx:36-41` and the trust-link paragraph in `PricingPlansView` with `<PublicFooter />`; add it to `PricingOffView`. `trust.test.tsx:52-77` must stay green (every trust page still links the other two).
- [ ] **Step 4 — GREEN + ALL gates. Live (spec §4.1-4.2):** 390 px — chrome is one row, "How it's built" hidden, footer wraps into ≥ 2 columns, no horizontal scroll on `/`, `/pricing`, `/trust/privacy`; 1440 px — footer is one row.
- [ ] **Step 5 — commit** `feat(public): demo CTA, engineering link and one product footer`.

---

### Task P4: "How it's built" at `/trust/how-its-built`

**Files**
- Create: `FE/src/routes/trust.how-its-built.tsx`, `FE/src/features/engineering/{EngineeringPage.tsx,ArchitectureDiagram.tsx,decisions.ts,engineering.module.css,stats.generated.json}`, `FE/src/config/site.ts`, `FE/scripts/site-stats.mjs`, `FE/src/features/engineering/__tests__/{engineering.test.tsx,site-stats.test.ts}`
- Modify: `FE/src/features/trust/TrustPage.tsx:16-35` (`path: string`, `eyebrow?: string`, `updated?: string`), `FE/src/lib/analytics.ts` (`'engineering_viewed'`), `FE/package.json` (`"stats": "node scripts/site-stats.mjs"`), `FE/src/routes/__tests__/no-social-surface.test.ts` (**one line**: `'trust.how-its-built.tsx',`), `infra/Caddyfile` (`redir /how-its-built /trust/how-its-built` directly under `encode`)

**Interfaces**
- Produces: `SITE = { origin: 'https://spectrmix.com', repoUrl: 'https://github.com/rankinbc/AIMusicAnalysisSite', ciUrl: 'https://github.com/rankinbc/AIMusicAnalysisSite/actions/workflows/ci.yml' } as const`; `DECISIONS: readonly { id: string; title: string; body: string }[]` (seven entries, spec §3.1 rows 3a–3g); `stats.generated.json` = `{ "generatedAt": "YYYY-MM-DD", "floors": { frontendTestFiles, frontendTestCases, bffTestClasses, bffTestCases, pythonTestFiles, endpoints, migrations, tables, specialistPrompts } }`; `EngineeringPage()`; `ArchitectureDiagram()`.

- [ ] **Step 1 — write** `FE/scripts/site-stats.mjs` (counting rules = spec §3.3):

```js
// Recounts the numbers the engineering page prints. `--json` → counts;
// `--write` → re-floor stats.generated.json; no flag → both, human-readable.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const FE = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(FE, '..', '..');
const SKIP = new Set(['node_modules', 'dist', 'bin', 'obj', '.venv', 'venv', '__pycache__']);
const OUT = join(FE, 'src', 'features', 'engineering', 'stats.generated.json');
function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(join(dir, e.name), out); } else out.push(join(dir, e.name).replaceAll('\\', '/'));
  }
  return out;
}
const matches = (files, re) => files.reduce((n, f) => n + (readFileSync(f, 'utf8').match(re)?.length ?? 0), 0);
const feTests = walk(join(FE, 'src')).filter((f) => /\.test\.tsx?$/.test(f));
const bffTests = walk(join(ROOT, 'components', 'bff', 'tests')).filter((f) => f.endsWith('.cs'));
const py = ['worker', 'analysis', 'shared', 'workerdash']
  .flatMap((c) => walk(join(ROOT, 'components', c))).filter((f) => /\/test_[^/]+\.py$/.test(f));
const endpoints = walk(join(ROOT, 'components', 'bff', 'src', 'Spectr.Bff', 'Endpoints')).filter((f) => f.endsWith('.cs'));
const migrations = readdirSync(join(ROOT, 'components', 'bff', 'src', 'Spectr.Data', 'Migrations'))
  .filter((f) => f.endsWith('.cs') && !f.endsWith('.Designer.cs') && !f.includes('ModelSnapshot'));
export const counts = {
  frontendTestFiles: feTests.length,
  frontendTestCases: matches(feTests, /^\s*(?:it|test)(?:\.each\b[^\n]*?)?\(/gm),
  bffTestClasses: bffTests.filter((f) => f.endsWith('Tests.cs')).length,
  bffTestCases: matches(bffTests, /^\s*\[(?:Skippable)?(?:Fact|Theory)\b/gm),
  pythonTestFiles: py.length,
  endpoints: matches(endpoints, /\.Map(?:Get|Post|Put|Patch|Delete)\(/g),
  migrations: migrations.length,
  tables: matches([join(ROOT, 'components', 'bff', 'src', 'Spectr.Data', 'AppDbContext.cs')], /public\s+DbSet</g),
  specialistPrompts: readdirSync(join(ROOT, 'components', 'worker', 'prompts', 'experts')).filter((f) => f.endsWith('.md')).length,
};
const floor = (n) => (n >= 100 ? Math.floor(n / 10) * 10 : Math.floor(n / 5) * 5);
const args = new Set(process.argv.slice(2));
if (args.has('--json')) process.stdout.write(JSON.stringify(counts));
else {
  const floors = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, floor(v)]));
  if (args.has('--write')) writeFileSync(OUT, `${JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), floors }, null, 2)}\n`);
  console.table(Object.fromEntries(Object.keys(counts).map((k) => [k, { count: counts[k], floor: floors[k] }])));
}
```

Run `node scripts/site-stats.mjs --write` to create the JSON (expected floors 2026-09-20: 150 / 950 / 55 / 350 / 140 / 130 / 50 / 30 / 25).
- [ ] **Step 2 — failing tests.** `site-stats.test.ts` (node env):

```ts
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
const FE = resolve(__dirname, '../../../..');
const counts = JSON.parse(
  execFileSync(process.execPath, ['scripts/site-stats.mjs', '--json'], { cwd: FE, encoding: 'utf8' }),
) as Record<string, number>;
const { floors } = JSON.parse(readFileSync(resolve(__dirname, '../stats.generated.json'), 'utf8')) as {
  floors: Record<string, number>;
};
describe('engineering page numbers', () => {
  it('prints a floor for every count the script knows, and nothing else', () => {
    expect(Object.keys(floors).sort()).toEqual(Object.keys(counts).sort());
  });
  it.each(Object.keys(floors))('%s never overstates the repo', (key) => {
    expect(floors[key]).toBeGreaterThan(0);
    expect(floors[key]).toBeLessThanOrEqual(counts[key] ?? 0);
  });
});
```

`engineering.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { run as axeRun } from 'axe-core';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { SITE } from '../../../config/site';
import { DECISIONS } from '../decisions';
import { EngineeringPage } from '../EngineeringPage';
import stats from '../stats.generated.json';
afterEach(() => { cleanup(); });
describe('EngineeringPage', () => {
  const html = renderToStaticMarkup(<EngineeringPage />);
  it('has the binding sections', () => {
    for (const h of ['How SPECTR is built', 'Architecture', 'Decisions', 'By the numbers', 'CI and security', 'Known limits', 'Source']) {
      expect(html).toContain(h);
    }
    expect(DECISIONS).toHaveLength(7);
    for (const d of DECISIONS) expect(html).toContain(d.title);
  });
  it('prints every number as a floor', () => {
    for (const v of Object.values(stats.floors)) expect(html).toContain(`${v.toLocaleString('en-US')}+`);
  });
  it('links the demo and the open-source repo — and nothing personal', () => {
    expect(html).toContain('href="/demo"');
    expect(html).toContain(`href="${SITE.repoUrl}"`);
    expect(html).toContain(`href="${SITE.ciUrl}"`);
    expect(html).not.toMatch(/built by|<img[^>]+github/i);
  });
  it('does not repeat the two claims the repo cannot prove', () => {
    expect(html).not.toMatch(/starve/i);
    expect(html).not.toMatch(/SHA-pinned/i);
  });
  it('stays clear of the guard suite\u2019s banned phrases', () => {
    expect(html).not.toMatch(/jobs? waiting|jobs? queued|queueDepth|\bfollowers\b|isPublic/i);
  });
  it('is accessible (axe, WCAG 2.1 AA, contrast off — jsdom has no paint)', async () => {
    const { container } = render(<main><EngineeringPage /></main>);
    const res = await axeRun(container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(res.violations.map((v) => v.id)).toEqual([]);
  });
});
```

- [ ] **Step 3 — RED. Step 4 — implement:** route file = `createFileRoute('/trust/how-its-built')({ component: EngineeringPage })` importing from `../features/engineering/EngineeringPage` (no component exported from the route file). `EngineeringPage` renders `<TrustPage path="/trust/how-its-built" eyebrow="Engineering" title="How SPECTR is built" metaDescription="…spec §3…">` with the seven sections of spec §3.1 — copy each claim from the table, re-opening every cited `path:line` first; **drop the "always wired in" sentence of 3f unless `features/listen/useAudioGraph.ts` confirms it**. `useEffect(() => { capture('engineering_viewed'); }, [])`. Numbers: a `<dl>` from `stats.floors` (`{n.toLocaleString('en-US')}+`), plus "seven-phase pipeline" from `BASE_PHASES.length` (`features/results/progress-phases.ts`) and "four named queues". `ArchitectureDiagram`: `<ol className={s.diagram} aria-label="Request path">` of five `<li>` (name + one-line role), connectors via `::after`; `flex-direction: column` by default, `row` from `@media (min-width: 720px)`. Source section: `<a href={SITE.repoUrl} rel="noopener noreferrer">Source on GitHub</a>` and `<a href={SITE.ciUrl} rel="noopener noreferrer">CI runs on every push →</a>`. `TrustPage`: header shows `eyebrow ?? 'Trust'` and the "Last updated" line only when `updated` is given. Add the ONE allowlist line. Caddy: `redir /how-its-built /trust/how-its-built` (permanent is NOT used — keep it a 302 while the URL is young).
- [ ] **Step 5 — GREEN + ALL gates** (guard suite green with exactly one added line; `git diff --stat` on that file shows `1 insertion`). **Live (spec §4.4):** diagram column at 390 px / row at 1440 px; no horizontal scroll at either; `/how-its-built` redirect is verified by `caddy validate` in P9.
- [ ] **Step 6 — commit** `feat(public): "How it's built" — architecture, decisions and numbers a test keeps honest`.

---

### Task P6: Link previews — meta, sitemap, crawler shell, parity

**Files**
- Modify: `FE/src/lib/usePageMeta.ts`, `FE/index.html:14-20`, `FE/public/robots.txt`, `BFF/Endpoints/PublicSiteEndpoints.cs` (new shell after `:47`), `infra/Caddyfile:23`, `FE/src/routes/trust.no-training.tsx:50-54`, `FE/src/components/NotFoundScreen.tsx` (`noindex`), callers of `usePageMeta` for public pages (pass `{ path }`: `LandingPage` `/`, `AnalyzePage` `/analyze`, `TrustPage` `path`, `PricingPage` `/pricing`)
- Create: `FE/public/sitemap.xml`, `FE/src/lib/__tests__/usePageMeta.test.tsx`, `FE/src/routes/__tests__/public-surface-parity.test.ts`
- Update tests: `features/trust/__tests__/trust.test.tsx:26`, `BFFT/PublicSiteShellTests.cs` (one `InlineData`)

**Interfaces**
- Produces: `usePageMeta(title: string, description?: string, opts?: { path?: string; noindex?: boolean }): void`.

- [ ] **Step 1 — failing tests.** `usePageMeta.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { usePageMeta } from '../usePageMeta';
const meta = (sel: string) => document.head.querySelector<HTMLMetaElement>(sel)?.content ?? null;
const canonical = () => document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? null;
afterEach(() => { cleanup(); document.head.innerHTML = ''; });
describe('usePageMeta', () => {
  it('sets canonical, og:url and the twitter pair for a public path', () => {
    renderHook(() => usePageMeta('T — SPECTR', 'D', { path: '/trust/privacy' }));
    expect(canonical()).toBe(`${window.location.origin}/trust/privacy`);
    expect(meta('meta[property="og:url"]')).toBe(`${window.location.origin}/trust/privacy`);
    expect(meta('meta[name="twitter:title"]')).toBe('T — SPECTR');
    expect(meta('meta[name="twitter:description"]')).toBe('D');
  });
  it('adds robots noindex only when asked, and no canonical without a path', () => {
    renderHook(() => usePageMeta('Page not found — SPECTR', undefined, { noindex: true }));
    expect(meta('meta[name="robots"]')).toBe('noindex');
    expect(canonical()).toBeNull();
  });
  it('restores what it found and removes what it created on unmount', () => {
    document.head.innerHTML = '<meta name="description" content="base"><link rel="canonical" href="https://x.test/base">';
    const { unmount } = renderHook(() => usePageMeta('T', 'D', { path: '/a', noindex: true }));
    unmount();
    expect(meta('meta[name="description"]')).toBe('base');
    expect(canonical()).toBe('https://x.test/base');
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
    expect(document.head.querySelector('meta[property="og:url"]')).toBeNull();
  });
});
```

`public-surface-parity.test.ts` (node env):

```ts
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
const FE = resolve(__dirname, '../../..');
const ROOT = resolve(FE, '../..');
const sitemap = readFileSync(resolve(FE, 'public/sitemap.xml'), 'utf8');
const caddy = readFileSync(resolve(ROOT, 'infra/Caddyfile'), 'utf8');
const shells = readFileSync(resolve(ROOT, 'components/bff/src/Spectr.Bff/Endpoints/PublicSiteEndpoints.cs'), 'utf8');
const paths = [...sitemap.matchAll(/<loc>https:\/\/spectrmix\.com([^<]*)<\/loc>/g)].map((m) => m[1] || '/');
const botLine = caddy.split('\n').find((l) => l.trim().startsWith('path / ')) ?? '';
const routeFile = (p: string) => (p === '/' ? 'index.tsx' : `${p.slice(1).replaceAll('/', '.')}.tsx`);
describe('public surface parity — sitemap ↔ Caddy bot split ↔ BFF shell ↔ route file', () => {
  it('lists exactly the indexable pages', () => {
    expect(paths.sort()).toEqual(['/', '/analyze', '/trust/how-its-built', '/trust/no-training',
      '/trust/privacy', '/trust/results-forever'].sort());
  });
  it.each(paths)('%s unfurls and exists', (p) => {
    const tokens = botLine.trim().split(/\s+/);
    expect(tokens).toContain(p);
    if (p !== '/') expect(tokens).toContain(`${p}/`);
    expect(shells).toContain(`path: "${p}"`);
    expect(existsSync(resolve(FE, 'src/routes', routeFile(p)))).toBe(true);
  });
  it('robots.txt points at the sitemap and keeps the demo out of the index', () => {
    const robots = readFileSync(resolve(FE, 'public/robots.txt'), 'utf8');
    expect(robots).toContain('Sitemap: https://spectrmix.com/sitemap.xml');
    expect(robots).toContain('Disallow: /demo');
  });
});
```

- [ ] **Step 2 — RED. Step 3 — implement** `usePageMeta` (keep `upsert`/`named`/`property`; add a link helper):

```ts
function upsertLink(rel: string, href: string): () => void {
  let link = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  const created = !link;
  const prev = link?.getAttribute('href') ?? null;
  if (!link) { link = document.createElement('link'); link.rel = rel; document.head.appendChild(link); }
  link.setAttribute('href', href);
  const el = link;
  return () => { if (created) el.remove(); else if (prev !== null) el.setAttribute('href', prev); };
}
export interface PageMetaOptions { path?: string; noindex?: boolean }
export function usePageMeta(title: string, description?: string, opts?: PageMetaOptions): void {
  const path = opts?.path;
  const noindex = opts?.noindex === true;
  useEffect(() => {
    const prevTitle = document.title;
    document.title = title;
    const restores: Array<() => void> = [
      upsert('meta[property="og:title"]', property('og:title'), title),
      upsert('meta[name="twitter:title"]', named('twitter:title'), title),
    ];
    if (description) {
      restores.push(
        upsert('meta[name="description"]', named('description'), description),
        upsert('meta[property="og:description"]', property('og:description'), description),
        upsert('meta[name="twitter:description"]', named('twitter:description'), description),
      );
    }
    if (path) {
      const url = `${window.location.origin}${path}`;
      restores.push(upsertLink('canonical', url), upsert('meta[property="og:url"]', property('og:url'), url));
    }
    if (noindex) restores.push(upsert('meta[name="robots"]', named('robots'), 'noindex'));
    return () => { document.title = prevTitle; for (const restore of restores) restore(); };
  }, [title, description, path, noindex]);
}
```

`index.html`: add `<meta name="twitter:card" content="summary_large_image" />` and `<meta name="twitter:image" content="/og-share.png" />` (no static canonical). `sitemap.xml`: the six URLs of the parity test. `robots.txt`: append `Disallow: /demo` and `Sitemap: https://spectrmix.com/sitemap.xml`. BFF: `app.MapGet("/trust/how-its-built", (HttpContext c) => Shell(c, path: "/trust/how-its-built", title: "How SPECTR is built — SPECTR", description: "The architecture, the decisions and the guard rails behind SPECTR — a .NET BFF, a Python analysis worker and a React audio workstation.", heading: "How SPECTR is built", body: "A .NET gateway, a Python analysis worker and a React audio workstation — with the numbers and the trade-offs."))…` + `[InlineData("/trust/how-its-built", "How SPECTR is built — SPECTR")]`. Caddy `:23`: append ` /trust/how-its-built /trust/how-its-built/`. `trust.no-training.tsx:50-54`: "…read only by the analysis pipeline and your own playback. See the privacy defaults page for retention specifics."; `trust.test.tsx:26` → `expect(html).toContain('your own playback'); expect(html).not.toContain('share the track');`. `PLEDGE_VERSION` stays `1.0` (the commitment is unchanged; a removed feature is not a pledge change) — say so in the commit body.
- [ ] **Step 4 — GREEN + ALL gates (frontend + BFF). Live (post-deploy, controller):** spec §4.11.
- [ ] **Step 5 — commit** `feat(public): canonical + twitter meta, sitemap, and a parity test for every public page`.

---

### Task P8: Phone fixes

**Files**
- Create: `FE/src/hooks/useMinWidth.ts`, `FE/src/features/listen-rack/__tests__/LightShow.test.tsx`, `FE/src/features/results/results-phone.css`
- Modify: `FE/src/features/listen-rack/LightShow.tsx:7-122`, `FE/src/features/listen-rack/ListenRackPage.tsx:496-502` (link only — file is 512 lines, add ≤ 3), `FE/src/routes/_app/_appLayout.module.css`, `FE/src/features/results/ReportView.tsx` (one CSS import)

**Interfaces**
- Produces: `useMinWidth(px: number): boolean` (true when `matchMedia` is unavailable — keeps today's behaviour in old browsers/tests).

- [ ] **Step 1 — failing test** (`src/features/listen-rack/**` is already jsdom):

```tsx
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LightShow } from '../LightShow';
const spies = new Map<PropertyKey, ReturnType<typeof vi.fn>>();
const ctx = new Proxy({}, {
  get: (_t, p) => {
    if (p === 'createRadialGradient' || p === 'createLinearGradient') return () => ({ addColorStop() {} });
    if (!spies.has(p)) spies.set(p, vi.fn());
    return spies.get(p);
  },
  set: () => true,
});
const raf = vi.fn(() => 1);
function media(map: Record<string, boolean>) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: map[q] ?? false, media: q, addEventListener() {}, removeEventListener() {},
  }));
}
const DESKTOP = '(min-width: 1024px)';
const REDUCE = '(prefers-reduced-motion: reduce)';
describe('LightShow', () => {
  beforeEach(() => {
    raf.mockClear();
    spies.clear();
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it('below 1024px it mounts nothing and arms no animation loop', () => {
    media({ [DESKTOP]: false });
    const { container } = render(<LightShow playing show />);
    expect(container.querySelector('canvas')).toBeNull();
    expect(raf).not.toHaveBeenCalled();
  });
  it('on desktop it animates — also while paused (the dimmed idle state is the design)', () => {
    media({ [DESKTOP]: true });
    const { container } = render(<LightShow playing={false} show />);
    expect(container.querySelector('canvas.lr-bgfx')).not.toBeNull();
    expect(raf).toHaveBeenCalledTimes(1);
  });
  it('under reduced motion it paints one static frame and never re-arms', () => {
    media({ [DESKTOP]: true, [REDUCE]: true });
    const { container } = render(<LightShow playing show />);
    expect(container.querySelector('canvas.lr-bgfx')).not.toBeNull();
    expect(raf).not.toHaveBeenCalled();
    expect(spies.get('clearRect')).toHaveBeenCalledTimes(1); // exactly one frame was painted
  });
  it('show=false still wins', () => {
    media({ [DESKTOP]: true });
    const { container } = render(<LightShow playing show={false} />);
    expect(container.querySelector('canvas')).toBeNull();
  });
});
```

- [ ] **Step 2 — RED. Step 3 — implement.** `useMinWidth` = the `useReducedMotion` pattern (`src/hooks/useReducedMotion.ts`) for `(min-width: ${px}px)`, initial/fallback `true`. In `LightShow`:

```tsx
const desktop = useMinWidth(1024);
const reduce = useReducedMotion();
const active = show && desktop;
useEffect(() => {
  if (!active) return undefined;
  // …unchanged setup (c, ctx, beams, dust)…
  const draw = () => {
    // …unchanged body, but its last line becomes:
    if (!reduce) raf = requestAnimationFrame(draw);
  };
  if (reduce) {
    draw(); // one static frame; redraw on resize so it never stretches
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }
  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
}, [active, reduce]);
return active ? <canvas className="lr-bgfx" ref={cv} /> : null;
```

Desktop-only card: add `<a href={reportHref} className="btn sm">← Back to the report</a>` where `reportHref` is the page's existing report link target (`reportRef`/`songId` props — reuse whatever the page's "Back to report" control already computes; if none exists, link to `/library`). `_appLayout.module.css`: `@media (max-width: 640px) { .topnav { padding: 0 12px; gap: 8px; } .brandCaption { display: none; } .navTab { padding: 6px 10px; } }`. `results-phone.css` (imported once from `ReportView.tsx`): `@media (max-width: 640px) { .rdx .rd-row { grid-template-columns: 1fr 1fr; row-gap: 6px; } }` — **measure first** (see Live) and adjust the column recipe to what the six cells need; keep the specificity ≥ the generated rule's and add a comment naming `redesign-v3-tabs.css:924`.
- [ ] **Step 4 — GREEN + ALL gates** (`src/styles/__tests__/responsive-1024.test.ts` stays green untouched). **Live (spec §4.6-4.8):** 390 px — no `canvas.lr-bgfx` in the DOM on the Listen page, app top nav `scrollWidth <= clientWidth`, `.rd-row` fits its container on the Reference tab (report before/after widths); 1440 px with `prefers-reduced-motion` emulated — canvas has lit pixels and a one-second `requestAnimationFrame` counter on the LightShow loop reads 0; without it, ≈ 60.
- [ ] **Step 5 — commit** `fix(mobile): no background animation behind the desktop-only card; phone-width nav and reference rows`.

---

### Task P7: Bundle diet

**Files**
- Modify: `FE/src/lib/analytics.ts`, `FE/src/lib/sentry.ts`, `FE/src/main.tsx:10,75-92`, `FE/src/routes/_public/{login,register,reset-password,verify-email}.tsx`, `FE/src/routes/trust.{no-training,privacy,results-forever}.tsx` + `FE/src/routes/_app/dev.kitchen-sink.tsx` (components move to `features/trust/pages/*.tsx` and `features/dev/KitchenSinkPage.tsx`; route files keep `createFileRoute` + constants such as `PLEDGE_VERSION` re-exported from the feature file), `FE/index.html`, `FE/package.json` (remove `zod`, `recharts`, `wavesurfer.js`, `ai`; add `"lint:bundle": "node scripts/check-bundle-size.mjs"`), `.github/workflows/ci.yml` (step "Bundle budget" after "Build"), `README.md:49,63`
- Create: `FE/src/components/AppErrorBoundary.tsx`, `FE/src/lib/search-params.ts`, `FE/scripts/check-bundle-size.mjs`, tests `FE/src/lib/__tests__/{analytics-lazy,sentry-lazy,search-params}.test.ts`
- Update tests: imports in `features/trust/__tests__/trust.test.tsx:6-8`, `routes/__tests__/kitchen-sink-axe.test.tsx:8`

**Interfaces**
- Produces: unchanged public API of `analytics.ts` (`initAnalytics`, `identifyUser`, `capture`) and `sentry.ts` (`initSentry`, `setCorrelation`, `reportError`; the `Sentry` re-export is REMOVED); `AppErrorBoundary(props: { fallback: ReactNode; children: ReactNode })`; `optionalString<K extends string>(key: K): (raw: Record<string, unknown>) => { [P in K]?: string }`.

- [ ] **Step 1 — failing tests.** `analytics-lazy.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
const ph = vi.hoisted(() => ({ init: vi.fn(), capture: vi.fn(), identify: vi.fn(), reset: vi.fn() }));
vi.mock('posthog-js', () => ({ default: ph }));
async function load(key: string) {
  vi.resetModules();
  vi.stubEnv('VITE_POSTHOG_KEY', key);
  return import('../analytics');
}
afterEach(() => { vi.unstubAllEnvs(); for (const f of Object.values(ph)) f.mockReset(); });
describe('analytics — posthog is loaded only when there is a key', () => {
  it('without a key nothing is imported, initialised or captured', async () => {
    const a = await load('');
    a.initAnalytics();
    a.capture('landing_viewed');
    await vi.dynamicImportSettled();
    expect(ph.init).not.toHaveBeenCalled();
    expect(ph.capture).not.toHaveBeenCalled();
  });
  it('events fired before the SDK arrives are delivered, in order', async () => {
    const a = await load('phc_test');
    a.capture('landing_viewed');
    a.initAnalytics();
    a.capture('pricing_viewed', { x: 1 });
    a.identifyUser('u1');
    expect(ph.capture).not.toHaveBeenCalled(); // still loading
    await vi.dynamicImportSettled();
    expect(ph.init).toHaveBeenCalledTimes(1);
    expect(ph.capture.mock.calls).toEqual([['landing_viewed', undefined], ['pricing_viewed', { x: 1 }]]);
    expect(ph.identify).toHaveBeenCalledWith('u1');
    a.capture('resume_shown');
    expect(ph.capture).toHaveBeenCalledTimes(3); // direct once loaded
  });
  it('the queue is bounded and an init failure drops it silently', async () => {
    ph.init.mockImplementation(() => { throw new Error('blocked storage'); });
    const a = await load('phc_test');
    for (let i = 0; i < 80; i++) a.capture('landing_viewed');
    a.initAnalytics();
    await vi.dynamicImportSettled();
    expect(ph.capture).not.toHaveBeenCalled();
    expect(() => a.capture('landing_viewed')).not.toThrow();
  });
});
```

`sentry-lazy.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
const S = vi.hoisted(() => ({ init: vi.fn(), captureException: vi.fn(), setTag: vi.fn() }));
vi.mock('@sentry/react', () => ({
  init: S.init, captureException: S.captureException, getCurrentScope: () => ({ setTag: S.setTag }),
}));
async function load(dsn: string) {
  vi.resetModules();
  vi.stubEnv('VITE_SENTRY_DSN', dsn);
  return import('../sentry');
}
afterEach(() => { vi.unstubAllEnvs(); for (const f of Object.values(S)) f.mockReset(); });
describe('sentry — loaded only with a DSN, errors buffered until it arrives', () => {
  it('without a DSN it is fully inert', async () => {
    const s = await load('');
    s.initSentry(); s.reportError(new Error('x')); s.setCorrelation('j1');
    await vi.dynamicImportSettled();
    expect(S.init).not.toHaveBeenCalled();
    expect(S.captureException).not.toHaveBeenCalled();
  });
  it('flushes at most 20 buffered errors and the last correlation id on load', async () => {
    const s = await load('https://k@o.ingest/1');
    s.initSentry();
    for (let i = 0; i < 25; i++) s.reportError(new Error(`e${i}`));
    s.setCorrelation('job-9');
    await vi.dynamicImportSettled();
    expect(S.init).toHaveBeenCalledTimes(1);
    expect(S.captureException).toHaveBeenCalledTimes(20);
    expect(S.setTag).toHaveBeenCalledWith('correlation_id', 'job-9');
    s.reportError(new Error('late'));
    expect(S.captureException).toHaveBeenCalledTimes(21);
  });
});
```

`search-params.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { optionalString } from '../search-params';
describe('optionalString', () => {
  const next = optionalString('next');
  it('keeps a string', () => { expect(next({ next: '/pricing' })).toEqual({ next: '/pricing' }); });
  it('omits the key entirely when absent (exactOptionalPropertyTypes)', () => { expect(next({})).toEqual({}); });
  it('drops non-strings instead of coercing them', () => {
    expect(next({ next: 5 })).toEqual({});
    expect(next({ next: ['/a'] })).toEqual({});
  });
});
```

- [ ] **Step 2 — RED. Step 3 — implement.** `analytics.ts` (the `EventName` union is unchanged):

```ts
type PostHog = typeof import('posthog-js').default;
const KEY = import.meta.env['VITE_POSTHOG_KEY'] as string | undefined;
const MAX_QUEUE = 50;
let client: PostHog | null = null;
let loading = false;
let dead = false;
const queue: Array<(p: PostHog) => void> = [];
function run(fn: (p: PostHog) => void): void {
  if (!KEY || dead) return;
  if (client) fn(client);
  else if (queue.length < MAX_QUEUE) queue.push(fn);
}
export function initAnalytics(): void {
  if (!KEY || loading || client || dead) return;
  loading = true;
  void import('posthog-js')
    .then(({ default: posthog }) => {
      posthog.init(KEY, { api_host: 'https://eu.i.posthog.com', autocapture: false, capture_pageview: true, persistence: 'localStorage' });
      client = posthog;
      for (const fn of queue.splice(0)) fn(posthog);
    })
    .catch(() => { dead = true; queue.length = 0; });
}
export function identifyUser(userId: string | null): void {
  run((p) => { if (userId) p.identify(userId); else p.reset(); });
}
export function capture(event: EventName, props?: Record<string, unknown>): void {
  run((p) => { p.capture(event, props); });
}
```

`sentry.ts`:

```ts
type SentrySdk = typeof import('@sentry/react');
const DSN = import.meta.env['VITE_SENTRY_DSN'] as string | undefined;
const MAX_BUFFER = 20;
let sdk: SentrySdk | null = null;
let loading = false;
const buffer: unknown[] = [];
let pendingCorrelation: string | null | undefined;
export function initSentry(): void {
  if (!DSN || loading || sdk) return;
  loading = true;
  void import('@sentry/react')
    .then((S) => {
      S.init({ dsn: DSN, environment: import.meta.env.MODE, tracesSampleRate: 0 });
      sdk = S;
      if (pendingCorrelation !== undefined) S.getCurrentScope().setTag('correlation_id', pendingCorrelation ?? undefined);
      for (const e of buffer.splice(0)) S.captureException(e);
    })
    .catch(() => { buffer.length = 0; });
}
export function reportError(err: unknown): void {
  if (!DSN) return;
  if (sdk) sdk.captureException(err);
  else if (buffer.length < MAX_BUFFER) buffer.push(err);
}
export function setCorrelation(id: string | null): void {
  if (!DSN) return;
  if (sdk) sdk.getCurrentScope().setTag('correlation_id', id ?? undefined);
  else pendingCorrelation = id;
}
```

`AppErrorBoundary`: a class component — `static getDerivedStateFromError() { return { failed: true }; }`, `override componentDidCatch(error: unknown) { reportError(error); }`, renders `fallback` when failed; `main.tsx` swaps `<Sentry.ErrorBoundary fallback=…>` for `<AppErrorBoundary fallback={<AppCrashFallback />}>`. `search-params.ts`: `export function optionalString<K extends string>(key: K) { return (raw: Record<string, unknown>): { [P in K]?: string } => (typeof raw[key] === 'string' ? ({ [key]: raw[key] } as { [P in K]?: string }) : {}); }`; the four routes use `validateSearch: optionalString('next')` / `optionalString('token')` (`register.tsx`'s `safeNext` is untouched). Move the page components (pure moves; tests follow the new import paths). `index.html`: `<link rel="preload" href="/fonts/syne-variable-latin.woff2" as="font" type="font/woff2" crossorigin />`. `check-bundle-size.mjs`: read `dist/index.html`, take the `src` of the `<script type="module">`, `statSync` it and `gzipSync(readFileSync(…)).length`; fail (exit 1, printing both numbers) above `400_000` raw or `130_000` gz. `npm uninstall zod recharts wavesurfer.js ai` (first `grep -rn "from 'zod'\|recharts\|wavesurfer\|from 'ai'" src` must print nothing but comments). README `:49` — drop "WaveSurfer, Recharts"; `:63` — replace the fairness sentence with: "**Coach chat has its own worker pool.** Four named queues (no `default`), tier-routed at dispatch; in production the coach queue runs in a separate process so a chat reply never sits behind a multi-minute analysis. On the single-VM deployment the analysis lanes share one pool. An enforcement test fails the build if any actor or enqueue site targets a nonexistent queue."
- [ ] **Step 4 — GREEN + ALL gates + `npm run lint:bundle`.** Report the entry size before/after (raw + gz) and the top contributors if still over budget — do NOT raise the limits; escalate. **Live (spec §4.10):** Lighthouse mobile on `vite preview` before/after; the app still boots, login works, a results page loads (lazy SDKs with no keys are inert).
- [ ] **Step 5 — commit** `perf(web): observability SDKs load on demand; zod and three unused packages leave the bundle`.

---

### Task P9: Small hardening

**Files**
- Modify: `infra/Caddyfile:45-53`, `infra/compose.prod.yml` (`bff` service), `FE/src/api/types.ts:1262-1268`, `FE/src/features/results/LlmDegradationNotice.tsx:18-31`, `FE/src/features/results/ReportView.tsx:115-118,461-464` (file is 726 lines — add ≤ 6), `FE/src/api/hooks.ts:629-635` (use the shared constants)
- Create: `FE/src/api/verdict-polling.ts`, `FE/src/api/__tests__/verdict-polling.test.tsx`

**Interfaces**
- Produces: `TRIAGE_POLL_MS = 3000`, `TRIAGE_MAX_POLLS = 25`, `isTriagePending(d: VerdictsListResponse | undefined): boolean`, `useTriageTimedOut(d: VerdictsListResponse | undefined): boolean`, `TRIAGE_TIMEOUT_NOTICE: DegradationNoticeDto`; `DegradationReason` gains client-only `'triage_timeout'`.

- [ ] **Step 1 — failing test:**

```tsx
// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VerdictsListResponse } from '../types';
import { TRIAGE_MAX_POLLS, TRIAGE_POLL_MS, isTriagePending, useTriageTimedOut } from '../verdict-polling';
const base = { verdicts: [], routingPlan: null, degradation: null } as unknown as VerdictsListResponse;
const BUDGET = TRIAGE_MAX_POLLS * TRIAGE_POLL_MS + 5_000;
describe('triage wait is bounded', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  it('pending = a loaded response with neither a plan nor a degradation', () => {
    expect(isTriagePending(undefined)).toBe(false);
    expect(isTriagePending(base)).toBe(true);
    expect(isTriagePending({ ...base, routingPlan: { specialistsToRun: [] } } as never)).toBe(false);
  });
  it('flips true only after the whole poll budget, not a millisecond earlier', () => {
    const { result } = renderHook(() => useTriageTimedOut(base));
    act(() => { vi.advanceTimersByTime(BUDGET - 1); });
    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe(true);
  });
  it('a plan that lands resets it', () => {
    const { result, rerender } = renderHook(({ d }) => useTriageTimedOut(d), { initialProps: { d: base } });
    act(() => { vi.advanceTimersByTime(BUDGET); });
    expect(result.current).toBe(true);
    rerender({ d: { ...base, routingPlan: { specialistsToRun: [] } } as never });
    expect(result.current).toBe(false);
  });
});
```

- [ ] **Step 2 — RED. Step 3 — implement** `verdict-polling.ts`:

```ts
import { useEffect, useState } from 'react';
import type { DegradationNoticeDto, VerdictsListResponse } from './types';
export const TRIAGE_POLL_MS = 3000;
export const TRIAGE_MAX_POLLS = 25;
export const TRIAGE_TIMEOUT_NOTICE: DegradationNoticeDto = {
  reason: 'triage_timeout', detail: null, occurredAt: new Date(0).toISOString(),
};
export function isTriagePending(d: VerdictsListResponse | undefined): boolean {
  return d != null && d.routingPlan == null && d.degradation == null;
}
/** A TIMER, not a poll counter: ReportView reads only `data`, and structurally
 *  identical polls do not re-render it — a counter would never be observed. */
export function useTriageTimedOut(d: VerdictsListResponse | undefined): boolean {
  const pending = isTriagePending(d);
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (!pending) { setTimedOut(false); return undefined; }
    const t = setTimeout(() => setTimedOut(true), TRIAGE_MAX_POLLS * TRIAGE_POLL_MS + 5_000);
    return () => clearTimeout(t);
  }, [pending]);
  return pending && timedOut;
}
```

`hooks.ts`: replace the literals `3000`/`25` in the triage branch with the constants and `isTriagePending(d)`. `types.ts`: add `| 'triage_timeout'` with the comment "client-synthesised (verdict-polling.ts); never on the wire". `LlmDegradationNotice.copyFor`: `case 'triage_timeout': return 'AI specialists are taking longer than expected — showing rule-based findings for now. Reload the page to check again.';` (+ one assertion in its existing test file). `ReportView`: `const triageTimedOut = useTriageTimedOut(verdictsData);` and, next to the existing notice, `{!verdictsData?.degradation && triageTimedOut && <LlmDegradationNotice notice={TRIAGE_TIMEOUT_NOTICE} />}`.
  Caddy — replace the final `handle { … }` with two blocks (a missing hashed asset must be a real 404, and HTML must never be cached):

```
	handle /assets/* {
		root * /srv
		header Cache-Control "public, max-age=31536000, immutable"
		file_server
	}
	handle {
		root * /srv
		@static path /fonts/* /favicon.svg /og-share.png /coach.png /robots.txt /sitemap.xml
		header @static Cache-Control "public, max-age=86400"
		@html not path /fonts/* /favicon.svg /og-share.png /coach.png /robots.txt /sitemap.xml
		header @html Cache-Control "no-cache"
		try_files {path} /index.html
		file_server
	}
```

  Compose `bff`: `healthcheck: { test: ["CMD", "curl", "-fsS", "--max-time", "3", "http://localhost:5000/healthz"], interval: 30s, timeout: 5s, retries: 3, start_period: 40s }` (curl is already relied on by `infra/deploy.sh:45`). Do NOT add a `depends_on` from `caddy` (spec D14).
- [ ] **Step 4 — GREEN + ALL gates.** **Validate the edge:** `docker run --rm -e SPECTR_DOMAIN=localhost -v "<worktree>/infra/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2 caddy validate --config /etc/caddy/Caddyfile` (resolve `docker.exe` explicitly on this machine) → "Valid configuration". If Docker is unavailable say so plainly in the report; the controller validates before deploy. `docker compose -f infra/compose.prod.yml config -q` needs the env file — skip it, review the YAML by eye.
- [ ] **Step 5 — commit** `fix(edge): hashed assets 404 for real, HTML is never cached; the triage wait is bounded`.

---

### Task P10: Public smoke in CI (desktop + phone, no backend)

**Files**
- Create: `FE/playwright.public.config.ts`, `FE/playwright-public/public-smoke.spec.ts`
- Modify: `FE/package.json` (`"test:public": "playwright test -c playwright.public.config.ts"`), `.github/workflows/ci.yml` (job `public-smoke`; `deploy.needs` gains it), `FE/tsconfig*.json`/eslint ignore only if the new folder is not already covered the way `playwright/` is

- [ ] **Step 1 — write the config and spec:**

```ts
// playwright.public.config.ts
import { defineConfig, devices } from '@playwright/test';
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
```

```ts
// playwright-public/public-smoke.spec.ts
import { expect, test } from '@playwright/test';
const PAGES = ['/', '/analyze', '/pricing', '/trust/no-training', '/trust/results-forever',
  '/trust/privacy', '/trust/how-its-built', '/login', '/register'];
for (const path of PAGES) {
  test(`${path} renders, throws nothing, and fits the viewport`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(path);
    await expect(page.locator('h1').first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
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
```

- [ ] **Step 2 — run it locally, foreground:** `npm run build && npx playwright install chromium && npm run test:public`. A failing page is a REAL bug — fix the page (e.g. a missing `h1`, an overflowing element), never loosen the assertion; report each fix.
- [ ] **Step 3 — CI job** `public-smoke` in `.github/workflows/ci.yml`, directly after `frontend:` — same `runs-on`, `timeout-minutes: 15`, `needs: [frontend]`, the same `defaults.run.working-directory` and the same checkout + `setup-node@v5` (node 22, npm cache) steps as the `frontend` job, then four run steps: `npm ci`, `npx vite build`, `npx playwright install --with-deps chromium`, `npx playwright test -c playwright.public.config.ts`; and `deploy.needs: [secrets, bff, frontend, python, public-smoke]`.
- [ ] **Step 4 — ALL gates** (the main `playwright.config.ts` `testDir` is `./playwright`, so the two suites never pick up each other's specs — confirm with `npx playwright test --list` for both configs). **Step 5 — commit** `test(ci): a backend-free public smoke on desktop and phone gates every deploy`.

---

## Self-review

### Spec decision → task

| Spec | Where |
|---|---|
| D1 order / D9-dependency | Global Constraints "Order"; P3 header |
| D2 product voice, repo link on one page, no badge image | P3 footer test ("no byline, no repo link"), P4 test (`SITE.repoUrl`, no `<img … github`) |
| D3 URL, thin route, TrustPage props, Caddy short link | P4 |
| D4 only provable claims | P4 tests ("starve", "SHA-pinned"), P7 README fix |
| D5 floors + recount | P4 `site-stats.mjs` + `site-stats.test.ts` |
| D6 `creditsEnabled`, hidden by default, provider-free | P2 (`PublicCredits`, `public-plans.ts`, `PricingLink`) |
| D7 four `/pricing` states + shell copy | P2 (`pricing-states.test.tsx`, `PublicSiteShellTests`) |
| D8 CTA, chrome, footer | P3 |
| D9 plain-language sample + pinning | P5 |
| D10 404 / error / stale chunk / crash fallback | P1 |
| D11 meta, sitemap, robots, parity, trust copy | P6 |
| D12 bundle diet + budget script + README | P7 |
| D13 phone rules | P8 |
| D14 Caddy, bounded triage, bff healthcheck (no edge gate) | P9 |
| D15 public smoke | P10 |
| D16 copy guardrails | Global Constraints; P4 banned-phrase test; P2 no-asterisk assertion |
| §4 live checks | each task's "Live" step |

### Names and types across tasks

- `reportError(err: unknown): void` — introduced P1 (static SDK), re-implemented P7 (lazy); callers (`RouteErrorScreen`, `AppErrorBoundary`) never change.
- `Sentry` re-export from `lib/sentry.ts` is removed in P7; its only consumer is `main.tsx:10,75` (P7 edits it). `setCorrelation` keeps its signature (`songs.$songId.results.$jobId.tsx:9`).
- `loadPublicPlans` / `resetPublicPlansForTests` / `useCreditsEnabled` / `PricingLink` — P2; consumed unchanged by P3 (`PublicChrome`, `PublicFooter`) and P10 (hidden-by-default assertion).
- `PlansResponse.creditsEnabled?: boolean | null` (TS) ↔ `bool? CreditsEnabled` (C#, camel-cased by the default JSON policy).
- `PricingPlansView` props `{ plans, pending, onCheckout, … }` — P2 defines; P3 edits only its footer paragraph.
- `TRUST_PAGES` — moved in P3 to `features/trust/trust-pages.ts`, re-exported from `TrustPage.tsx`; P4 widens `TrustPage`'s `path` to `string` and adds `eyebrow?`/`updated?` — existing three callers keep compiling (they pass `updated`).
- `usePageMeta(title, description?, opts?)` — third parameter optional; every pre-P6 caller compiles unchanged. `NotFoundScreen` (P1) gains `{ noindex: true }` in P6 — P1's title assertion still holds.
- `EventName` additions: `'demo_cta_clicked'` (P3, only if sibling D9 has not added it), `'engineering_viewed'` (P4). P7 rewrites `analytics.ts` internals and must carry both.
- Route-file moves: `routes/pricing.tsx` (P2) and the trust/kitchen-sink components (P7) — after P7 no file under `src/routes/` exports a page component; the guard's `ALLOWED_ROUTE_FILES` gains exactly one entry in the whole workstream (P4).
- `DegradationReason | 'triage_timeout'` (P9) is exhaustively handled by `copyFor`'s new case; the `default` branch stays for unknown wire strings.
- Ports: dev/e2e 5174 (existing), public smoke 4174 (P10) — no clash when both servers run.
