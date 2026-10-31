import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';

/** Who signs in. Every address is a Clerk test-mode address on the DEVELOPMENT instance (code 424242). */
export const ROLES = ['owner', 'manager', 'staff', 'admin', 'noorg'] as const;
export type Role = (typeof ROLES)[number];
export const email = (role: Role | 'staff2'): string => `${role}+clerk_test@example.com`;
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const authFile = (role: Role | 'staff2'): string =>
  path.join(ROOT, '.local-state', 'walk-auth', `${role}.json`);

export const FLAGS = [
  'staff_documents',
  'scheduling_tools',
  'cover_tools',
  'timesheet_tools',
  'two_way_swaps',
] as const;
export type Flag = (typeof FLAGS)[number];

/** Turns an R2 flag on or off in the LOCAL walk database (scripts/walk.sh flag). */
export function setFlag(flag: Flag, on: boolean): void {
  execFileSync(path.join(ROOT, 'scripts', 'walk.sh'), ['flag', flag, on ? 'on' : 'off'], {
    stdio: 'ignore',
  });
}
export function allFlags(on: boolean): void {
  for (const f of FLAGS) setFlag(f, on);
}

/** One value from the LOCAL walk database (throwaway MariaDB, root over its socket). */
export function sql(query: string): string {
  return execFileSync(
    'mariadb',
    [
      '--no-defaults',
      `--socket=${path.join(ROOT, '.local-test', 'mariadb', 'mysqld.sock')}`,
      '-uroot',
      '-N',
      '-B',
      'rotaflow_walk',
      '-e',
      query,
    ],
    { encoding: 'utf8' },
  ).trim();
}

/** Calls the API from inside the signed-in page with the person's own Clerk session token (what the app itself sends). */
export async function apiAs(
  page: Page,
  method: 'GET' | 'POST',
  apiPath: string,
  body?: unknown,
): Promise<{
  status: number;
  json: unknown;
  headers: Record<string, string>;
  text: string;
}> {
  await page.waitForFunction(
    () =>
      Boolean((window as unknown as { Clerk?: { session?: unknown } }).Clerk?.session),
    null,
    {
      timeout: 20_000,
    },
  );
  return page.evaluate(
    async ([m, p, b]) => {
      const clerk = (
        window as unknown as { Clerk: { session: { getToken: () => Promise<string> } } }
      ).Clerk;
      const token = await clerk.session.getToken();
      const r = await fetch(`/api${p}`, {
        method: m,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(b === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(b === undefined ? {} : { body: JSON.stringify(b) }),
      });
      // ignoreBOM keeps a byte-order mark in the text, so a test can see it (response.text() drops it).
      const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(
        await r.arrayBuffer(),
      );
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* not JSON (a file) */
      }
      const headers: Record<string, string> = {};
      r.headers.forEach((v, k) => {
        headers[k] = v;
      });
      return { status: r.status, json, headers, text };
    },
    [method, apiPath, body] as const,
  );
}

/** The demo organisation's id. */
export function orgId(): string {
  return sql("SELECT id FROM organisations WHERE slug = 'demo-care-group'");
}

/** Signs in through Clerk's own form with the test-mode code. */
export async function signIn(page: Page, who: Role | 'staff2'): Promise<void> {
  await page.goto('/login');
  await page.locator('input[name="identifier"]').fill(email(who));
  // Type the code only once Clerk has asked for it to be sent, or the attempt races the request ("send a code first").
  const prepared = page.waitForResponse(
    (r) => r.url().includes('/prepare_first_factor'),
    { timeout: 20_000 },
  );
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await prepared;
  const otp = page
    .locator('input[autocomplete="one-time-code"], input[name="code"]')
    .first();
  await otp.waitFor({ timeout: 20_000 });
  await otp.click();
  await page.keyboard.type('424242', { delay: 40 });
  await page.waitForURL(/\/(app|admin|onboarding)/, { timeout: 30_000 });
}

/** What went wrong while a screen was open. */
export interface Problems {
  console: string[];
  api: string[];
}

/** Text that only appears when a screen failed to load its data or crashed. */
export const FAILURE_TEXT =
  /We could not load|Something went wrong|Could not load|couldn't load|Failed to load|Unexpected Application Error|is not a function|Cannot read properties|undefined is not|NaN/;

/** Console noise that is not the app's: Clerk's development-instance banner, and the browser's resource line for an allowed API status. */
const NOISE = [
  /Clerk has been loaded with development keys/i,
  /Failed to load resource: the server responded with a status of (401|403|404|409|422)/,
];

