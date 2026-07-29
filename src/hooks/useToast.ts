import { useContext } from 'react';
import { ToastContext, type ToastContextValue } from '@/context/ToastContext';

/**
 * Transient user-facing feedback. Must be used within <ToastProvider>.
 *
 * Use this for any write the user initiated. Reporting a failure to Sentry
 * alone leaves the user believing it succeeded — the rota builder silently
 * dropped drag-and-drop assignments that way before Phase 1.5.
 */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (ctx === null) {
    throw new Error('useToast must be used within a <ToastProvider>.');
  }
  return ctx;
}
