import { expect, test, type Page } from '@playwright/test';

/**
 * A clock-in made with no signal, watched in a browser (GAP-050).
 *
 * `src/services/syncQueue.test.ts` covers the replay logic at module level with
 * forty-odd cases and `fake-indexeddb`. What nothing covered was the product:
 * a real page losing its connection, a real IndexedDB outbox, a real replay
 * against Postgres, and the case `docs/ARCHITECTURE.md#offline-and-pwa` calls
 * the worst one, **a write queued and then replayed after the session ended**.
 *
 * Two promises from that section are asserted here, each against the database
 * rather than the screen:
 *
 * - **Back online, it sends once.** Nothing reaches `clock_events` while the
 *   page is offline, exactly one row arrives after, and a second flush does
 *   not add another.
 * - **A session that ended while the write was queued waits for the same
 *   person.** A colleague signing in on the same phone does not send it (it is
 *   not theirs, plan S4 and GAP-042), and it sends the moment the person who
 *   made it signs back in.
 *
 * It runs against `npm run dev`, which has no service worker, on purpose: the
 * outbox is IndexedDB and application code, not the worker, and the dev server
 * is where the `e2e-authenticated` job already runs. It needs a Supabase stack
 * on localhost and its service-role key, and refuses to run without them for
 * the same reason `staff-dashboard.spec.ts` does: on a developer's `.env` it
 * would be pointed at production.
 */
const LIVE = process.env.E2E_LIVE_SUPABASE === '1';
const SERVICE_KEY = process.env.E2E_SERVICE_ROLE_KEY ?? '';
const API_URL = process.env.VITE_SUPABASE_URL ?? '';

const serviceHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

async function seed<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: { ...serviceHeaders, Prefer: 'return=representation' },
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
    headers: serviceHeaders,
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name: 'Offline', last_name: 'Tester' },
    }),
  });
  if (!response.ok) {
    throw new Error(`create user failed: ${response.status} ${await response.text()}`);
  }
  return ((await response.json()) as { id: string }).id;
}

/** How many clock events the database holds for one staff profile. */
async function clockEventCount(staffProfileId: string): Promise<number> {
  const response = await fetch(
    `${API_URL}/rest/v1/clock_events?select=id&staff_profile_id=eq.${staffProfileId}`,
    { headers: serviceHeaders },
  );
  if (!response.ok) {
    throw new Error(
      `read clock_events failed: ${response.status} ${await response.text()}`,
    );
  }
  return ((await response.json()) as unknown[]).length;
}

interface StaffFixture {
  email: string;
  password: string;
  profileId: string;
}

/** An organisation with one site, and `count` staff members who can clock in. */
async function seedOrganisation(stamp: number, count: number): Promise<StaffFixture[]> {
  // `created_by: null` is the platform-admin creation path, which
  // `limit_org_creation()` exempts from the self-serve rate limit.
  const [org] = await seed<{ id: string }[]>('organisations', {
    name: `E2E Offline ${stamp}`,
    slug: `e2e-offline-${stamp}`,
    country: 'GB',
    timezone: 'Europe/London',
    created_by: null,
  });
  if (!org) throw new Error('the organisation fixture returned no row');
  await seed('locations', {
    org_id: org.id,
    name: 'Northgate House',
    timezone: 'Europe/London',
  });

  const staff: StaffFixture[] = [];
  for (let i = 0; i < count; i += 1) {
    const email = `e2e-offline-${i}-${stamp}@example.test`;
    const password = `E2e-${i}-${stamp}-Passw0rd`;
    const userId = await createConfirmedUser(email, password);
    await seed('memberships', {
      org_id: org.id,
      user_id: userId,
      role: 'staff',
      status: 'active',
    });
    const [profile] = await seed<{ id: string }[]>('staff_profiles', {
      org_id: org.id,
      user_id: userId,
      first_name: 'Offline',
      last_name: `Tester ${i}`,
      email,
      active: true,
    });
    if (!profile) throw new Error('the staff profile fixture returned no row');
    staff.push({ email, password, profileId: profile.id });
  }
  return staff;
}

async function signIn(page: Page, who: StaffFixture): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(who.email);
  await page.getByLabel('Password', { exact: true }).fill(who.password);
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

/** Open the clock screen and wait until its actions are usable. */
async function openClock(page: Page): Promise<void> {
  await page.goto('/app/clock');
  await expect(page.getByRole('button', { name: 'Clock in manually' })).toBeVisible({
    timeout: 60_000,
  });
}

/**
 * Ends the session on this device without signing out.
 *
 * Signing out is the one transition the app handles deliberately; this is the
 * other kind, a refresh token that is simply no longer there, which is what an
 * expired or revoked session looks like to the browser. supabase-js keeps the
 * session under `sb-<ref>-auth-token`.
 */
async function dropSession(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
        window.localStorage.removeItem(key);
      }
    }
  });
}

