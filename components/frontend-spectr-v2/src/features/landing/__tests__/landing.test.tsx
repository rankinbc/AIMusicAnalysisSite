import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AuthContext } from '../../../auth/AuthContext';
import type { AuthedUser } from '../../../api/types';
import { PublicChrome } from '../../../components/PublicChrome';
import { PricingPlansView } from '../../pricing/PricingPlansView';
import { COACH_LINE, HERO_FINDING, HERO_FIX } from '../LandingHero';
import { HERO_LISTEN } from '../hero-content';
import { describeOp } from '../sample/sample-model';
import type { VerdictDspOp } from '../../../api/types';
import { LandingPage } from '../LandingPage';
import { SAMPLE_FINDINGS } from '../sample/sample-data';

// Story 6.1 — static renders (the 6-1 idiom: plain <a> anchors so no
// RouterProvider is needed; effects don't run, so no fetch fires).

describe('PublicChrome (story 6.1 AC3 — UX-DR6 slim chrome)', () => {
  it('renders brand + Pricing + Sign in + Analyze free with correct hrefs (anon variant)', () => {
    // No AuthProvider → useOptionalAuth() is null → anon chrome.
    const html = renderToStaticMarkup(<PublicChrome />);
    expect(html).toContain('href="/"');
    // Task P2 (D6) — PricingLink is hidden until the server answers, and
    // effects never run under renderToStaticMarkup, so no fetch fires and
    // the link never appears.
    expect(html).not.toContain('href="/pricing"');
    expect(html).toContain('href="/login"');
    expect(html).toContain('href="/analyze"'); // 6.3 — CTA targets the anon funnel
    expect(html).toContain('Analyze free');
    expect(html).not.toContain('Open library');
    expect(html).toContain('SPEC'); // wordmark
    // Task P3 — the engineering link in the chrome (hidden below 480px via CSS).
    expect(html).toContain('href="/trust/how-its-built"');
  });

  it('swaps to "Open library" for an authed user (no register dead-end mid-upgrade)', () => {
    const user: AuthedUser = { id: 'u1', email: 'a@b', displayName: null, tier: 'free' };
    const value = { user, accessToken: 't', isLoading: false } as never;
    const html = renderToStaticMarkup(
      <AuthContext.Provider value={value}>
        <PublicChrome />
      </AuthContext.Provider>,
    );
    expect(html).toContain('Open library');
    expect(html).toContain('href="/library"');
    expect(html).not.toContain('href="/register"');
    expect(html).not.toContain('Sign in');
  });
});

