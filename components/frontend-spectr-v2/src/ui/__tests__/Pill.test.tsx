import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Pill, Dot, Label } from '../Pill';

// Story 1.7 / UX-DR4 — the React Pill wrapper around the global `.pill`
// class. Tone class must be applied; default tone must NOT add an extra
// class; passthrough props (className, title, children) must be honored.

describe('Pill', () => {
  it('renders the base .pill class with no tone for the default', () => {
    const html = renderToStaticMarkup(<Pill>demo</Pill>);
    expect(html).toMatch(/class="pill"/);
    expect(html).toContain('>demo<');
  });

  it('applies the tone class for non-default tones', () => {
    const html = renderToStaticMarkup(<Pill tone="cyan">x</Pill>);
    expect(html).toMatch(/class="pill cyan"/);
  });

  it.each(['violet', 'orange', 'red', 'green', 'yellow'] as const)(
    'supports the %s tone',
    (tone) => {
      const html = renderToStaticMarkup(<Pill tone={tone}>x</Pill>);
      expect(html).toContain(`class="pill ${tone}"`);
    },
  );

  it('appends the passthrough className', () => {
    const html = renderToStaticMarkup(<Pill tone="cyan" className="extra">x</Pill>);
    expect(html).toMatch(/class="pill cyan extra"/);
  });

  it('honors the title attribute', () => {
    const html = renderToStaticMarkup(<Pill title="why">x</Pill>);
    expect(html).toContain('title="why"');
  });
});

describe('Dot', () => {
  it('renders the base .dot class with no tone for cyan default', () => {
    const html = renderToStaticMarkup(<Dot />);
    expect(html).toMatch(/class="dot"/);
  });

  it('applies the tone class for non-default tones', () => {
    const html = renderToStaticMarkup(<Dot tone="red" />);
    expect(html).toMatch(/class="dot red"/);
  });
});

describe('Label', () => {
  it('renders the base .label class and content', () => {
    const html = renderToStaticMarkup(<Label>SECTION</Label>);
    expect(html).toMatch(/class="label">SECTION</);
  });
});
