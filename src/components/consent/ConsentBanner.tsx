import { useEffect, useLayoutEffect, useRef, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { useConsent } from '@/context/ConsentContext';

/**
 * The first-visit storage question.
 *
 * ## The rules it is built to, and why each one is here
 *
 * **Accept and reject are the same button.** Same variant, same size, same
 * row, adjacent. A reject rendered as a faint link beside a solid accept is
 * the commonest dark pattern in this genre and the one regulators name first.
 * Neither is pre-selected, and nothing in the granular panel starts switched
 * on.
 *
 * **It does not block the page.** No overlay, no focus trap, no dismissal by
 * scrolling. That is not a shortcut: the actual gate is in the write path
 * (`isAllowed` in `src/lib/consent.ts`), so an undecided visitor is left
 * untouched whether or not they ever look at this. A banner that covers the
 * content to force an answer pressures the answer, and pressuring the answer
 * is the thing consent is supposed to avoid.
 *
 * **Focus moves here once, on the first visit.** A keyboard or screen-reader
 * user should not have to tab through a whole page to find the question. It
 * is a labelled region rather than a dialog, so the page behind it stays
 * reachable and Escape has nothing to trap.
 *
 * **It reserves its own space.** "Does not block the page" was true of focus
 * and false of pointers: being `fixed bottom-0`, it sat on top of whatever
 * happened to be at the foot of the viewport, and on the onboarding step that
 * was the Continue button. CI caught it — Playwright reported this element
 * `intercepts pointer events` and retried the click 231 times — and no amount
 * of testing the banner itself would have, because the defect is in what the
 * banner covers. So it measures itself into `--consent-inset` and the two
 * scrolling containers pad by it: nothing is ever underneath it.
 */
export function ConsentBanner(): JSX.Element | null {
  const { needsDecision, acceptAll, rejectAll, openPanel } = useConsent();
  const headingRef = useRef<HTMLSpanElement>(null);
  const bannerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (needsDecision) headingRef.current?.focus();
  }, [needsDecision]);

  // Publish the height so `body` and the app shell's scroll area can pad by
  // it. Layout effect and a ResizeObserver rather than a fixed number: this
  // banner wraps to three lines on a narrow screen and one on a wide one, and
  // a hardcoded inset would be wrong on most of them.
  useLayoutEffect(() => {
    const root = document.documentElement;
    const node = bannerRef.current;
    if (!needsDecision || node === null) {
      root.style.removeProperty('--consent-inset');
      return undefined;
    }

    const publish = (): void => {
      root.style.setProperty('--consent-inset', `${node.offsetHeight}px`);
    };
    publish();

    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--consent-inset');
    };
  }, [needsDecision]);

  if (!needsDecision) return null;

  // Compact on purpose (design gap F01/F18, 1 Nov 2026): one line of text and
  // one row of controls, about 64 px tall from `md` up. The old three-line
  // card took 205 px of a 900 px screen. The inset above still pads the page by
  // whatever height this ends up, so it never covers content at any width.
  return (
    <section
      ref={bannerRef}
      aria-labelledby="consent-heading"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-surface-border bg-surface px-4 py-3 shadow-lg dark:border-surface-border-dark dark:bg-surface-dark"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-3 md:flex-row md:items-center md:gap-6">
        <p className="min-w-0 flex-1 text-sm leading-snug text-content-muted dark:text-content-muted-dark">
          <span
            id="consent-heading"
            ref={headingRef}
            role="heading"
            aria-level={2}
            tabIndex={-1}
            className="font-semibold text-content focus-visible:outline-hidden dark:text-content-dark"
          >
            What may this browser keep?
          </span>{' '}
          RotaFlow sets no cookies and runs no analytics. May we also remember your
          preferences and send error reports? Neither is on unless you say so.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {/* Deliberately identical in weight and size. Rejecting must not be
              harder, slower or quieter than accepting. */}
          <Button variant="secondary" size="sm" onClick={rejectAll}>
            Reject all
          </Button>
          <Button variant="secondary" size="sm" onClick={acceptAll}>
            Accept all
          </Button>
          <button
            type="button"
            onClick={openPanel}
            className="h-9 rounded px-2 text-sm font-medium text-primary-ink underline underline-offset-2 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary dark:text-primary-ink-dark"
          >
            Choose what to keep
          </button>
          <Link
            to="/legal/cookies"
            className="rounded px-1 text-sm text-content-muted underline underline-offset-2 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary dark:text-content-muted-dark"
          >
            Cookie Notice
          </Link>
        </div>
      </div>
    </section>
  );
}
