/**
 * Shown while a lazily-loaded route chunk is fetched.
 *
 * Deliberately quiet, a spinner, not a skeleton or a branded splash. It sits
 * inside AppShell's `<main>`, so the sidebar, header and org context are
 * already on screen and the chrome must not appear to reload. On a warm cache
 * (which is every load after the first, since the service worker precaches
 * every chunk) this is on screen for a frame or two; anything louder would
 * flash.
 */
export function RouteFallback(): JSX.Element {
  return (
    <div
      // Announced politely rather than assertively: this is a transient
      // loading state, not something that should interrupt what a screen
      // reader is currently saying.
      role="status"
      aria-live="polite"
      className="grid min-h-[40vh] place-items-center"
    >
      <span
        className="h-6 w-6 animate-spin rounded-full border-2 border-surface-border border-t-primary dark:border-surface-border-dark dark:border-t-primary"
        aria-hidden="true"
      />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
