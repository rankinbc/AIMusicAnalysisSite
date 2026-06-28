import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { SuggestionDto } from '../../../api/types';
import { SuggestionCard } from '../SuggestionCard';

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

function render(suggestion: SuggestionDto, isOwner: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <SuggestionCard suggestion={suggestion} versionId="v1" isOwner={isOwner} />
    </QueryClientProvider>,
  );
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

  it('renders room provenance when proposed in a session', () => {
    const html = render(sg({ createdInSessionId: 'sess-1' }), false);
    expect(html).toContain('proposed live in a room');
  });
});