describe('LandingPage (story 6.1 AC1)', () => {
  const html = renderToStaticMarkup(<LandingPage />);

  it('renders the primary CTA with the exact FR40 label', () => {
    expect(html).toContain('data-testid="landing-cta"');
    expect(html).toContain('Analyze my track free');
  });

  it('renders chrome, honesty strip, and footer links — no sample report embed', () => {
    // Task P2 (D6) — same as above: PricingLink never resolves under
    // renderToStaticMarkup, so the footer link is hidden too.
    expect(html).not.toContain('href="/pricing"');
    expect(html).not.toContain('Live sample report');
    expect(html).toContain('No AI training on your audio');
    expect(html).toContain('Reports stay yours forever');
    expect(html).toContain('href="/login"');
  });

  it('replaces the pricing CTA with a link to the guest demo (task P3)', () => {
    expect(html).toContain('data-testid="landing-demo-cta"');
    expect(html).toContain('href="/demo"');
    expect(html).toContain('Explore the demo');
    expect(html).not.toContain('See pricing');
    expect((html.match(/href="\/demo"/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it('gives the demo its own highlighted callout explaining what it is', () => {
    expect(html).toContain('No track handy?');
    expect(html).toContain('real sample analysis');
    expect(html).toContain('findings, fix plan, AI coach and the Listen rack');
    expect(html).toContain('No signup.');
    // The primary upload CTA still comes first.
    expect(html.indexOf('data-testid="landing-cta"')).toBeLessThan(html.indexOf('data-testid="landing-demo-cta"'));
  });
});

describe('Landing hero (two-column redesign + the Coach)', () => {
  const html = renderToStaticMarkup(<LandingPage />);

  it('renders exactly one h1 with the headline', () => {
    expect((html.match(/<h1[\s>]/g) ?? []).length).toBe(1);
    expect(html).toContain('wrong with your mix. Fix it.');
  });

  it('points the primary CTA at /analyze and the demo CTA at /demo', () => {
    expect(html).toMatch(/<a href="\/analyze"[^>]*data-testid="landing-cta"/);
    expect(html).toMatch(/<a href="\/demo"[^>]*data-testid="landing-demo-cta"/);
  });

  it('introduces the Coach with his line as real text and a decorative avatar', () => {
    expect(COACH_LINE).toBe("I'm the Coach. I'll help you get your mix where you want it to be.");
    expect(html).toContain('data-testid="landing-coach"');
    // Static markup escapes the apostrophes.
    expect(html).toContain('the Coach. I&#x27;ll help you get your mix where you want it to be.');
    expect(html).toMatch(/aria-hidden="true"><svg[^>]*aria-label="The Coach"/);
    // Truthful framing: the coach reasons over the report, he does not "hear" audio.
    expect(html).toContain('Reads your report');
  });

  it('shows a finding that matches the real sample report fixture', () => {
    const first = SAMPLE_FINDINGS[0];
    expect(first).toBeDefined();
    if (!first) return;
    expect(HERO_FINDING.headline).toBe(first.verdict.headline);
    expect(HERO_FINDING.severity).toBe(first.verdict.severity);
    expect(first.verdict.summary).toContain('-18.3 dBFS');
    expect(first.verdict.summary).toContain('12 dB louder than bass band');
    expect(first.corroboratedBy.map((c) => c.headline)).toContain(HERO_FINDING.alsoFlagged);
    expect(html).toContain(HERO_FINDING.headline);
    // Evidence bars use the verdict's real first two evidence rows.
    const ev = first.verdict.evidence as { value: number; expected_range: [number, number] }[];
    HERO_FINDING.evidence.forEach((e, i) => {
      expect(e.value).toBeCloseTo(ev[i]!.value, 1);
      expect([...e.range]).toEqual(ev[i]!.expected_range);
    });
  });

  it('alternates the finding with the real suggested fix for it', () => {
    const fix = SAMPLE_FINDINGS[0]?.verdict.fix as
      | { dsp_chain: VerdictDspOp[]; expected_outcome: string; ableton_hint?: { device?: string } }
      | null
      | undefined;
    expect(fix).toBeTruthy();
    if (!fix) return;
    expect([...HERO_FIX.steps]).toEqual(fix.dsp_chain.map(describeOp));
    expect(HERO_FIX.outcome).toBe(fix.expected_outcome);
    expect(HERO_FIX.device).toBe(fix.ableton_hint?.device);
    // Both faces are server-rendered (no layout jump, crawlers see both).
    for (const step of HERO_FIX.steps) expect(html).toContain(step);
    expect(html).toContain('The fix');
  });
});

describe('Landing hero — "Hear it" face (Listen rack + presets)', () => {
  const html = renderToStaticMarkup(<LandingPage />);

  it('stacks real suggested fixes from the sample report into one preset', () => {
    expect(HERO_LISTEN.fixes.length).toBeGreaterThanOrEqual(2);
    for (const f of HERO_LISTEN.fixes) {
      const match = SAMPLE_FINDINGS.find((x) => x.verdict.headline === f.headline);
      expect(match, f.headline).toBeDefined();
      const fix = match?.verdict.fix as { dsp_chain: VerdictDspOp[]; ableton_hint?: { device?: string } } | null;
      expect(fix?.dsp_chain.length).toBeGreaterThan(0);
      expect(fix?.ableton_hint?.device).toBe(f.device);
    }
  });

  it('renders the third tab and its copy server-side', () => {
    expect(html).toContain('Hear it');
    expect(html).toContain('Listen rack');
    expect(html).toContain('them into a preset, and A/B it');
    expect(html).toContain(HERO_LISTEN.preset);
    expect((html.match(/role="tab"/g) ?? []).length).toBe(3);
  });
});

describe('PricingPlansView (story 6.1 AC2 — UX-DR25 polish)', () => {
  // Task P2 (D7) — PricingPage itself resolves to the loading state under
  // static render (no fetch ever settles); these assertions exercise the
  // "credits on" view directly, the same way PricingPage renders it once
  // loadPublicPlans() answers true.
  const html = renderToStaticMarkup(
    <PricingPlansView plans={null} pending={null} onCheckout={() => {}} />,
  );

  it('states tax honesty up front and restates terms at the buttons', () => {
    expect(html).toContain('Tax is calculated and shown at checkout');
    expect(html).toContain('Monthly renews monthly');
    expect(html).toContain('cancel anytime in two clicks');
    expect(html).toContain('One-time purchase · credits never expire');
  });

  it('keeps the honest header and renders the slim chrome', () => {
    expect(html).toContain('Honest billing. No asterisks.');
    expect(html).toContain('Analyze free'); // PublicChrome CTA
    expect(html).not.toContain('*'); // no asterisks, literally
  });
});