/** Collects console errors, uncaught page errors and failed API calls while a screen is open. */
export function watch(page: Page): { problems: Problems; stop: () => void } {
  const problems: Problems = { console: [], api: [] };
  const onConsole = (m: { type(): string; text(): string }): void => {
    if (m.type() === 'error') problems.console.push(m.text().slice(0, 400));
  };
  const onPageError = (e: Error): void => {
    problems.console.push(`pageerror: ${e.message}`.slice(0, 400));
  };
  const onResponse = (r: {
    url(): string;
    status(): number;
    request(): { method(): string };
  }): void => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/') && r.status() >= 400) {
      problems.api.push(
        `${r.status()} ${r.request().method()} ${u.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id')}`,
      );
    }
  };
  const onFailed = (r: {
    url(): string;
    failure(): { errorText: string } | null;
  }): void => {
    const u = new URL(r.url());
    if (
      u.pathname.startsWith('/api/') &&
      !/ERR_ABORTED/.test(r.failure()?.errorText ?? '')
    ) {
      problems.api.push(`failed ${u.pathname} ${r.failure()?.errorText ?? ''}`);
    }
  };
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('response', onResponse);
  page.on('requestfailed', onFailed);
  return {
    problems,
    stop: () => {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      page.off('response', onResponse);
      page.off('requestfailed', onFailed);
    },
  };
}

export interface VisitOptions {
  /** API failures the screen is expected to cause (a permission-denied path), e.g. /^403 GET \/api\/orgs\/:id\/staff$/. */
  allowApi?: RegExp[];
  /** Text the screen must show once loaded. */
  expectText?: RegExp;
  /** Where the screen should end up (a redirect for a role that may not see it). */
  expectUrl?: RegExp;
}

/**
 * Goes to a screen. Inside the signed-in app it navigates the way a click does (history + popstate, which React Router
 * follows), so a walk of forty screens costs one page load instead of forty dev-server reloads.
 */
export async function navigate(page: Page, url: string): Promise<void> {
  const here = page.url();
  const inApp =
    here.startsWith('http') && /^\/(app|admin)(\/|$)/.test(new URL(here).pathname);
  if (inApp && /^\/(app|admin)(\/|$)/.test(url)) {
    await page.evaluate((u) => {
      window.history.pushState({}, '', u);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, url);
  } else {
    await page.goto(url);
  }
}

/** Waits until no /api request has been in flight for 400 ms (polling screens never go "networkidle"). */
export async function settle(page: Page, maxMs = 12_000): Promise<void> {
  let inflight = 0;
  let quietSince = Date.now();
  const isApi = (r: { url(): string }): boolean =>
    new URL(r.url()).pathname.startsWith('/api/');
  const up = (r: { url(): string }): void => {
    if (isApi(r)) inflight++;
  };
  const down = (r: { url(): string }): void => {
    if (isApi(r)) {
      inflight = Math.max(0, inflight - 1);
      quietSince = Date.now();
    }
  };
  page.on('request', up);
  page.on('requestfinished', down);
  page.on('requestfailed', down);
  const start = Date.now();
  await page.waitForTimeout(800);
  while (Date.now() - start < maxMs && (inflight > 0 || Date.now() - quietSince < 400)) {
    await page.waitForTimeout(100);
  }
  page.off('request', up);
  page.off('requestfinished', down);
  page.off('requestfailed', down);
}

/** Opens a screen and checks it loaded without console errors, failed API calls or a failure message. */
export async function visitClean(
  page: Page,
  url: string,
  opts: VisitOptions = {},
): Promise<Problems> {
  const w = watch(page);
  await navigate(page, url);
  await page.waitForLoadState('domcontentloaded');
  // A cold page load first boots the app (Clerk, the session, the organisation); only then do the screen's own reads start.
  await page
    .waitForFunction(
      () =>
        Boolean(document.querySelector('main, h1')) &&
        !document.body.innerText.includes('Starting up RotaFlow'),
      null,
      { timeout: 30_000 },
    )
    .catch(() => undefined);
  await settle(page);
  w.stop();
  const consoleErrors = w.problems.console.filter((c) => !NOISE.some((n) => n.test(c)));
  const api = w.problems.api.filter((a) => !(opts.allowApi ?? []).some((r) => r.test(a)));
  const main = page.locator('main').first();
  const text =
    (await main.count()) > 0
      ? await main.innerText()
      : await page.locator('body').innerText();
  expect.soft(consoleErrors, `console errors on ${url}`).toEqual([]);
  expect.soft(api, `failed API calls on ${url}`).toEqual([]);
  expect.soft(text, `failure message on ${url}`).not.toMatch(FAILURE_TEXT);
  if (opts.expectText)
    expect.soft(text, `expected content on ${url}`).toMatch(opts.expectText);
  if (opts.expectUrl)
    expect.soft(page.url(), `where ${url} ends up`).toMatch(opts.expectUrl);
  return { console: consoleErrors, api };
}
