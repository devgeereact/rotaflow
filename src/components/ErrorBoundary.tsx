import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from '@/lib/sentry';
import { Button } from '@/components/ui/Button';

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
}

/** Catches render-time errors, reports to Sentry, shows a recoverable fallback. */
export class ErrorBoundary extends Component<Props, State> {
  public state: State = { hasError: false };

  public static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    reportError(error, { componentStack: info.componentStack });
  }

  private readonly handleReset = (): void => {
    this.setState({ hasError: false });
    window.location.reload();
  };

  public render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="grid min-h-screen place-items-center bg-background p-6 text-center">
        <div className="max-w-md">
          <h1 className="mb-2 font-display text-2xl text-content">
            Something went wrong
          </h1>
          <p className="mb-6 text-content-muted">
            The error has been logged. Try reloading — if it keeps happening,
            please let us know.
          </p>
          <Button onClick={this.handleReset}>Reload app</Button>
        </div>
      </div>
    );
  }
}
