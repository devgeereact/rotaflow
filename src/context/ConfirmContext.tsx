/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

export interface ConfirmOptions {
  title: string;
  /** What actually happens. Say it plainly, including anything irreversible. */
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` for destructive actions. Deletes, revokes, anonymisation. */
  tone?: 'danger' | 'primary';
}

export interface ConfirmContextValue {
  /** Resolves `true` if the user confirmed, `false` on cancel/Escape/backdrop. */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

export const ConfirmContext = createContext<ConfirmContextValue | null>(null);

/**
 * Promise-based replacement for `window.confirm`.
 *
 * ## Why this had to stop being the native dialog
 *
 * Five destructive actions were gated on `window.confirm`: delete a shift
 * type, remove an emergency contact, delete a staff document, disconnect SMTP,
 * and **anonymise a staff member**, that last one being irreversible by
 * design, because it exists to satisfy a UK GDPR erasure request.
 *
 * `window.confirm` is unstyled, unthemeable and untestable, but the reason it
 * is genuinely unsafe here is narrower: **a browser is allowed not to show
 * it.** Chrome suppresses repeated dialogs and drops them entirely from
 * cross-origin frames, and an installed PWA is exactly the context where users
 * tick "don't show again". A suppressed `confirm()` returns `false`, so a
 * suppressed *guard* fails closed, but the user is then left clicking a
 * button that silently does nothing, with no way to find out why.
 *
 * The API stays await-shaped so call sites read almost identically to the
 * native ones they replace:
 *
 * ```ts
 * if (!(await confirm({ title: 'Delete shift type?', message: '…' }))) return;
 * ```
 */
export function ConfirmProvider({ children }: { children: ReactNode }): JSX.Element {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  // The pending promise's resolver. Held in a ref, not state: settling it must
  // not depend on a re-render having happened.
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const settle = useCallback((value: boolean): void => {
    resolver.current?.(value);
    resolver.current = null;
    setOptions(null);
  }, []);

  const confirm = useCallback((next: ConfirmOptions): Promise<boolean> => {
    // A second confirm() while one is open would otherwise strand the first
    // promise forever and hang whatever awaited it. Resolve it as a cancel.
    resolver.current?.(false);
    setOptions(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const value = useMemo<ConfirmContextValue>(() => ({ confirm }), [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Modal
        open={options !== null}
        onClose={() => settle(false)}
        title={options?.title ?? ''}
      >
        {options && (
          <>
            <div className="flex gap-4">
              <span
                className={
                  options.tone === 'danger'
                    ? 'grid h-10 w-10 shrink-0 place-items-center rounded-full bg-danger/10 text-danger'
                    : 'grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary dark:text-primary-ink-dark'
                }
              >
                <AlertTriangle size={20} aria-hidden="true" />
              </span>
              <p className="pt-1.5 text-sm text-content-muted dark:text-content-muted-dark">
                {options.message}
              </p>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => settle(false)}>
                {options.cancelLabel ?? 'Cancel'}
              </Button>
              <Button
                variant={options.tone === 'danger' ? 'danger' : 'primary'}
                onClick={() => settle(true)}
              >
                {options.confirmLabel ?? 'Confirm'}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </ConfirmContext.Provider>
  );
}
