/* E6.14 — live room rail panels: PeoplePanel renders the REAL roster (never
 * ROOM_LISTENERS) with userId-bearing grants and no grant affordance for anon
 * entries (no anonId on the wire); ChatPanel goes wire-driven (no SEED_CHAT,
 * no local append, failed sends keep the input). Demo route (roster/live null)
 * stays fixture-driven. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ActorRefDto } from '../../api/types';
import type { CapabilitySet } from './capabilities';
import type { RoomControl } from './identity';
import type { ReactionFeedItem } from './data';
import { ChatPanel, PeoplePanel } from './rail';

const me: ActorRefDto = { type: 'user', userId: 'u-me', handle: 'maeve', displayName: 'Maeve', hue: 168 };
const vela: ActorRefDto = { type: 'user', userId: 'u-vela', handle: 'vela', displayName: 'Vela', hue: 220 };
const anon: ActorRefDto = { type: 'anon', userId: null, handle: null, displayName: 'anon-river', hue: 195 };

const ME_KEY = 'user:u-me';
const noControl: RoomControl = { rackHolder: null, visualsHolder: null };

function hostCap(over: Partial<CapabilitySet> = {}): CapabilitySet {
  return { canGrantControl: true, ...over } as CapabilitySet;
}

function people(over: Partial<Parameters<typeof PeoplePanel>[0]> = {}) {
  return render(
    <PeoplePanel
      myStatus="🎧"
      cap={hostCap()}
      roomControl={noControl}
      onGrant={vi.fn()}
      roster={[me, vela, anon]}
      meKey={ME_KEY}
      {...over}
    />,
  );
}

afterEach(cleanup);

describe('PeoplePanel — live roster (E6.14)', () => {
  it('renders the real participants, never the ROOM_LISTENERS fixtures', () => {
    people();
    expect(screen.getByText('@vela')).toBeTruthy();
    expect(screen.getByText('@maeve')).toBeTruthy();
    expect(screen.getByText('anonymous')).toBeTruthy();
    expect(screen.getByText('3 listening')).toBeTruthy();
    // Fixture handles must not leak into a live room.
    expect(screen.queryByText('@maek')).toBeNull();
    expect(screen.queryByText('@forge')).toBeNull();
  });

  it('grants target the real userId-bearing actor', () => {
    const onGrant = vi.fn();
    people({ onGrant });
    fireEvent.click(screen.getByText('+ DJ'));
    expect(onGrant).toHaveBeenCalledWith('rack', expect.objectContaining({ type: 'user', userId: 'u-vela' }));
  });

  it('renders no grant buttons for anon entries (no anonId on the wire)', () => {
    people({ roster: [me, anon] });
    expect(screen.queryByText('+ DJ')).toBeNull();
    expect(screen.queryByText('+ Vis')).toBeNull();
  });

  it('hides grant buttons entirely for non-hosts', () => {
    people({ cap: hostCap({ canGrantControl: false }) });
    expect(screen.queryByText('+ DJ')).toBeNull();
    expect(screen.queryByText(/You're hosting/)).toBeNull();
  });

  it('hides Invite in a live room without an onInvite handler; wires it when present', () => {
    people();
    expect(screen.queryByText('↗ Invite')).toBeNull();

    cleanup();
    const onInvite = vi.fn();
    people({ onInvite });
    fireEvent.click(screen.getByText('↗ Invite'));
    expect(onInvite).toHaveBeenCalledTimes(1);
  });

  it('keeps the fixture roster + Invite button on the demo route (roster null)', () => {
    people({ roster: null });
    expect(screen.getByText('@maek')).toBeTruthy();
    expect(screen.getByText('@forge')).toBeTruthy();
    expect(screen.getByText('7 listening')).toBeTruthy();
    expect(screen.getByText('↗ Invite')).toBeTruthy();
  });
});

const liveFeed: ReactionFeedItem[] = [
  { id: 'c1', emoji: '💬', handle: 'vela', text: 'sub feels hot', t: 12, kind: 'chat' },
  { id: 'r1', emoji: '🔥', handle: 'forge-live', text: '', t: 30, kind: 'react' },
];

describe('ChatPanel — wire-driven in live rooms (E6.14/E6.13)', () => {
  it('renders the kind-tagged feed with no SEED_CHAT and no maek', () => {
    render(
      <ChatPanel feed={liveFeed} onReact={vi.fn()}
        live={{ send: vi.fn().mockResolvedValue(undefined), position: () => 0 }} />,
    );
    expect(screen.getByText('sub feels hot')).toBeTruthy();
    expect(screen.getByText('@forge-live')).toBeTruthy();
    // Seeds are demo-only.
    expect(screen.queryByText('the breakdown reverb is unreal')).toBeNull();
    expect(screen.queryByText('kick could hit harder imo')).toBeNull();
  });

  it('sends over the wire with the playhead stamp and clears the input on success', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    render(<ChatPanel feed={[]} onReact={vi.fn()} live={{ send, position: () => 42 }} />);
    const input = screen.getByPlaceholderText('Say something…') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'hello room' } });
    fireEvent.click(screen.getByText('Send'));
    expect(send).toHaveBeenCalledWith('hello room', 42);
    await waitFor(() => expect(input.value).toBe(''));
    // Own message is NOT appended locally — it returns via server echo.
    expect(screen.queryByText('hello room')).toBeNull();
  });

  it('keeps the input text when the send fails', async () => {
    const send = vi.fn().mockRejectedValue(new Error('boom'));
    render(<ChatPanel feed={[]} onReact={vi.fn()} live={{ send, position: () => 0 }} />);
    const input = screen.getByPlaceholderText('Say something…') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'do not lose me' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(send).toHaveBeenCalled());
    await waitFor(() => expect(input.value).toBe('do not lose me'));
  });

  it('demo route (live null) keeps seeds and local append', () => {
    render(<ChatPanel feed={[]} onReact={vi.fn()} />);
    expect(screen.getByText('the breakdown reverb is unreal')).toBeTruthy();
    const input = screen.getByPlaceholderText('Say something…') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'local msg' } });
    fireEvent.click(screen.getByText('Send'));
    expect(screen.getByText('local msg')).toBeTruthy();
    expect(screen.getByText('@maek')).toBeTruthy();
    expect(input.value).toBe('');
  });
});
