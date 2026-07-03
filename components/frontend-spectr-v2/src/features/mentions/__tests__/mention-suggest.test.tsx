/* Story 11.11 AC1/AC4 — static-render coverage for the mention dropdown. */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { MentionSuggestList } from '../MentionSuggestList';
import type { HandleSearchItemDto } from '../useMentionAutocomplete';

const item = (over?: Partial<HandleSearchItemDto>): HandleSearchItemDto => ({
  handle: 'aurora',
  displayName: 'Aurora',
  avatarHue: 168,
  ...over,
});

describe('MentionSuggestList', () => {
  it('renders suggestions with the active row highlighted', () => {
    const html = renderToStaticMarkup(
      <MentionSuggestList
        items={[item(), item({ handle: 'kepler', displayName: null })]}
        activeIndex={1}
        onPick={() => {}}
      />,
    );
    expect(html).toContain('data-testid="mention-suggest"');
    expect(html).toContain('@aurora');
    expect(html).toContain('@kepler');
    // active highlight rides data-active + aria-selected
    expect(html).toContain('data-active="true"');
    expect(html).toContain('aria-selected="true"');
  });

  it('shows the display name only when it differs from the handle', () => {
    const html = renderToStaticMarkup(
      <MentionSuggestList
        items={[item({ handle: 'aurora', displayName: 'aurora' })]}
        activeIndex={0}
        onPick={() => {}}
      />,
    );
    expect(html).toContain('@aurora');
    // only the handle span carries it — no separate name span
    expect((html.match(/aurora/g) ?? []).length).toBe(1);
  });

  it('renders nothing for an empty list', () => {
    expect(renderToStaticMarkup(<MentionSuggestList items={[]} activeIndex={0} onPick={() => {}} />)).toBe('');
  });
});
