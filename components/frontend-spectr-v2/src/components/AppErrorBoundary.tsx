import { Component, type ReactNode } from 'react';
import { reportError } from '../lib/sentry';

// P7 (bundle diet) — replaces Sentry.ErrorBoundary in main.tsx: Sentry is
// now a lazy import (lib/sentry.ts), so the outermost boundary can no
// longer be the SDK's own component. reportError() is DSN-gated and
// buffers until the SDK loads, same as before.
interface Props {
  fallback: ReactNode;
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export class AppErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    reportError(error);
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
