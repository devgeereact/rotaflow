import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { IconButton } from '@/components/ui/IconButton';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /**
   * True while the dialog holds edits the user has not saved.
   *
   * A dialog that discards typing on a stray backdrop click loses real work,
   * and this one closes on both backdrop and Escape. While `dirty`, neither
   * dismisses it: the dialog stays open and says why, and the explicit Close,
   * Cancel or Save controls the form already has are the way out. That keeps
   * one rule for both gestures rather than protecting the accidental one and
   * leaving the deliberate one to destroy the same data.
   *
   * Callers that own no form leave this alone and nothing changes.
   */
  dirty?: boolean;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Centered dialog overlay. Closes on backdrop click or Escape; traps focus,
 * locks background scrolling, and returns focus to whatever opened it.
 *
 * `aria-labelledby` points at the rendered heading rather than repeating the
 * string in `aria-label`: two copies of a title drift, and the visible one is
 * the one that is true.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  dirty = false,
}: ModalProps): JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const dirtyRef = useRef(dirty);
  const titleId = useId();
  const [blockedDismiss, setBlockedDismiss] = useState(false);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    dirtyRef.current = dirty;
    if (!dirty) setBlockedDismiss(false);
  }, [dirty]);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const dialog = dialogRef.current;
    const focusable = dialog?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    (focusable?.[0] ?? dialog)?.focus();

    // Scroll lock. Without it the page behind a dialog scrolls under it on a
    // trackpad or a phone, which on a long form means the user loses their
    // place in the page they will return to.
    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (dirtyRef.current) {
          setBlockedDismiss(true);
          return;
        }
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !dialog) return;

      const focusableEls = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusableEls.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusableEls[0]!;
      const last = focusableEls[focusableEls.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  const requestClose = (): void => {
    if (dirty) {
      setBlockedDismiss(true);
      return;
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      {/* The backdrop is a pointer affordance only.
          It used to be a focusable `<button aria-label="Close">`, which put a
          *second* control called "Close" in the dialog — a screen-reader user
          heard the same name twice and a keyboard user got a full-viewport tab
          stop that looks like nothing. Escape and the real Close button are
          the accessible ways out, so this leaves the accessibility tree. */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        className="fixed inset-0 cursor-default"
        onClick={requestClose}
      />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="relative z-10 w-full max-w-lg animate-fade-up rounded-2xl border border-surface-border bg-surface p-6 shadow-lg outline-none motion-reduce:animate-none dark:border-surface-border-dark dark:bg-surface-dark"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2
            id={titleId}
            className="mt-1.5 text-lg font-semibold text-content dark:text-content-dark"
          >
            {title}
          </h2>
          {/* 44×44, not the `p-1` around an 18px glyph this used to be. It is
              the control every dialog depends on and the one most often hit
              one-handed. */}
          <IconButton icon={X} label="Close" onClick={onClose} className="-mr-2 -mt-2" />
        </div>
        {blockedDismiss && (
          <p
            role="status"
            className="mb-4 flex items-start gap-2 rounded-lg bg-warning-wash px-3 py-2 text-sm text-content dark:bg-warning-wash-dark dark:text-content-dark"
          >
            <AlertTriangle
              size={16}
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-warning"
            />
            You have unsaved changes. Save them, or use Cancel to discard them.
          </p>
        )}
        {children}
      </div>
    </div>
  );
}