test.describe('a clock-in made with no signal', () => {
  test.skip(
    !LIVE || SERVICE_KEY === '',
    'needs a local Supabase stack and its service-role key — see e2e-authenticated in ci.yml',
  );

  test('waits on the device and is sent exactly once when the signal returns', async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    const [me] = await seedOrganisation(Date.now(), 1);
    if (!me) throw new Error('no staff fixture');

    await signIn(page, me);
    await openClock(page);

    await context.setOffline(true);
    await expect(
      page.getByText(/You’re offline\. Clock actions are saved on this device/),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Clock in manually' }).click();
    await expect(page.getByText(/Clock in saved offline/)).toBeVisible();
    await expect(page.getByText('Offline, 1 waiting')).toBeVisible();

    // Nothing has left the device. Checked over the service role, which the
    // page's lost connection does not affect.
    expect(await clockEventCount(me.profileId)).toBe(0);

    await context.setOffline(false);
    await expect
      .poll(() => clockEventCount(me.profileId), {
        timeout: 30_000,
        message:
          'the queued clock-in never reached the database after the signal returned',
      })
      .toBe(1);
    await expect(page.getByText('Synced')).toBeVisible({ timeout: 30_000 });

    // Sent once means once. A reload triggers the on-mount flush; an outbox
    // that still held the write would replay it here, and only 0081's
    // idempotency key would stand between that and a second row.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
      timeout: 60_000,
    });
    await page.waitForTimeout(3_000);
    expect(await clockEventCount(me.profileId)).toBe(1);
  });

  test('a session that ends while it waits holds it for the same person, never a colleague', async ({
    page,
    context,
  }) => {
    test.setTimeout(240_000);
    const [owner, colleague] = await seedOrganisation(Date.now(), 2);
    if (!owner || !colleague) throw new Error('no staff fixtures');

    // ---- queued by the first person, then their session ends ------------
    await signIn(page, owner);
    await openClock(page);
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Clock in manually' }).click();
    await expect(page.getByText('Offline, 1 waiting')).toBeVisible();

    await dropSession(page);
    await context.setOffline(false);
    await page.goto('/app/dashboard');
    await page.waitForURL(/\/login/, { timeout: 60_000 });
    expect(
      await clockEventCount(owner.profileId),
      'the write was sent with no session at all',
    ).toBe(0);

    // ---- a colleague signs in on the same phone --------------------------
    await signIn(page, colleague);
    await openClock(page);
    // Long enough for every flush trigger (mount, reconnect, foreground) to
    // have fired at least once for the colleague.
    await page.waitForTimeout(5_000);
    expect(
      await clockEventCount(owner.profileId),
      'a colleague’s session replayed somebody else’s clock-in',
    ).toBe(0);
    expect(await clockEventCount(colleague.profileId)).toBe(0);
    await expect(page.getByText('Synced')).toBeVisible();

    // ---- the person who made it signs back in ----------------------------
    await dropSession(page);
    await signIn(page, owner);
    await expect
      .poll(() => clockEventCount(owner.profileId), {
        timeout: 30_000,
        message:
          'the queued clock-in was not sent when the person who made it signed back in',
      })
      .toBe(1);
  });

  test('opened cold with no signal, says what is missing and recovers on its own', async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    const [me] = await seedOrganisation(Date.now(), 1);
    if (!me) throw new Error('no staff fixture');

    await signIn(page, me);
    // The shell has to finish loading online first: going offline while the
    // organisation is still being read tests the shell's own boot, which is a
    // different screen ("Couldn’t load your organisations") and not this case.
    await expect(page.getByRole('heading', { name: 'Your next shifts' })).toBeVisible({
      timeout: 60_000,
    });
    // The dev server has no service worker, so a route chunk not yet fetched
    // cannot load offline here, though in a production build every chunk is
    // precached (`e2e/pwa-offline.spec.ts`). Fetching it once while online
    // stands in for the precache; the screen's DATA is still not loaded when
    // it is opened again below, which is the case under test.
    await page.locator('a[href="/app/clock"]').first().click();
    await expect(page.getByRole('button', { name: 'Clock in manually' })).toBeVisible({
      timeout: 60_000,
    });
    await page.locator('a[href="/app/dashboard"]').first().click();
    await expect(page.getByRole('heading', { name: 'Your next shifts' })).toBeVisible({
      timeout: 60_000,
    });
    await context.setOffline(true);

    // Client-side navigation, so the shell is already loaded and only the
    // clock screen's own reads fail: the case GAP-049 named, where the screen
    // most likely to be opened without signal used to say only "check your
    // connection and reload".
    await page.locator('a[href="/app/clock"]').first().click();
    await expect(
      page.getByText(/clock-in details have not loaded on this device/),
    ).toBeVisible({ timeout: 30_000 });

    await context.setOffline(false);
    await expect(page.getByRole('button', { name: 'Clock in manually' })).toBeVisible({
      timeout: 30_000,
    });
  });
});
