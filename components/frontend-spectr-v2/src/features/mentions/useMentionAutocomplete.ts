/* Story 11.11 — @mention autocomplete state machine for a comment composer.
 * Contract (ProfileEndpoints.SearchHandles): GET /u/?q=<prefix> →
 * {items: [{handle, displayName, avatarHue}]} — anon-allowed (the /v/{token}
 * composer mentions too), ip-rate-limited server-side, ≤8 items.
 *
 * The composer calls onChange(text, caret) from its input's onChange and
 * routes onKeyDown FIRST through handleKeyDown — a true return means the
 * dropdown consumed the key (Enter picks instead of submitting; the 11.1
 * isComposing Enter-guard stays in the composer). */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { fetcher } from '../../api/fetcher';

import { activeMentionQuery, applyMention, type ActiveMention } from './mention-helpers';

export interface HandleSearchItemDto {
  handle: string;
  displayName: string | null;
  avatarHue: number | null;
}

interface HandleSearchDto {
  items: HandleSearchItemDto[];
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export function useMentionAutocomplete(setText: (t: string) => void) {
  const [active, setActive] = useState<ActiveMention | null>(null);
  const [snapshot, setSnapshot] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const query = active?.query ?? '';
  const debounced = useDebounced(query, 200);
  const enabled = active !== null && debounced.length > 0;

  const search = useQuery({
    queryKey: ['u', 'search', debounced],
    queryFn: () => fetcher<HandleSearchDto>({ url: '/u/', method: 'GET', params: { q: debounced } }),
    enabled,
    staleTime: 30_000,
  });

  const items = enabled ? (search.data?.items ?? []) : [];
  const open = active !== null && items.length > 0;

  const onChange = (text: string, caret: number | null) => {
    setSnapshot(text);
    const next = caret == null ? null : activeMentionQuery(text, caret);
    setActive(next);
    if (next?.start !== active?.start) setActiveIndex(0);
  };

  const close = () => setActive(null);

  const pick = (handle: string) => {
    if (!active) return;
    const r = applyMention(snapshot, active, handle);
    setText(r.text);
    setActive(null);
  };

  /** Returns true when the key was consumed by the dropdown. */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return false;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % items.length);
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + items.length) % items.length);
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const item = items[Math.min(activeIndex, items.length - 1)];
      if (item) pick(item.handle);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return true;
    }
    return false;
  };

  return { open, items, activeIndex, onChange, handleKeyDown, pick, close };
}
