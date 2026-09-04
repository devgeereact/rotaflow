/**
 * Whether to offer the install banner, and for how long "no" lasts.
 *
 * The banner had no dismiss control at all — its own doc comment called it
 * "dismissible" — so the only ways out were installing the app or navigating
 * to a page where `beforeinstallprompt` had not fired. It also rendered on the
 * marketing pages, which asks a first-time visitor to install software for a
 * product they have not signed up for, in front of the copy meant to persuade
 * them to.
 *
 * A dismissal is stored per device rather than per account: the question is
 * "do you want this app on THIS phone", which the account cannot answer, and a
 * shared ward tablet must not carry one nurse's answer to the next.
 *
 * It expires. A permanent no means somebody who declined once on a borrowed
 * laptop is never offered it on their own; thirty days is long enough not to
 * nag and short enough that the offer comes back when the habit has formed.
 */

const SNOOZE_KEY = 'rotaflow:installPromptSnoozedUntil';

export const INSTALL_SNOOZE_DAYS = 30;

/**
 * The store to read and write.
 *
 * Passed in rather than reached for, so these two functions stay pure and
 * testable in the Node environment the rest of `src/lib` runs in — the suite
 * is deliberately DOM-free (`vitest.config.ts`), and a storage helper is not
 * a good enough reason to make 800 tests construct a document.
 *
 * `localStorage` is also genuinely absent in some real contexts: an opaque
 * origin, a browser set to block site data, and some private modes, where the
 * property throws on access rather than returning null.
 */
export type SnoozeStore = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStore(): SnoozeStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function isInstallSnoozed(
  now: Date = new Date(),
  store: SnoozeStore | null = defaultStore(),
): boolean {
  let until: string | null = null;
  try {
    until = store?.getItem(SNOOZE_KEY) ?? null;
  } catch {
    return false;
  }
  if (!until) return false;
  const parsed = Date.parse(until);
  // A corrupt value is treated as "not snoozed" rather than "snoozed forever":
  // the failure that hides a feature permanently is the worse of the two.
  if (Number.isNaN(parsed)) return false;
  return parsed > now.getTime();
}

export function snoozeInstall(
  now: Date = new Date(),
  store: SnoozeStore | null = defaultStore(),
): void {
  const until = new Date(now.getTime() + INSTALL_SNOOZE_DAYS * 24 * 60 * 60 * 1000);
  try {
    store?.setItem(SNOOZE_KEY, until.toISOString());
  } catch {
    // Storage full or blocked. The banner reappearing is a worse outcome than
    // nothing, but not one worth breaking the click over.
  }
}

/**
 * Where the banner is allowed to appear.
 *
 * Inside the product only. Somebody reading the pricing page is deciding
 * whether to sign up, not where to keep the icon.
 */
export function isInstallSurface(pathname: string): boolean {
  return pathname.startsWith('/app') || pathname.startsWith('/onboarding');
}
