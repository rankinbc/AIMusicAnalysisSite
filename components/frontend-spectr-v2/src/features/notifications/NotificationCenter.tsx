/* Story 11.7 — notification bell + inbox dropdown.
 *
 * Container (NotificationBell) owns the hooks/dropdown; the list + items are
 * pure presentational components so the digest-vs-event rendering and unread
 * badge are static-render testable (AC5). Deep-links route to the version's
 * listen-rack page and mark the row read on click (AC3). */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';

import { notificationEmoji, notificationText } from './notification-text';
import {
  useMarkAllRead,
  useMarkRead,
  useNotifications,
  useUnreadCount,
  type NotificationDto,
} from './useNotifications';
import s from './notifications.module.css';

// ── pure rendering (wording helpers live in notification-text.ts) ───────────

export function NotificationItem({ n, onOpen }: { n: NotificationDto; onOpen?: (n: NotificationDto) => void }) {
  return (
    <button
      type="button"
      className={s.item}
      data-unread={n.readAt === null}
      data-digest={n.digestKey !== null}
      onClick={() => onOpen?.(n)}
    >
      <span className={s.itemEmoji} aria-hidden>{notificationEmoji(n)}</span>
      <span className={s.itemBody}>
        <span className={s.itemText}>{notificationText(n)}</span>
        <span className={`mono ${s.itemTime}`}>{new Date(n.updatedAt).toLocaleString()}</span>
      </span>
      {n.readAt === null && <span className={s.itemDot} aria-label="unread" />}
    </button>
  );
}

export function NotificationList({
  items,
  onOpen,
  onMarkAllRead,
  hasMore,
  onMore,
}: {
  items: NotificationDto[];
  onOpen?: (n: NotificationDto) => void;
  onMarkAllRead?: () => void;
  hasMore?: boolean;
  onMore?: () => void;
}) {
  return (
    <div className={s.panel}>
      <div className={s.panelHead}>
        <span className="label">Notifications</span>
        <button type="button" className={s.markAll} onClick={onMarkAllRead}>Mark all read</button>
      </div>
      {items.length === 0 ? (
        <div className={`mono ${s.empty}`}>Nothing yet — feedback on your tracks lands here.</div>
      ) : (
        <div className={s.list}>
          {items.map((n) => <NotificationItem key={n.id} n={n} {...(onOpen ? { onOpen } : {})} />)}
        </div>
      )}
      {hasMore && (
        <button type="button" className={s.more} onClick={onMore}>More…</button>
      )}
    </div>
  );
}

// ── container ────────────────────────────────────────────────────────────────

export function NotificationBell({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const { data: unread } = useUnreadCount();
  // Audit wave-3 (E7.7) — infinite query: "More…" appends the next page
  // instead of replacing the visible list with it.
  const { data: pages, hasNextPage, fetchNextPage } = useNotifications(open);
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  const unreadCount = unread?.unread ?? 0;

  const openNotification = (n: NotificationDto) => {
    if (n.readAt === null) markRead.mutate(n.id);
    setOpen(false);
    const versionId = n.payload?.versionId;
    if (versionId) void navigate({ to: '/listen-rack/$versionId', params: { versionId } });
  };

  return (
    <div ref={wrapRef} className={s.wrap}>
      <button
        type="button"
        className={className ?? s.bellBtn}
        title="Notifications"
        aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3 6a4 4 0 1 1 8 0v3l1 1H2l1-1V6z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M5 11a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        {unreadCount > 0 && (
          <span className={`mono ${s.badge}`} data-testid="unread-badge">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <NotificationList
          items={(pages?.pages ?? []).flatMap((p) => p.items)}
          onOpen={openNotification}
          onMarkAllRead={() => markAll.mutate()}
          hasMore={hasNextPage}
          onMore={() => void fetchNextPage()}
        />
      )}
    </div>
  );
}
