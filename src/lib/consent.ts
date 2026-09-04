/**
 * What a visitor has agreed this browser may keep, and what that gates.
 *
 * ## Why this exists, and the argument against it
 *
 * `docs/SAAS.md` CAP-058 recorded a reasoned decision against a consent
 * banner, and `src/pages/legal/CookiesPage.tsx` published the reasoning: no
 * cookies, no analytics, nothing that tracks anybody, so a banner would be
 * theatre. That was true of everything the page listed — and false about
 * something it did not list. `src/lib/sentry.ts` was starting Sentry session
 * replay and performance tracing on every route, including the marketing
 * pages, before anybody had agreed to anything. Replay and tracing are gone
 * now, so the page's claim is true again.
 *
 * What is left is genuinely small: four interface preferences and crash
 * reporting. The owner asked for the banner anyway, so it is built properly
 * rather than half-built: an equal accept and reject, nothing pre-selected,
 * and a decision that can be changed later from the footer or from account
 * preferences.
 *
 * ## The rule the rest of the code follows
 *
 * Nothing optional writes to the device until `isAllowed` says so. The gate is
 * in the write path, not in the banner — a banner that merely covers the page
 * stops nothing, and a user who ignores it must still be left untouched. Every
 * failure mode reads as "not decided, nothing allowed": absent record, corrupt
 * JSON, a `localStorage` that throws, or a record written against an older
 * version of this list.
 */

export type ConsentCategory = 'necessary' | 'preferences' | 'diagnostics';

/**
 * Bumped whenever a category changes meaning or a new optional store appears.
 * An old record is treated as no record, so the choice is asked again rather
 * than assumed to cover something the person never saw.
 */
export const CONSENT_VERSION = 1;

export const CONSENT_STORAGE_KEY = 'rotaflow:consent';

/** The optional categories. `necessary` is not here because it is not a choice. */
export interface ConsentSelection {
  preferences: boolean;
  diagnostics: boolean;
}

export interface ConsentRecord extends ConsentSelection {
  version: number;
  /** ISO timestamp. The minimum evidence a decision was made, and when. */
  decidedAt: string;
}

/** What an undecided visitor gets: nothing optional. */
export const NOTHING_ALLOWED: ConsentSelection = Object.freeze({
  preferences: false,
  diagnostics: false,
});

export const EVERYTHING_ALLOWED: ConsentSelection = Object.freeze({
  preferences: true,
  diagnostics: true,
});

/**
 * The store to read and write, passed in rather than reached for.
 *
 * `src/lib` is tested in a DOM-free Node environment (`vitest.config.ts`), and
 * `localStorage` is genuinely absent or throwing in real contexts too: an
 * opaque origin, a browser set to block site data, some private modes. Same
 * pattern as `src/lib/installPrompt.ts`, for the same reason.
 */
export type ConsentStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStore(): ConsentStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * The device keys each optional category owns.
 *
 * Withdrawing a category deletes these, so "I changed my mind" removes what
 * was already written rather than only stopping the next write. Entries ending
 * in `:` are prefixes — report preferences are stored one key per organisation
 * (`src/lib/reportPrefs.ts`), so there is no single name to remove.
 */
export const CATEGORY_KEYS: Record<keyof ConsentSelection, readonly string[]> = {
  preferences: [
    'pwa-theme',
    'rotaflow.sidebar.collapsed',
    'rotaflow:installPromptSnoozedUntil',
    'rotaflow:report-favourites:',
    'rotaflow:report-runs:',
  ],
  diagnostics: [],
};

function isSelection(value: unknown): value is ConsentRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === CONSENT_VERSION &&
    typeof candidate.decidedAt === 'string' &&
    typeof candidate.preferences === 'boolean' &&
    typeof candidate.diagnostics === 'boolean'
  );
}

/**
 * The stored decision, or `null` when there is not one this version can trust.
 *
 * A record from an older `CONSENT_VERSION` returns `null` on purpose: it was a
 * decision about a different list.
 */
export function readConsent(
  store: ConsentStore | null = defaultStore(),
): ConsentRecord | null {
  let raw: string | null = null;
  try {
    raw = store?.getItem(CONSENT_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isSelection(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function hasDecided(store: ConsentStore | null = defaultStore()): boolean {
  return readConsent(store) !== null;
}

/** What is permitted right now. `necessary` is always true and never asked about. */
export function isAllowed(
  category: ConsentCategory,
  store: ConsentStore | null = defaultStore(),
): boolean {
  if (category === 'necessary') return true;
  const record = readConsent(store);
  return record === null ? false : record[category];
}

export function writeConsent(
  selection: ConsentSelection,
  store: ConsentStore | null = defaultStore(),
  now: Date = new Date(),
): ConsentRecord {
  const record: ConsentRecord = {
    version: CONSENT_VERSION,
    decidedAt: now.toISOString(),
    preferences: selection.preferences,
    diagnostics: selection.diagnostics,
  };
  try {
    store?.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // A browser that will not store the decision cannot store what the
    // decision permits either, so the safe reading is unchanged: nothing
    // optional is written, and the banner asks again next time.
  }
  return record;
}

/** Used by the "change your mind" control and by tests. */
export function clearConsent(store: ConsentStore | null = defaultStore()): void {
  try {
    store?.removeItem(CONSENT_STORAGE_KEY);
  } catch {
    // Nothing to do: an unreadable store already reads as undecided.
  }
}

/**
 * Remove what a withdrawn category had already written.
 *
 * `allKeys` is how prefixed entries are found; callers in the browser pass
 * `Object.keys(localStorage)`. Missing it means only the exact names go, which
 * is the safe half rather than a silent no-op.
 */
export function forgetCategoryStorage(
  category: keyof ConsentSelection,
  store: ConsentStore | null = defaultStore(),
  allKeys: readonly string[] = [],
): void {
  if (store === null) return;
  const owned = CATEGORY_KEYS[category];
  const exact = owned.filter((key) => !key.endsWith(':'));
  const prefixes = owned.filter((key) => key.endsWith(':'));
  const matched = allKeys.filter((key) =>
    prefixes.some((prefix) => key.startsWith(prefix)),
  );
  for (const key of [...exact, ...matched]) {
    try {
      store.removeItem(key);
    } catch {
      // Best effort. One key that will not delete must not strand the rest.
    }
  }
}
