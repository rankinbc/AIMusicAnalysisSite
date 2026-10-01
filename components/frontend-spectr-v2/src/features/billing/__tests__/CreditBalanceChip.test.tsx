// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CreditBalanceChip } from '../CreditBalanceChip';

const ents = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock('../../../api/hooks', () => ({ useEntitlements: () => ents }));
vi.mock('../BuyCreditsProvider', () => ({ useBuyCredits: () => ({ open: vi.fn() }) }));

describe('CreditBalanceChip', () => {
  it('shows the balance', () => {
    ents.data = { tier: 'credits', creditBalance: 420, creditsEnabled: true };
    render(<CreditBalanceChip />);
    expect(screen.getByRole('button', { name: /420 credits/i })).toBeTruthy();
  });

  it('shows the Pro allowance alongside the balance', () => {
    ents.data = { tier: 'pro', creditBalance: 80, proAnalysesLimit: 15, proAnalysesUsed: 9, creditsEnabled: true };
    render(<CreditBalanceChip />);
    expect(screen.getByText(/Pro · 9\/15/)).toBeTruthy();
  });

  it('renders nothing when credits are disabled', () => {
    ents.data = { tier: 'pro', creditsEnabled: false };
    const { container } = render(<CreditBalanceChip />);
    expect(container.firstChild).toBeNull();
  });
});
