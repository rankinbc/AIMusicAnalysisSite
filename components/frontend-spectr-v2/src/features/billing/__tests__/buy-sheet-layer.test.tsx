// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { onGuestUpgrade } from '../../demo/guest-upgrade-bus';
import { SpecialistTeamModal } from '../../results/SpecialistTeamModal';
import { BuyCreditsProvider, useBuyCredits } from '../BuyCreditsProvider';

// The buy-credits sheet must ALWAYS be the front-most modal (owner rule,
// 2026-10-01): it used the form-dialog z 50/51 and opened behind the
// Specialist Team modal (z 80), AnalysisCompleteModal (1000), etc.

const auth = vi.hoisted(() => ({ isGuest: false }));
vi.mock('../../../auth/AuthContext', () => ({
  useOptionalAuth: () => ({ user: { id: 'u1', isGuest: auth.isGuest } }),
}));
vi.mock('../../../api/hooks', () => ({
  usePlans: () => ({
    data: {
      creditsEnabled: true,
      creditPacks: [{ credits: 500, cents: 500 }],
      currency: 'USD',
      proMonthlyCents: 1200,
      proAnnualCents: 12000,
      costs: {
        analysis: 100, specialist: 15, coachMessage: 5, coachMix: 5,
        signupGrant: 500, proAnalysesMonthly: 15, proCoachMonthly: 300,
      },
    },
  }),
  // Guests come back as tier "free" / balance 0 from the BFF — the exact
  // shape that used to price the action and open the buy sheet.
  useEntitlements: () => ({ data: { tier: 'free', creditBalance: 0, creditsEnabled: true } }),
}));
vi.mock('../useUpgradeCheckout', () => ({ useUpgradeCheckout: () => ({ start: vi.fn(), pending: null }) }));

const SRC = resolve(__dirname, '../../..');
const tokensCss = readFileSync(join(SRC, 'styles/tokens.css'), 'utf8');
const formsCss = readFileSync(join(SRC, 'styles/forms.module.css'), 'utf8');

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? cssFiles(join(dir, e.name))
      : e.name.endsWith('.css')
        ? [join(dir, e.name)]
        : [],
  );
}

function zPurchase(): number {
  const m = /--z-purchase:\s*(\d+)/.exec(tokensCss);
  if (!m) throw new Error('--z-purchase token missing');
  return Number(m[1]);
}

const onRun = vi.fn();
function renderRoster() {
  return render(
    <BuyCreditsProvider>
      {/* ReportView's `.rdx` wrapper — the sheet must NOT render inside it. */}
      <div className="rdx" data-testid="rdx">
        <SpecialistTeamModal
          ranSlugs={new Set()}
          runningSlugs={new Set()}
          foundBySlug={new Map()}
          hasStems={false}
          credits={0}
          onRun={onRun}
          onClose={vi.fn()}
        />
      </div>
    </BuyCreditsProvider>,
  );
}

function clickRunOnLowEnd() {
  fireEvent.click(screen.getByRole('button', { name: /Low End/ }));
  fireEvent.click(screen.getByRole('button', { name: /^Run/ }));
}

beforeEach(() => {
  auth.isGuest = false;
  onRun.mockReset();
});
afterEach(cleanup);

describe('z-index layers', () => {
  it('--z-purchase is above every other z token', () => {
    const top = zPurchase();
    const others = [...tokensCss.matchAll(/--z-([a-z-]+):\s*(\d+)/g)]
      .filter((m) => m[1] !== 'purchase')
      .map((m) => Number(m[2]));
    expect(others.length).toBeGreaterThan(0);
    for (const z of others) expect(z).toBeLessThan(top);
  });

  it('no stylesheet in the app uses a literal z-index at or above the purchase layer', () => {
    const top = zPurchase();
    const offenders: string[] = [];
    const files = cssFiles(SRC);
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      const css = readFileSync(file, 'utf8');
      for (const m of css.matchAll(/z-index\s*:\s*(\d+)/g)) {
        if (Number(m[1]) >= top) offenders.push(`${file}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the topLayer modifier puts overlay + content on --z-purchase', () => {
    expect(formsCss).toMatch(/\.dialogOverlay\.topLayer\s*\{\s*z-index:\s*var\(--z-purchase\)/);
    expect(formsCss).toMatch(
      /\.dialogContent\.topLayer\s*\{\s*z-index:\s*calc\(var\(--z-purchase\)\s*\+\s*1\)/,
    );
  });
});

describe('buy sheet opened from inside SpecialistTeamModal', () => {
  it('portals to <body>, outside .rdx, on the purchase layer', () => {
    renderRoster();
    clickRunOnLowEnd();
    expect(onRun).not.toHaveBeenCalled();

    const sheet = screen.getByRole('dialog', { name: 'Not enough credits' });
    expect(sheet.getAttribute('data-layer')).toBe('purchase');
    expect(screen.getByTestId('rdx').contains(sheet)).toBe(false);
    // Portal root is a direct child of <body>.
    let node: HTMLElement = sheet;
    while (node.parentElement && node.parentElement !== document.body) node = node.parentElement;
    expect(node.parentElement).toBe(document.body);
    const overlay = document.querySelector('[data-layer="purchase"]:not([role])');
    expect(overlay?.parentElement?.contains(sheet)).toBe(true);
  });

  it('Esc closes only the sheet — the Specialist Team modal stays open', () => {
    renderRoster();
    clickRunOnLowEnd();
    expect(screen.getByRole('dialog', { name: 'Not enough credits' })).toBeTruthy();

    act(() => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    });

    expect(screen.queryByRole('dialog', { name: 'Not enough credits' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Specialist Team', hidden: true })).toBeTruthy();
  });

  it('focus is trapped in the sheet while both are open', () => {
    renderRoster();
    clickRunOnLowEnd();
    const sheet = screen.getByRole('dialog', { name: 'Not enough credits' });
    expect(sheet.contains(document.activeElement)).toBe(true);
  });
});

describe('guests (never charged, never granted credits)', () => {
  it('shows no cost tags and runs the specialist directly', () => {
    auth.isGuest = true;
    renderRoster();
    expect(screen.queryByText('15 ◆')).toBeNull();
    clickRunOnLowEnd();
    expect(onRun).toHaveBeenCalledWith('low_end');
    expect(screen.queryByRole('dialog', { name: 'Not enough credits' })).toBeNull();
  });

  it('a real non-paying user still sees the price', () => {
    renderRoster();
    expect(screen.getAllByText('15 ◆').length).toBeGreaterThan(0);
  });

  it('a guest reaching the buy sheet gets the guest upgrade prompt instead', () => {
    auth.isGuest = true;
    const seen = vi.fn();
    const off = onGuestUpgrade(seen);
    // Drive open() directly (as the 402 handlers in useSpecialistRuns /
    // useFixRackGeneration / useCoachSession do): the provider itself must
    // refuse a checkout for a guest.
    function Opener() {
      const { open } = useBuyCredits();
      return (
        <button type="button" onClick={() => open({ title: 'Not enough credits' })}>
          open
        </button>
      );
    }
    render(
      <BuyCreditsProvider>
        <Opener />
      </BuyCreditsProvider>,
    );
    fireEvent.click(screen.getByText('open'));
    off();
    expect(seen).toHaveBeenCalledWith('not_allowed', expect.stringMatching(/create a free account/));
    expect(screen.queryByRole('dialog', { name: 'Not enough credits' })).toBeNull();
  });
});
