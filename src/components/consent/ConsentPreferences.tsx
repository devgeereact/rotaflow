import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Toggle } from '@/components/ui/Toggle';
import { useConsent } from '@/context/ConsentContext';
import { DIAGNOSTICS_DISCLOSURE, STORED_ITEMS } from '@/lib/legalFacts';
import type { ConsentSelection } from '@/lib/consent';

/**
 * The granular half of the consent choice.
 *
 * The essential rows are shown rather than hidden, with the switch replaced by
 * the word "Always on". A panel that lists only the optional categories
 * invites the reader to assume that is everything stored, which is the same
 * misdirection the cookie notice exists to avoid — and the list is right here
 * in `STORED_ITEMS`, so there is no reason to withhold it.
 *
 * Nothing optional starts selected. Reopening after a decision starts from
 * what was decided, so "change my mind" edits an answer rather than resetting
 * one.
 */
export function ConsentPreferences(): JSX.Element | null {
  const { panelOpen, closePanel, record, save } = useConsent();
  const [selection, setSelection] = useState<ConsentSelection>({
    preferences: false,
    diagnostics: false,
  });

  useEffect(() => {
    if (!panelOpen) return;
    setSelection({
      preferences: record?.preferences ?? false,
      diagnostics: record?.diagnostics ?? false,
    });
  }, [panelOpen, record]);

  if (!panelOpen) return null;

  const necessary = STORED_ITEMS.filter((item) => item.category === 'necessary');
  const preferences = STORED_ITEMS.filter((item) => item.category === 'preferences');

  return (
    <Modal open onClose={closePanel} title="Choose what this browser keeps">
      <div className="space-y-6">
        <p className="text-sm leading-relaxed text-content-muted dark:text-content-muted-dark">
          RotaFlow sets no cookies. What follows is everything it stores on this device,
          and the one thing it sends off it. Declining costs you two conveniences and
          nothing else — the app works either way.
        </p>

        <section className="space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-semibold text-content dark:text-content-dark">
                Essential
              </h3>
              <p className="text-sm text-content-muted dark:text-content-muted-dark">
                Needed to sign you in, keep you in the right organisation and hold work
                you did offline until it can be sent. Without these the app cannot run, so
                there is nothing to switch.
              </p>
            </div>
            <span className="shrink-0 pt-1 text-sm font-medium text-content-muted dark:text-content-muted-dark">
              Always on
            </span>
          </div>
          <ul className="space-y-1 text-sm text-content-muted dark:text-content-muted-dark">
            {necessary.map((item) => (
              <li key={item.key}>
                <span className="font-mono text-xs text-content dark:text-content-dark">
                  {item.key}
                </span>{' '}
                — {item.purpose}
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-3 border-t border-surface-border pt-6 dark:border-surface-border-dark">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-semibold text-content dark:text-content-dark">
                Interface preferences
              </h3>
              <p className="text-sm text-content-muted dark:text-content-muted-dark">
                Remembers choices you make yourself, so they survive a reload. Decline and
                they still work, they just last until you close the tab.
              </p>
            </div>
            <Toggle
              checked={selection.preferences}
              onChange={(next) => setSelection((s) => ({ ...s, preferences: next }))}
              label="Remember interface preferences on this device"
              className="mt-1 shrink-0"
            />
          </div>
          <ul className="space-y-1 text-sm text-content-muted dark:text-content-muted-dark">
            {preferences.map((item) => (
              <li key={item.key}>
                <span className="font-mono text-xs text-content dark:text-content-dark">
                  {item.key}
                </span>{' '}
                — {item.purpose}
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-3 border-t border-surface-border pt-6 dark:border-surface-border-dark">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-semibold text-content dark:text-content-dark">
                Crash reporting
              </h3>
              <p className="text-sm text-content-muted dark:text-content-muted-dark">
                {DIAGNOSTICS_DISCLOSURE.purpose}
              </p>
            </div>
            <Toggle
              checked={selection.diagnostics}
              onChange={(next) => setSelection((s) => ({ ...s, diagnostics: next }))}
              label="Send crash reports to Sentry"
              className="mt-1 shrink-0"
            />
          </div>
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            {DIAGNOSTICS_DISCLOSURE.detail}
          </p>
        </section>

        <div className="flex flex-wrap gap-3 border-t border-surface-border pt-6 dark:border-surface-border-dark">
          <Button variant="primary" onClick={() => save(selection)}>
            Save my choices
          </Button>
          <Button variant="secondary" onClick={closePanel}>
            Cancel
          </Button>
        </div>

        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          More detail is on the{' '}
          <Link
            to="/legal/cookies"
            className="rounded font-medium text-primary-ink underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-primary-ink-dark"
          >
            Cookie Notice
          </Link>{' '}
          and the{' '}
          <Link
            to="/legal/privacy"
            className="rounded font-medium text-primary-ink underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-primary-ink-dark"
          >
            Privacy Notice
          </Link>
          .
        </p>
      </div>
    </Modal>
  );
}
