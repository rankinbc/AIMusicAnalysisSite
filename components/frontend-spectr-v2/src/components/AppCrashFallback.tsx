/* D10 — the outermost Sentry.ErrorBoundary fallback in main.tsx. This is the
 * one shell that renders OUTSIDE every provider (query client, auth, router),
 * so no PublicChrome, no hooks that reach into app context — just the shared
 * StatusScreen chrome and a reload. */
import s from './StatusScreen.module.css';

export function AppCrashFallback() {
  return (
    <main className={s.shell}>
      <h1 className={s.title}>Something broke.</h1>
      <p className={s.body}>The error has been reported. Reload to continue.</p>
      <div className={s.actions}>
        <button type="button" className="btn primary" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    </main>
  );
}
