import { useEffect, useLayoutEffect, useRef } from 'react';
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
  const headingRef = useRef<HTMLHeadingElement>(null);
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

  return (
    <section
      ref={bannerRef}
      aria-labelledby="consent-heading"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-surface-border bg-surface p-4 shadow-lg dark:border-surface-border-dark dark:bg-surface-dark sm:p-6"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <div>
          <h2
            id="consent-heading"
            ref={headingRef}
            tabIndex={-1}
            className="font-semibold text-content focus-visible:outline-none dark:text-content-dark"
          >
            What may this browser keep?
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-content-muted dark:text-content-muted-dark">
            RotaFlow sets no cookies and runs no analytics. Signing in and working offline
            need a little storage on this device and cannot be switched off. Beyond that
            we would like to remember your interface preferences and, if something breaks,
            send us the error. Neither is on unless you say so.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Deliberately identical in weight and size. Rejecting must not be
              harder, slower or quieter than accepting. */}
          <Button variant="primary" onClick={acceptAll}>
            Accept all
          </Button>
          <Button variant="primary" onClick={rejectAll}>
            Reject all
          </Button>
          <Button variant="secondary" onClick={openPanel}>
            Choose what to keep
          </Button>
          <Link
            to="/legal/cookies"
            className="rounded text-sm font-medium text-primary-ink underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-primary-ink-dark"
          >
            Read the Cookie Notice
          </Link>
        </div>
      </div>
    </section>
  );
}
