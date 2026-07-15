import { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useNavigate } from '@tanstack/react-router';

import { useSongs } from '../api/hooks';
import { filterCommands, type PaletteCommand } from '../lib/shortcuts';
import s from './CommandPalette.module.css';

// Story 5.10 (UX-DR43) — the ⌘K command palette. This IS the "real command
// palette + search machinery" the 12.5 removal note asked for: static nav
// commands + client-side search over the user's song library (the songs
// query is already cached app-wide; no new endpoint).

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { data: songs } = useSongs();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const commands = useMemo(
    () => filterCommands(query, songs ?? []),
    [query, songs],
  );

  // Reset per open — a stale query from the last invocation is never useful.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const commit = (cmd: PaletteCommand) => {
    onOpenChange(false);
    if (cmd.kind === 'song') {
      void navigate({ to: '/songs/$songId', params: { songId: cmd.to } });
    } else {
      void navigate({ to: cmd.to });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, commands.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = commands[activeIndex];
      if (cmd) commit(cmd);
    }
  };

  // Keep the active option in view while arrowing.
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content className={s.content} aria-describedby={undefined}>
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <input
            className={s.input}
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-listbox"
            aria-activedescendant={commands[activeIndex]?.id}
            aria-label="Search songs and pages"
            placeholder="Search songs and pages…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            autoFocus
          />
          <ul id="cmdk-listbox" role="listbox" className={s.list} ref={listRef}>
            {commands.length === 0 && (
              <li className={s.empty} role="presentation">
                No matches — try a song name.
              </li>
            )}
            {commands.map((cmd, i) => (
              <li
                key={cmd.id}
                id={cmd.id}
                role="option"
                aria-selected={i === activeIndex}
                data-active={i === activeIndex}
                className={s.item}
                onMouseEnter={() => setActiveIndex(i)}
                onMouseDown={(e) => {
                  // mousedown (not click) so the input blur doesn't race the commit
                  e.preventDefault();
                  commit(cmd);
                }}
              >
                <span className={s.itemLabel}>{cmd.label}</span>
                <span className={`label ${s.itemKind}`}>{cmd.kind === 'song' ? 'song' : 'page'}</span>
              </li>
            ))}
          </ul>
          <div className={s.hint}>
            <span className="mono">↑↓</span> navigate · <span className="mono">↵</span> open ·{' '}
            <span className="mono">esc</span> close
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
