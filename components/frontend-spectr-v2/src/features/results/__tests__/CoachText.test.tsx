// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CoachText } from '../CoachText';

afterEach(cleanup);

describe('CoachText', () => {
  it('renders **bold** as <strong> without the asterisks', () => {
    const { container } = render(<CoachText text="The **sub-bass** is hot." />);
    expect(container.textContent).toBe('The sub-bass is hot.');
    expect(container.querySelector('strong')?.textContent).toBe('sub-bass');
  });

  it('handles several bold runs and keeps line breaks in the text', () => {
    const { container } = render(<CoachText text={'**What I found:** a\n\n**Top 3 priorities:**'} />);
    expect(container.querySelectorAll('strong')).toHaveLength(2);
    expect(container.textContent).toBe('What I found: a\n\nTop 3 priorities:');
  });

  it('leaves an unclosed marker as-is (a reply still streaming)', () => {
    const { container } = render(<CoachText text="Cut **50 Hz" />);
    expect(container.querySelector('strong')).toBeNull();
    expect(container.textContent).toBe('Cut **50 Hz');
  });

  it('never interprets HTML in the text', () => {
    const { container } = render(<CoachText text={'<img src=x onerror=alert(1)> **ok**'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
