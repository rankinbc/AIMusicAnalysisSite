import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Story 2.2 review-fix P12 — Task 8.4 requires four assertions on
// CancelDialog: (a) dialog body absent when open=false; (b) two visible
// buttons; (c) reason `<select>` has no `required` attribute; (d) the
// primary `Cancel my subscription` button carries `.btn.primary`.
//
// Radix Dialog renders via React Portal which renderToStaticMarkup
// elides — so we stub `@radix-ui/react-dialog` here to flatten the
// Portal output to inline `<div>`s. The stub also honors the `open`
// prop on Root: it renders children when open, an empty string when
// closed. This is the minimum surface needed to lock the four
// behavioral assertions without pulling in jsdom (CLAUDE.md: vitest
// env=node).

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@radix-ui/react-dialog', () => {
  const Pass = ({ children, ...rest }: { children?: React.ReactNode } & Record<string, unknown>) => (
    <div {...rest}>{children}</div>
  );
  return {
    Root: ({ open, children }: { open: boolean; children?: React.ReactNode }) =>
      open ? <div data-mock-dialog-root>{children}</div> : null,
    Portal: Pass,
    Overlay: Pass,
    Content: Pass,
    Title: Pass,
    Description: Pass,
  };
});

import type * as React from 'react';
import { CancelDialog } from '../CancelDialog';

const noop = () => {};

describe('CancelDialog (story 2.2 / Task 8.4)', () => {
  it('renders nothing visible when open=false (a)', () => {
    const html = renderToStaticMarkup(
      <CancelDialog open={false} onClose={noop} onConfirmed={noop} />,
    );
    // Portal stub returns null for closed Root; the rendered markup
    // therefore contains no dialog content (no buttons, no select).
    expect(html).not.toContain('Cancel my subscription');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<select');
  });

  it('renders exactly two buttons when open=true (b)', () => {
    const html = renderToStaticMarkup(
      <CancelDialog open={true} onClose={noop} onConfirmed={noop} />,
    );
    const buttonOpens = html.match(/<button\b/g) ?? [];
    expect(buttonOpens.length).toBe(2);
    expect(html).toContain('Keep subscription');
    expect(html).toContain('Cancel my subscription');
  });

  it('reason <select> is optional — no required attribute (c)', () => {
    const html = renderToStaticMarkup(
      <CancelDialog open={true} onClose={noop} onConfirmed={noop} />,
    );
    // Capture the opening tag of <select> and verify `required` is
    // absent. `required` may render either as the bare attribute name
    // or as `required=""`; we forbid both forms.
    const selectMatch = html.match(/<select\b[^>]*>/);
    expect(selectMatch, 'CancelDialog must render a <select>').not.toBeNull();
    expect(selectMatch![0]).not.toMatch(/\brequired\b/);
  });

  it('primary "Cancel my subscription" button carries .btn.primary (d)', () => {
    const html = renderToStaticMarkup(
      <CancelDialog open={true} onClose={noop} onConfirmed={noop} />,
    );
    // The primary confirm button is the one whose inner text contains
    // "Cancel my subscription" (or "Cancelling…" during the pending
    // state). Match the full <button>...</button> block so we capture
    // its OWN class attribute rather than picking up an earlier
    // button's class.
    const buttons = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)]
      .map((m) => m[0]);
    const primary = buttons.find((b) =>
      b.includes('Cancel my subscription') || b.includes('Cancelling'),
    );
    expect(primary, 'Cancel my subscription button must be present').toBeDefined();
    const classMatch = primary!.match(/class="([^"]*)"/);
    expect(classMatch, 'primary button must have a class attribute').not.toBeNull();
    const cls = classMatch![1];
    expect(cls).toMatch(/\bbtn\b/);
    expect(cls).toMatch(/\bprimary\b/);
  });
});
