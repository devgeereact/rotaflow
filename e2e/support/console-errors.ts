import type { Page } from '@playwright/test';

/**
 * Collects uncaught page errors and `console.error` calls for the lifetime of
 * a test. A page that renders correctly but is quietly throwing in an effect
 * (a common way a real bug hides behind a screenshot that looks fine) shows
 * up here even though nothing in the DOM assertion would have caught it.
 *
 * Call this before navigating, then assert the returned array is empty at
 * the end of the test.
 */
export function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  return errors;
}
