import { describe, expect, it } from 'vitest';
import {
  CATEGORY_KEYS,
  CONSENT_STORAGE_KEY,
  CONSENT_VERSION,
  EVERYTHING_ALLOWED,
  NOTHING_ALLOWED,
  clearConsent,
  forgetCategoryStorage,
  hasDecided,
  isAllowed,
  readConsent,
  writeConsent,
  type ConsentStore,
} from '@/lib/consent';

/** A `localStorage` stand-in, because `src/lib` is tested without a DOM. */
function memoryStore(initial: Record<string, string> = {}): ConsentStore & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

/** The contexts where the property itself throws: opaque origins, blocked site data. */
function throwingStore(): ConsentStore {
  return {
    getItem: () => {
      throw new Error('site data blocked');
    },
    setItem: () => {
      throw new Error('site data blocked');
    },
    removeItem: () => {
      throw new Error('site data blocked');
    },
  };
}

describe('readConsent', () => {
  it('returns null when nothing has been decided', () => {
    expect(readConsent(memoryStore())).toBeNull();
    expect(hasDecided(memoryStore())).toBe(false);
  });

  it('reads back what was written', () => {
    const store = memoryStore();
    writeConsent({ preferences: true, diagnostics: false }, store);
    expect(readConsent(store)).toMatchObject({
      version: CONSENT_VERSION,
      preferences: true,
      diagnostics: false,
    });
  });

  it('treats corrupt JSON as undecided rather than as consent', () => {
    const store = memoryStore({ [CONSENT_STORAGE_KEY]: '{not json' });
    expect(readConsent(store)).toBeNull();
    expect(isAllowed('preferences', store)).toBe(false);
    expect(isAllowed('diagnostics', store)).toBe(false);
  });

  it('treats a record shaped wrongly as undecided', () => {
    const store = memoryStore({
      [CONSENT_STORAGE_KEY]: JSON.stringify({
        version: CONSENT_VERSION,
        preferences: 'yes',
      }),
    });
    expect(readConsent(store)).toBeNull();
  });

  it('asks again when the version has moved on', () => {
    const store = memoryStore({
      [CONSENT_STORAGE_KEY]: JSON.stringify({
        version: CONSENT_VERSION - 1,
        decidedAt: '2026-09-01T00:00:00.000Z',
        preferences: true,
        diagnostics: true,
      }),
    });
    expect(readConsent(store)).toBeNull();
    expect(isAllowed('diagnostics', store)).toBe(false);
  });

  it('reads as undecided when the store throws', () => {
    const store = throwingStore();
    expect(readConsent(store)).toBeNull();
    expect(isAllowed('preferences', store)).toBe(false);
  });

  it('reads as undecided when there is no store at all', () => {
    expect(readConsent(null)).toBeNull();
    expect(isAllowed('diagnostics', null)).toBe(false);
  });
});

describe('isAllowed', () => {
  it('always permits necessary storage, decided or not', () => {
    expect(isAllowed('necessary', memoryStore())).toBe(true);
    expect(isAllowed('necessary', throwingStore())).toBe(true);
  });

  it('permits only what was selected', () => {
    const store = memoryStore();
    writeConsent({ preferences: false, diagnostics: true }, store);
    expect(isAllowed('preferences', store)).toBe(false);
    expect(isAllowed('diagnostics', store)).toBe(true);
  });
});

describe('writeConsent', () => {
  it('records a rejection and nothing else', () => {
    const store = memoryStore();
    writeConsent(NOTHING_ALLOWED, store);
    expect(Object.keys(store.data)).toEqual([CONSENT_STORAGE_KEY]);
    expect(readConsent(store)).toMatchObject({ preferences: false, diagnostics: false });
  });

  it('stamps the decision with a time', () => {
    const store = memoryStore();
    const at = new Date('2026-09-04T10:00:00.000Z');
    expect(writeConsent(EVERYTHING_ALLOWED, store, at).decidedAt).toBe(
      '2026-09-04T10:00:00.000Z',
    );
  });

  it('does not throw when the store refuses to write', () => {
    expect(() => writeConsent(EVERYTHING_ALLOWED, throwingStore())).not.toThrow();
  });
});

describe('clearConsent', () => {
  it('returns the browser to undecided', () => {
    const store = memoryStore();
    writeConsent(EVERYTHING_ALLOWED, store);
    clearConsent(store);
    expect(hasDecided(store)).toBe(false);
  });
});

describe('forgetCategoryStorage', () => {
  it('removes the exact keys the category owns', () => {
    const store = memoryStore({
      'pwa-theme': 'dark',
      'rotaflow.sidebar.collapsed': 'true',
      'rotaflow:installPromptSnoozedUntil': '2026-10-01T00:00:00.000Z',
      [CONSENT_STORAGE_KEY]: 'keep me',
    });
    forgetCategoryStorage('preferences', store);
    expect(Object.keys(store.data)).toEqual([CONSENT_STORAGE_KEY]);
  });

  it('removes prefixed report keys when it is told what exists', () => {
    const store = memoryStore({
      'rotaflow:report-favourites:org-1': '[]',
      'rotaflow:report-runs:org-1': '[]',
      'rotaflow:activeOrgId': 'org-1',
    });
    forgetCategoryStorage('preferences', store, Object.keys(store.data));
    expect(Object.keys(store.data)).toEqual(['rotaflow:activeOrgId']);
  });

  it('leaves necessary storage alone', () => {
    const store = memoryStore({ 'rotaflow:activeOrgId': 'org-1', 'pwa-theme': 'dark' });
    forgetCategoryStorage('preferences', store, Object.keys(store.data));
    expect(store.data['rotaflow:activeOrgId']).toBe('org-1');
  });

  it('does nothing without a store', () => {
    expect(() => forgetCategoryStorage('preferences', null)).not.toThrow();
  });
});

describe('CATEGORY_KEYS', () => {
  it('names every preference key the app writes', () => {
    // If a new optional store appears, it belongs here and CONSENT_VERSION moves.
    expect(CATEGORY_KEYS.preferences).toEqual([
      'pwa-theme',
      'rotaflow.sidebar.collapsed',
      'rotaflow:installPromptSnoozedUntil',
      'rotaflow:report-favourites:',
      'rotaflow:report-runs:',
    ]);
  });

  it('owns no device key for diagnostics, which is a network gate not a store', () => {
    expect(CATEGORY_KEYS.diagnostics).toEqual([]);
  });
});
