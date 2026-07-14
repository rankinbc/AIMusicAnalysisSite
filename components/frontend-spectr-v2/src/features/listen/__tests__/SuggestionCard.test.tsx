import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { SuggestionDto } from '../../../api/types';
import { SuggestionCard, type SuggestionAuditionSeam } from '../SuggestionCard';

function sg(over: Partial<SuggestionDto>): SuggestionDto {
  return {
    id: 's1',
    songVersionId: 'v1',
    fromActor: { type: 'user', userId: 'u', handle: 'vela', displayName: null, hue: 220 },
    chain: { order: ['eq', 'glue_compressor'], modules: {}, masterBypass: false },
    commentId: null,
    createdInSessionId: null,
    status: 'proposed',
    createdAt: '2026-06-28T00:00:00Z',
    ...over,
  };
}

function render(suggestion: SuggestionDto, isOwner: boolean, audition?: SuggestionAuditionSeam) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <SuggestionCard suggestion={suggestion} versionId="v1" isOwner={isOwner} {...(audition ? { audition } : {})} />
    </QueryClientProvider>,
  );
}

function seam(over: Partial<SuggestionAuditionSeam> = {}): SuggestionAuditionSeam {
  return { activeId: null, onAudition: () => {}, onRevert: () => {}, disabled: false, ...over };
}

describe('SuggestionCard (story 11.2)', () => {
  it('renders the chain summary, proposer, and status', () => {
    const html = render(sg({}), false);
    expect(html).toContain('@vela');
    expect(html).toContain('Eq');
    expect(html).toContain('Glue Compressor');
    expect(html).toContain('proposed');
  });

  it('shows Accept/Reject to the owner on an open suggestion', () => {
    const html = render(sg({ status: 'proposed' }), true);
    expect(html).toContain('Accept');
    expect(html).toContain('Reject');
  });

  it('hides Accept/Reject from a non-owner', () => {
    const html = render(sg({ status: 'proposed' }), false);
    expect(html).not.toContain('Accept');
    expect(html).not.toContain('Reject');
  });

  it('hides actions once the suggestion is terminal (accepted/rejected), even for the owner', () => {
    const html = render(sg({ status: 'accepted' }), true);
    expect(html).toContain('accepted');
    expect(html).not.toContain('Reject');
  });

  it('renders the rejected state read-only (label shown, no actions even for the owner)', () => {
    const html = render(sg({ status: 'rejected' }), true);
    expect(html).toContain('rejected');
    expect(html).not.toContain('Accept');
    expect(html).not.toContain('Reject');
  });

  it('renders room provenance when proposed in a session', () => {
    const html = render(sg({ createdInSessionId: 'sess-1' }), false);
    expect(html).toContain('proposed live in a room');
  });
});

describe('SuggestionCard — audition + moves (story 11.12)', () => {
  it('shows the Audition button only when the seam is provided', () => {
    expect(render(sg({}), false, seam())).toContain('Audition');
    expect(render(sg({}), false)).not.toContain('Audition');
  });

  it('disables Audition while fork-to-suggest is engaged', () => {
    const html = render(sg({}), false, seam({ disabled: true }));
    expect(html).toMatch(/<button[^>]*disabled[^>]*>▶ Audition<\/button>/);
    expect(html).toContain('Finish your suggestion first');
  });

  it('swaps to Revert while this suggestion is auditioning', () => {
    const html = render(sg({ id: 's1' }), false, seam({ activeId: 's1' }));
    expect(html).toContain('Revert audition');
    expect(html).not.toContain('▶ Audition');
  });

  it('renders the moves expander for a chain with real moves, collapsed by default', () => {
    const chain = {
      order: ['eq', 'trim'],
      modules: {
        eq: { enabled: true, bands: [{ type: 'peaking', freq: 120, gainDb: -2.1, q: 1.4, enabled: true }] },
        trim: { enabled: true, gainDb: 1 },
      },
      masterBypass: false,
    };
    const html = render(sg({ chain }), false);
    expect(html).toContain('show moves (2)');
    expect(html).not.toContain('cut 2.1 dB'); // collapsed
  });

  it('hides the expander when the chain yields no moves', () => {
    expect(render(sg({}), false)).not.toContain('show moves');
  });
});
