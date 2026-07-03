/* Story 11.11 — pure @mention suggestion dropdown (static-render testable).
 * The composer owns positioning (a relative wrapper) and the hook owns state;
 * this only renders items. Hand-rolled panel per the NotificationBell
 * precedent — no Radix combobox exists in this codebase. */
import type { HandleSearchItemDto } from './useMentionAutocomplete';
import s from './mentions.module.css';

export function MentionSuggestList({
  items,
  activeIndex,
  onPick,
}: {
  items: HandleSearchItemDto[];
  activeIndex: number;
  onPick: (handle: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className={s.panel} data-testid="mention-suggest" role="listbox" aria-label="Mention suggestions">
      {items.map((it, i) => (
        <button
          key={it.handle}
          type="button"
          role="option"
          aria-selected={i === activeIndex}
          className={s.item}
          data-active={i === activeIndex}
          // mousedown, not click: fires before the composer input loses focus.
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(it.handle);
          }}
        >
          <span
            aria-hidden
            className={s.dot}
            style={{ background: `oklch(0.72 0.16 ${it.avatarHue ?? 200})` }}
          />
          <span className={`mono ${s.handle}`}>@{it.handle}</span>
          {it.displayName && it.displayName !== it.handle && (
            <span className={s.name}>{it.displayName}</span>
          )}
        </button>
      ))}
    </div>
  );
}
