import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { X } from 'lucide-react';
import { usePWAInstall } from '@/hooks/usePWAInstall';
import { isInstallSnoozed, isInstallSurface, snoozeInstall } from '@/lib/installPrompt';
import { isAllowed } from '@/lib/consent';
import { Button } from '@/components/ui/Button';

/**
 * Offers to install the PWA, inside the product only, and takes no for an
 * answer.
 *
 * Two things were wrong with the previous version, and its own doc comment
 * described it as "dismissible", which it was not:
 *
 *   * There was no dismiss control. The only ways out were installing the app
 *     or navigating somewhere `beforeinstallprompt` had not fired.
 *   * It rendered everywhere, including the marketing pages — asking a
 *     first-time visitor to install software for a product they have not
 *     signed up for, over the copy meant to persuade them to.
 *
 * The dismissal lasts thirty days rather than forever: see
 * `src/lib/installPrompt.ts` for why both halves of that are deliberate.
 */
export function InstallPrompt(): JSX.Element | null {
  const { isInstallable, promptInstall } = usePWAInstall();
  const { pathname } = useLocation();
  // Read once per mount. Reading in render would be a storage hit on every
  // re-render of every app screen, for a banner that is usually not shown.
  const [snoozed, setSnoozed] = useState(isInstallSnoozed);

  if (!isInstallable || snoozed || !isInstallSurface(pathname)) return null;

  return (
    <div className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md animate-fade-up items-center justify-between gap-4 rounded-2xl border border-surface-border bg-surface p-4 shadow-lg motion-reduce:animate-none dark:border-surface-border-dark dark:bg-surface-dark">
      <div>
        <p className="font-semibold text-content dark:text-content-dark">
          Install this app
        </p>
        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          Loads faster and works offline. It installs from the browser.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="sm" onClick={() => void promptInstall()}>
          Install
        </Button>
        <button
          type="button"
          onClick={() => {
            // Dismissing always works. Remembering it for thirty days is the
            // part that writes to the device, so it waits for consent; without
            // it the dismissal lasts for this session, which is still a
            // dismissal. Gated here rather than inside snoozeInstall so that
            // function stays pure and store-injectable for its own tests.
            if (isAllowed('preferences')) snoozeInstall();
            setSnoozed(true);
          }}
          className="rounded-lg p-2 text-content-muted hover:bg-surface-subtle hover:text-content dark:text-content-muted-dark dark:hover:bg-surface-subtle-dark dark:hover:text-content-dark"
          aria-label="Dismiss the install prompt"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
