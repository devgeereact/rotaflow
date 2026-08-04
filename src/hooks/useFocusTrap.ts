import { useEffect, type RefObject } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Traps focus inside an open drawer or dialog, closes it on Escape, hides the
 * page behind it from assistive technology, and restores focus on close.
 *
 * ## Why this is a hook rather than a second copy
 *
 * `Sidebar` had all of this inline, and the platform console's shell needs the
 * identical behaviour for its own mobile drawer. Copying forty lines of focus
 * management is how two drawers end up with one of them subtly wrong — the
 * second one usually loses the `aria-hidden` on the page behind it, or forgets
 * to restore focus, and neither failure is visible to a sighted mouse user
 * testing it.
 *
 * `containerSelector` is what gets hidden while the drawer is open. It defaults
 * to `main`, which is correct for both shells; a modal over a different region
 * would pass its own.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
  containerSelector = 'main',
): void {
  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const drawer = ref.current;
    const focusable = drawer?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    (focusable?.[0] ?? drawer)?.focus();

    const pageBehind = document.querySelector(containerSelector);
    if (pageBehind) pageBehind.setAttribute('aria-hidden', 'true');

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !drawer) return;

      const focusableEls = Array.from(
        drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      // Nothing to focus: swallow Tab rather than letting it escape to the
      // page behind, which the user cannot see and which is aria-hidden.
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
      if (pageBehind) pageBehind.removeAttribute('aria-hidden');
      previouslyFocused?.focus();
    };
  }, [ref, open, onClose, containerSelector]);
}
