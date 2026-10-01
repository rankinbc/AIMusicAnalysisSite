import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ListenSection } from '../ListenSection';

describe('ListenSection (how-it-works "Hear it" tab)', () => {
  const html = renderToStaticMarkup(<ListenSection />);

  it('shows the real Listen page screenshot with dimensions and alt text', () => {
    expect(html).toContain('src="/images/listen-page.png"');
    expect(html).toContain('width="1519"');
    expect(html).toMatch(/alt="The Listen page on the demo track/);
  });

  it('explains auditioning, presets and A/B', () => {
    expect(html).toContain('Hear the fixes before you make them');
    expect(html).toContain('Stack fixes into a preset');
    expect(html).toContain('A/B before you commit');
  });
});
