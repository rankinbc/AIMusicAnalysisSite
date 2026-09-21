/* D10 — the router's defaultErrorComponent. The router's error boundary
 * catches before Sentry.ErrorBoundary ever sees anything, so this is the
 * one place route-render errors get reported. A stale chunk (deploy landed
 * while the tab was open) gets a guarded reload instead of a report — see
 * lib/chunk-reload.ts — unless the guard refuses, which means it is not stale. */
import { useEffect } from 'react';
import type { ErrorComponentProps } from '@tanstack/react-router';
import { isStaleChunkError, reloadOnceForStaleChunk } from '../lib/chunk-reload';
import { reportError } from '../lib/sentry';
import { PublicChrome } from './PublicChrome';
import s from './StatusScreen.module.css';

export function RouteErrorScreen({ error }: ErrorComponentProps) {
  useEffect(() => {
    // A reload that actually happens is the whole remedy for a stale tab. If the
    // guard refuses (the one reload was already spent, or storage is off), the
    // chunk is genuinely missing — a broken deploy — and that must be reported.
    if (isStaleChunkError(error) && reloadOnceForStaleChunk()) return;
    reportError(error);
  }, [error]);

  return (
    <>
      <PublicChrome />
      <main className={s.shell}>
        <span className="label">Error</span>
        <h1 className={s.title}>Something went wrong on this page.</h1>
        <p className={s.body}>The error has been reported. Reloading usually fixes it.</p>
        <div className={s.actions}>
          <button type="button" className="btn primary" onClick={() => window.location.reload()}>
            Reload page
          </button>
          <a href="/" className="btn ghost">Back to home</a>
        </div>
      </main>
    </>
  );
}
