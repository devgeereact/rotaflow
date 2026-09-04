/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  EVERYTHING_ALLOWED,
  NOTHING_ALLOWED,
  clearConsent,
  forgetCategoryStorage,
  readConsent,
  writeConsent,
  type ConsentCategory,
  type ConsentRecord,
  type ConsentSelection,
} from '@/lib/consent';
import { disableSentry, initSentry } from '@/lib/sentry';

interface ConsentContextValue {
  /** The stored decision, or null when the visitor has not made one. */
  record: ConsentRecord | null;
  /** True while the banner should be showing. */
  needsDecision: boolean;
  /** True while the granular panel is open. */
  panelOpen: boolean;
  allows: (category: ConsentCategory) => boolean;
  acceptAll: () => void;
  rejectAll: () => void;
  save: (selection: ConsentSelection) => void;
  openPanel: () => void;
  closePanel: () => void;
  /** Reopen the whole question, from the footer or account preferences. */
  reopen: () => void;
}

const ConsentContext = createContext<ConsentContextValue | null>(null);

/** Every key this browser holds, so prefixed report entries can be found. */
function allStorageKeys(): string[] {
  try {
    return Object.keys(globalThis.localStorage ?? {});
  } catch {
    return [];
  }
}

/**
 * Holds the consent decision for the session and applies its consequences.
 *
 * Two of them are not just bookkeeping. Granting `diagnostics` starts Sentry
 * mid-session, because a visitor who agrees should not have to reload before
 * a crash is reported; withdrawing it closes the client and — for
 * `preferences` — deletes the keys that category had already written. A
 * withdrawal that only stops the next write leaves the previous ones sitting
 * on the device, which is not what "no" means.
 *
 * Mounted above the router in `src/App.tsx` so the public pages and the
 * signed-in app share one decision.
 */
export function ConsentProvider({ children }: { children: ReactNode }): JSX.Element {
  const [record, setRecord] = useState<ConsentRecord | null>(() => readConsent());
  const [panelOpen, setPanelOpen] = useState(false);

  const apply = useCallback((selection: ConsentSelection): void => {
    const next = writeConsent(selection);
    setRecord(next);
    setPanelOpen(false);

    if (next.diagnostics) {
      initSentry();
    } else {
      disableSentry();
    }

    if (!next.preferences) {
      forgetCategoryStorage('preferences', undefined, allStorageKeys());
    }
  }, []);

  const acceptAll = useCallback(() => apply(EVERYTHING_ALLOWED), [apply]);
  const rejectAll = useCallback(() => apply(NOTHING_ALLOWED), [apply]);

  const reopen = useCallback(() => {
    clearConsent();
    setRecord(null);
    setPanelOpen(true);
  }, []);

  const allows = useCallback(
    (category: ConsentCategory): boolean => {
      if (category === 'necessary') return true;
      return record === null ? false : record[category];
    },
    [record],
  );

  const value = useMemo<ConsentContextValue>(
    () => ({
      record,
      needsDecision: record === null,
      panelOpen,
      allows,
      acceptAll,
      rejectAll,
      save: apply,
      openPanel: () => setPanelOpen(true),
      closePanel: () => setPanelOpen(false),
      reopen,
    }),
    [record, panelOpen, allows, acceptAll, rejectAll, apply, reopen],
  );

  return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>;
}

export function useConsent(): ConsentContextValue {
  const ctx = useContext(ConsentContext);
  if (ctx === null) {
    throw new Error('useConsent must be used within a <ConsentProvider>.');
  }
  return ctx;
}
