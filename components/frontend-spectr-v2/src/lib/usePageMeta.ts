/* Story 6.1 (AC4) — per-route document metadata for the public funnel pages.
 * Client-side only: crawlers never execute this (they get the BFF meta shell
 * via the Caddy bot split); this keeps the tab title + description + OG tags
 * honest for humans and JS-executing scrapers (review finding: the static
 * index.html OG tags are landing-specific and must not leak onto /pricing).
 * Restores the previous values on unmount so app routes keep the base meta. */
import { useEffect } from 'react';

function upsert(selector: string, create: () => HTMLMetaElement, content: string): () => void {
  let meta = document.head.querySelector<HTMLMetaElement>(selector);
  const created = !meta;
  const prev = meta?.content ?? null;
  if (!meta) {
    meta = create();
    document.head.appendChild(meta);
  }
  meta.content = content;
  const el = meta;
  return () => {
    if (created) el.remove();
    else if (prev !== null) el.content = prev;
  };
}

function named(name: string): () => HTMLMetaElement {
  return () => {
    const m = document.createElement('meta');
    m.name = name;
    return m;
  };
}

function property(prop: string): () => HTMLMetaElement {
  return () => {
    const m = document.createElement('meta');
    m.setAttribute('property', prop);
    return m;
  };
}

export function usePageMeta(title: string, description?: string): void {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = title;

    const restores: Array<() => void> = [
      upsert('meta[property="og:title"]', property('og:title'), title),
    ];
    if (description) {
      restores.push(
        upsert('meta[name="description"]', named('description'), description),
        upsert('meta[property="og:description"]', property('og:description'), description),
      );
    }

    return () => {
      document.title = prevTitle;
      for (const restore of restores) restore();
    };
  }, [title, description]);
}
