import { expect, test, type Page } from '@playwright/test';
import { trackConsoleErrors } from './support/console-errors';

/**
 * A staff member signs in and reaches their own dashboard.
 *
 * ## What was missing
 *
 * Every other authenticated spec here signs in as the person who founded the
 * organisation, so every one of them takes the manager branch of
 * `/app/dashboard`. The staff branch was rendered only through
 * `/dashboard-preview?role=staff`, which mounts `StaffDashboard` directly
 * against a fixture — so it never exercised `DashboardPage`, and nothing in
 * CI ever loaded the screen a staff member actually lands on.
 *
 * It was broken. `DashboardPage` issues two overlapping loads on mount (the
 * `load` callback changes identity once the organisation resolves), and the
 * superseded one cleared `loading` in its `finally` while the live request
 * was still fetching. The manager branch tolerated that — every one of its
 * props has a null fallback — but the staff branch was handed
 * `overview={overview!}`, and a non-null assertion is not a null check. The
 * result was `Cannot read properties of null (reading 'locations')`, caught
 * by the top-level `ErrorBoundary`, so a staff member signing in saw
 * "Something went wrong" and no application at all.
 *
 * This asserts the screen renders and that nothing threw. Both halves matter:
 * the error boundary means a crash still produces a page, so a DOM assertion
 * alone would not have failed.
 *
 * ## Why it is skipped unless CI says otherwise
 *
 * It needs a Supabase stack on localhost and its service-role key: a staff
 * account cannot be created through the UI without going through an
 * invitation, which is a different journey and not the subject here. Running
 * it against a developer's `.env` would point it at PRODUCTION, so it refuses
 * to run without `E2E_LIVE_SUPABASE` and `E2E_SERVICE_ROLE_KEY`, which only
 * the `e2e-authenticated` job sets, after `supabase start`.
 */
const LIVE = process.env.E2E_LIVE_SUPABASE === '1';
const SERVICE_KEY = process.env.E2E_SERVICE_ROLE_KEY ?? '';
const API_URL = process.env.VITE_SUPABASE_URL ?? '';

async function seed<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`seed ${path} failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

async function createConfirmedUser(email: string, password: string): Promise<string> {
  const response = await fetch(`${API_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name: 'Sam', last_name: 'Staffer' },
    }),
  });
  if (!response.ok) {
    throw new Error(`create user failed: ${response.status} ${await response.text()}`);
  }
  return ((await response.json()) as { id: string }).id;
}

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  const token = page.waitForRequest((request) =>
    request.url().includes('/auth/v1/token'),
  );
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const origin = new URL((await token).url()).origin;
  expect(
    origin,
    `the app signed in against ${origin} but the fixture was seeded into ${API_URL} — a stale dev server is being reused`,
  ).toBe(new URL(API_URL).origin);
  await page.waitForURL(/\/app\/dashboard/, { timeout: 60_000 });
}

test.describe('a staff member on their own dashboard', () => {
  test.skip(
    !LIVE || SERVICE_KEY === '',
    'needs a local Supabase stack and its service-role key — see e2e-authenticated in ci.yml',
  );

  test('lands on the staff dashboard rather than an error boundary', async ({ page }) => {
    test.setTimeout(180_000);

    const stamp = Date.now();
    const email = `e2e-staff-${stamp}@example.test`;
    const password = `E2e-${stamp}-Passw0rd`;

    const errors = trackConsoleErrors(page);

    // `created_by: null` is the platform-admin creation path, which
    // `limit_org_creation()` exempts from the self-serve rate limit — the same
    // reason `platform-console.spec.ts` seeds its tenants that way.
    const rows = await seed<{ id: string }[]>('organisations', {
      name: `E2E Staff Home ${stamp}`,
      slug: `e2e-staff-home-${stamp}`,
      country: 'GB',
      timezone: 'Europe/London',
      created_by: null,
    });
    const org = rows[0];
    if (!org) throw new Error('the organisation fixture returned no row');
    await seed('locations', {
      org_id: org.id,
      name: 'Northgate House',
      timezone: 'Europe/London',
    });

    const userId = await createConfirmedUser(email, password);
    await seed('memberships', {
      org_id: org.id,
      user_id: userId,
      role: 'staff',
      status: 'active',
    });
    await seed('staff_profiles', {
      org_id: org.id,
      user_id: userId,
      first_name: 'Sam',
      last_name: 'Staffer',
      email,
      active: true,
    });

    await signIn(page, email, password);

    // The staff branch, not the operations board: an owner or manager gets
    // "Operations" here, so this heading is what says the right dashboard
    // rendered for the right role.
    await expect(page.getByRole('heading', { name: /Good morning/ })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByRole('heading', { name: 'Your next shifts' })).toBeVisible();
    await expect(page.getByText('Something went wrong')).toHaveCount(0);

    // The screen is allowed to render and still be broken underneath: the
    // crash this guards against was caught by the top-level ErrorBoundary,
    // which produces a perfectly valid page.
    expect(
      errors,
      `console output during the staff dashboard load:\n${errors.join('\n')}`,
    ).toEqual([]);
  });
});
