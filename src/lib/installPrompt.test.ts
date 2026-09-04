import { beforeEach, describe, expect, it } from 'vitest';
import {
  INSTALL_SNOOZE_DAYS,
  isInstallSnoozed,
  isInstallSurface,
  snoozeInstall,
  type SnoozeStore,
} from '@/lib/installPrompt';

/**
 * An in-memory `Storage`, rather than jsdom. The suite runs in Node by design
 * (`vitest.config.ts`), and a two-function storage helper is not a good enough
 * reason to construct a document — jsdom's default `about:blank` is an opaque
 * origin where `localStorage` is undefined anyway, so the DOM version of this
 * test would fail for a reason unrelated to the code.
 */
function memoryStore(initial: Record<string, string> = {}): SnoozeStore {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

let store: SnoozeStore;
beforeEach(() => {
  store = memoryStore();
});

describe('install prompt snooze', () => {
  it('is not snoozed before anybody dismisses it', () => {
    expect(isInstallSnoozed(new Date(), store)).toBe(false);
  });

  it('stays dismissed for the snooze window and comes back after it', () => {
    const dismissedAt = new Date('2026-09-03T09:00:00Z');
    snoozeInstall(dismissedAt, store);

    const day = 24 * 60 * 60 * 1000;
    expect(
      isInstallSnoozed(
        new Date(dismissedAt.getTime() + (INSTALL_SNOOZE_DAYS - 1) * day),
        store,
      ),
    ).toBe(true);
    // A permanent no means somebody who declined once on a borrowed laptop is
    // never offered it on their own device.
    expect(
      isInstallSnoozed(
        new Date(dismissedAt.getTime() + (INSTALL_SNOOZE_DAYS + 1) * day),
        store,
      ),
    ).toBe(false);
  });

  it('treats a corrupt value as not snoozed, never as snoozed forever', () => {
    const corrupt = memoryStore({ 'rotaflow:installPromptSnoozedUntil': 'not a date' });
    expect(isInstallSnoozed(new Date(), corrupt)).toBe(false);
  });

  it('survives storage being blocked entirely', () => {
    const blocked: SnoozeStore = {
      getItem: () => {
        throw new Error('The operation is insecure.');
      },
      setItem: () => {
        throw new Error('The operation is insecure.');
      },
    };
    expect(isInstallSnoozed(new Date(), blocked)).toBe(false);
    expect(() => snoozeInstall(new Date(), blocked)).not.toThrow();
  });
});

describe('install surface', () => {
  it('offers the banner inside the product', () => {
    expect(isInstallSurface('/app/dashboard')).toBe(true);
    expect(isInstallSurface('/app/clock')).toBe(true);
    expect(isInstallSurface('/onboarding')).toBe(true);
  });

  // Somebody reading the pricing page is deciding whether to sign up, not
  // where to keep the icon.
  it('does not interrupt the marketing site or the auth screens', () => {
    expect(isInstallSurface('/')).toBe(false);
    expect(isInstallSurface('/pricing')).toBe(false);
    expect(isInstallSurface('/legal/privacy')).toBe(false);
    expect(isInstallSurface('/login')).toBe(false);
    expect(isInstallSurface('/signup')).toBe(false);
  });
});
