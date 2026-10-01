// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { HeroFindingCard } from '../HeroFindingCard';
import { HERO_FIX } from '../hero-content';

afterEach(cleanup);

describe('HeroFindingCard', () => {
  it('starts on the finding and switches to the fix from its tab', () => {
    render(<HeroFindingCard />);
    const findingTab = screen.getByRole('tab', { name: /Finding/ });
    const fixTab = screen.getByRole('tab', { name: /The fix/ });
    expect(findingTab.getAttribute('aria-selected')).toBe('true');
    const fixFace = screen.getByText(HERO_FIX.steps[0]).closest('[aria-hidden]');
    expect(fixFace?.getAttribute('aria-hidden')).toBe('true');

    fireEvent.click(fixTab);
    expect(fixTab.getAttribute('aria-selected')).toBe('true');
    expect(fixFace?.getAttribute('aria-hidden')).toBe('false');
  });
});
