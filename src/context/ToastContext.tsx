/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ToastVariant = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  variant: ToastVariant;
  message: string;
}

export interface ToastContextValue {
  toasts: Toast[];
  /** Show a toast; returns its id so a caller can dismiss it early. */
  showToast: (variant: ToastVariant, message: string) => number;
  /** Convenience wrapper for the overwhelmingly common failure case. */
  showError: (message: string) => number;
  showSuccess: (message: string) => number;
  dismissToast: (id: number) => void;
}

/** Errors linger longer. They usually carry a recovery instruction. */
const DURATION_MS: Record<ToastVariant, number> = {
  success: 4000,
  info: 5000,
  error: 8000,
};

// null = "not inside a provider"; the hook guards against this.
export const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismissToast = useCallback((id: number): void => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (variant: ToastVariant, message: string): number => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, variant, message }]);
      timers.current.set(
        id,
        setTimeout(() => dismissToast(id), DURATION_MS[variant]),
      );
      return id;
    },
    [dismissToast],
  );

  const showError = useCallback(
    (message: string): number => showToast('error', message),
    [showToast],
  );
  const showSuccess = useCallback(
    (message: string): number => showToast('success', message),
    [showToast],
  );

  const value = useMemo<ToastContextValue>(
    () => ({ toasts, showToast, showError, showSuccess, dismissToast }),
    [toasts, showToast, showError, showSuccess, dismissToast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toaster toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

const VARIANT_STYLES: Record<ToastVariant, string> = {
  success: 'border-success/30 bg-success/10 text-success',
  error: 'border-danger/30 bg-danger/10 text-danger',
  info: 'border-surface-border bg-surface text-content dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark',
};

/**
 * Fixed viewport region for transient feedback. Errors are assertive so a
 * failed write interrupts a screen reader mid-task. Silently dropping a
 * shift assignment is exactly the failure this exists to prevent.
 */
function Toaster({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}): JSX.Element {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 px-4 pb-6"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.variant === 'error' ? 'alert' : 'status'}
          aria-live={toast.variant === 'error' ? 'assertive' : 'polite'}
          className={cn(
            'pointer-events-auto flex w-full max-w-md animate-fade-up motion-reduce:animate-none items-start gap-3',
            'rounded-xl border px-4 py-3 text-sm shadow-md',
            VARIANT_STYLES[toast.variant],
          )}
        >
          <span className="flex-1">{toast.message}</span>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            aria-label="Dismiss notification"
            className="-m-1 rounded p-1 opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
