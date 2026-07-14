/* Story 6.1 (AC4) — per-route document metadata for the public funnel pages.
 * Client-side only: crawlers never execute this (they get the BFF meta shell
 * via the Caddy bot split); this keeps the tab title + description honest for
 * humans and history entries. Restores the previous values on unmount so
 * app routes keep the base "SPECTR" title. */
import { useEffect } from 'react';

export function usePageMeta(title: string, description?: string): void {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = title;

    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const created = !meta;
    const prevDescription = meta?.content ?? null;
    if (description) {
      if (!meta) {
        meta = document.createElement('meta');
        meta.name = 'description';
        document.head.appendChild(meta);
      }
      meta.content = description;
    }

    return () => {
      document.title = prevTitle;
      if (!meta) return;
      if (created) meta.remove();
      else if (prevDescription !== null) meta.content = prevDescription;
    };
  }, [title, description]);
}
