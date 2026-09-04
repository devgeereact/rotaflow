/**
 * Test-only stand-in for `virtual:pwa-register`.
 *
 * VitePWA generates that module during a build; `vitest.config.ts` does not
 * load VitePWA, so the import has nothing to resolve to and any component that
 * registers the service worker cannot be rendered in a test at all. Aliasing it
 * here gives `vi.mock` a real module to replace.
 *
 * Nothing outside a test should import this. If it is ever reached unmocked,
 * the no-op below is the honest behaviour: no service worker exists in jsdom.
 */
export function registerSW(_options?: {
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
  onRegisteredSW?: (url: string, registration?: ServiceWorkerRegistration) => void;
  onRegisterError?: (error: unknown) => void;
}): (reloadPage?: boolean) => Promise<void> {
  return () => Promise.resolve();
}
