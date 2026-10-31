import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { allFlags, authFile, ROOT, signIn } from './support';

/**
 * The production Content-Security-Policy from `.htaccess`, applied to a production build (`scripts/walk.sh preview`, port
 * 5041) while the app is used. The only change to the policy is the Clerk host: the walk signs in on the DEVELOPMENT instance,
 * whose frontend API is the `*.clerk.accounts.dev` host in its publishable key, where production uses clerk.rotaflow.space.
 * Skipped unless the preview server is up (WALK_PREVIEW_URL, default http://localhost:5041).
 */
const PREVIEW = process.env['WALK_PREVIEW_URL'] ?? 'http://localhost:5041';
const DEV_CLERK = 'https://discrete-walrus-17.clerk.accounts.dev';

function productionCsp(): string {
  const htaccess = readFileSync(path.join(ROOT, '.htaccess'), 'utf8');
  const m = /Header set Content-Security-Policy "([^"]+)"/.exec(htaccess);
  if (!m?.[1]) throw new Error('no Content-Security-Policy in .htaccess');
  return m[1].replaceAll('https://clerk.rotaflow.space', DEV_CLERK);
}

async function withCsp(page: Page): Promise<string[]> {
  const csp = productionCsp();
  const violations: string[] = [];
  await page.route(`${PREVIEW}/**`, async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'content-security-policy': csp },
    });
  });
  // Reported straight back to the test, so a violation on any page of a walk is kept across navigations.
  await page.exposeFunction('__walkCsp', (line: string) => violations.push(line));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      void (window as unknown as { __walkCsp: (l: string) => Promise<void> }).__walkCsp(
        `${e.violatedDirective} ${e.blockedURI} (${location.pathname})`,
      );
    });
  });
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text()))
      violations.push(m.text().slice(0, 300));
  });
  return violations;
}

function collected(violations: string[]): string[] {
  return [...new Set(violations)];
}

test.describe('production CSP on a production build', () => {
  test.beforeAll(async ({ request }) => {
    const up = await request
      .get(`${PREVIEW}/`)
      .then((r) => r.ok())
      .catch(() => false);
    test.skip(!up, `no preview server at ${PREVIEW} (scripts/walk.sh preview)`);
  });
  test.afterAll(() => allFlags(false));

  test('signing in through Clerk raises no violation', async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: PREVIEW });
    const page = await ctx.newPage();
    const v = await withCsp(page);
    await signIn(page, 'manager');
    await page.waitForTimeout(1500);
    expect(collected(v)).toEqual([]);
    await ctx.close();
  });

  for (const flags of ['off', 'on'] as const) {
    test(`the owner's screens raise no violation, flags ${flags}`, async ({
      browser,
    }) => {
      allFlags(flags === 'on');
      const ctx = await browser.newContext({
        baseURL: PREVIEW,
        storageState: authFile('owner'),
      });
      const page = await ctx.newPage();
      const v = await withCsp(page);
      for (const url of [
        '/app/dashboard',
        '/app/rota',
        '/app/timesheets',
        '/app/compliance',
        '/app/cover',
        '/app/reports',
        '/app/settings/organisation',
        '/app/account/security',
      ]) {
        await page.goto(url);
        await page
          .waitForLoadState('networkidle', { timeout: 15_000 })
          .catch(() => undefined);
        expect(page.url(), 'still signed in on the preview origin').toContain(url);
      }
      expect(collected(v)).toEqual([]);
      await ctx.close();
    });
  }

  test('the public pages raise no violation', async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: PREVIEW });
    const page = await ctx.newPage();
    const v = await withCsp(page);
    for (const url of ['/', '/pricing', '/contact', '/login', '/signup']) {
      await page.goto(url);
      await page
        .waitForLoadState('networkidle', { timeout: 15_000 })
        .catch(() => undefined);
    }
    expect(collected(v)).toEqual([]);
    await ctx.close();
  });
});
