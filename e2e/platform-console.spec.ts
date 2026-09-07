import { expect, test, type Page } from '@playwright/test';

/**
 * The platform console, driven against a real session and a real database
 * (docs/SAAS.md GAP-082).
 *
 * ## What was missing
 *
 * Every console screen was verified through `/admin-preview`, which mounts the
 * real components and intercepts `fetch` so Supabase answers from fixtures.
 * That proves the components render and that the paging arithmetic is right.
 * It proves nothing about a platform administrator's JWT reaching these RPCs,
 * about `has_platform_role` deciding correctly for a real grant, or about the
 * console's behaviour when the database refuses.
 *
 * pgTAP covers the other side — it proves each function refuses the wrong role
 * — and it cannot prove the console handles the refusal, because pgTAP has no
 * browser. This is the join between them.
 *
 * ## What it exercises
 *
 * Thirty organisations, which is more than one page. That number is the whole
 * point: the defects this pass fixed were invisible below the API cap and
 * below a page size, so a fixture of six would have passed against the broken
 * code. It asserts the total is the match set rather than the page, that a
 * search finds a tenant the first page does not contain, and that a narrower
 * platform role meets a refusal rather than an empty table.
 *
 * ## Why it is skipped unless CI says otherwise
 *
 * It needs a Supabase stack on localhost and its service-role key. Running it
 * against a developer's `.env` would point it at PRODUCTION and seed thirty
 * organisations into a customer's database, so it refuses to run without
 * `E2E_LIVE_SUPABASE` and `E2E_SERVICE_ROLE_KEY`, which only the
 * `e2e-authenticated` job sets, after `supabase start`.
 *
 * A skipped test that could have written to production is the right default.
 *
 * ## The browser and the fixture must be the same Supabase
 *
 * This spec seeds over the service role and then drives the browser against
 * what it seeded, so a mismatch is fatal and silent: the account exists on one
 * instance, the sign-in happens on the other, and the only symptom is "Invalid
 * login credentials". `playwright.config.ts` therefore refuses to reuse a
 * running dev server when `E2E_LIVE_SUPABASE` is set, and `signIn` below
 * asserts the origin the app actually calls.
 *
 * Locally:
 *
 *   supabase status -o env > /tmp/sb.env && . /tmp/sb.env
 *   VITE_SUPABASE_URL="$API_URL" VITE_SUPABASE_ANON_KEY="$ANON_KEY" \\
 *     E2E_LIVE_SUPABASE=1 E2E_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \\
 *     npx playwright test e2e/platform-console.spec.ts
 *
 * Nothing needs moving out of the way: Vite's `loadEnv` applies `process.env`
 * after the `.env` files, so these win.
 *
 * The fixtures are left behind deliberately — they are what proves the bodies
 * ran rather than the assertions being vacuous. Run `supabase db reset` before
 * `supabase test db` afterwards: pgTAP has assertions that count over whole
 * tables, and thirty stray organisations fail them. CI destroys its stack per
 * job, so this only bites locally.
 */
const LIVE = process.env.E2E_LIVE_SUPABASE === '1';
const SERVICE_KEY = process.env.E2E_SERVICE_ROLE_KEY ?? '';
const API_URL = process.env.VITE_SUPABASE_URL ?? '';

/**
 * A service-role write, used only to seed.
 *
 * The console cannot create its own first platform owner: `grant_platform_role`
 * requires one to exist already, which is the correct rule and an awkward one
 * to bootstrap. Seeding it out of band is what a fixture is for; nothing the
 * test then asserts goes through this key.
 */
async function seed(path: string, body: unknown): Promise<void> {
  const response = await fetch(`${API_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`seed ${path} failed: ${response.status} ${await response.text()}`);
  }
}

async function patch(path: string, body: unknown): Promise<void> {
  const response = await fetch(`${API_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`patch ${path} failed: ${response.status} ${await response.text()}`);
  }
}

/**
 * Create a confirmed account through the Auth admin API, then sign in through
 * the real form.
 *
 * `authenticated-loop.spec.ts` signs up through the form because sign-up is
 * its subject; here it is a fixture, and going through the form makes this
 * test depend on the local stack's confirmation mail — which is a dependency
 * that fails as "Error sending confirmation email" and tells you nothing about
 * the console. `email_confirm: true` skips the mail and nothing else.
 *
 * The session is still a real one: the sign-in below goes through GoTrue and
 * the app's own form, which is the part that has to be real for the console's
 * RPCs to be reached with a genuine JWT.
 */
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
      user_metadata: { first_name: 'Platform', last_name: 'Operator' },
    }),
  });
  if (!response.ok) {
    throw new Error(`create user failed: ${response.status} ${await response.text()}`);
  }
  const created = (await response.json()) as { id: string };
  return created.id;
}

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);

  // The token request names the instance the app is configured against. If it
  // is not the one seeded above, say so here rather than letting it surface as
  // "Invalid login credentials" — which is what a mis-targeted run looks like,
  // and is indistinguishable from a real password problem.
  const token = page.waitForRequest((request) =>
    request.url().includes('/auth/v1/token'),
  );
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const origin = new URL((await token).url()).origin;
  expect(
    origin,
    `the app signed in against ${origin} but the fixture was seeded into ${API_URL} — a stale dev server is being reused`,
  ).toBe(new URL(API_URL).origin);
  // A user with no organisation lands on onboarding; a platform administrator
  // still has none, and `/admin` is reachable from there because the console
  // is gated on the platform flag rather than on a membership.
  await page.waitForURL(/\/(onboarding|app)/, { timeout: 60_000 });
}

test.describe('the platform console, signed in', () => {
  test.skip(
    !LIVE || SERVICE_KEY === '',
    'needs a local Supabase stack and its service-role key — see e2e-authenticated in ci.yml',
  );

  test('a platform owner can find a tenant that is not on the first page', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const stamp = Date.now();
    const email = `e2e-platform-${stamp}@example.test`;
    const password = `E2e-${stamp}-Passw0rd`;

    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const userId = await createConfirmedUser(email, password);

    // ---- seed a platform owner and thirty tenants ---------------------
    await seed('platform_admins', { user_id: userId, role: 'platform_owner' });
    await signIn(page, email, password);

    // `created_by: null` is the platform-admin creation path, which
    // `limit_org_creation()` exempts from the five-per-hour self-serve rate
    // limit. Thirty rows attributed to one person is refused by that trigger,
    // correctly.
    await seed(
      'organisations',
      Array.from({ length: 29 }, (_, i) => ({
        name: `E2E Tenant ${String(i + 1).padStart(2, '0')} ${stamp}`,
        slug: `e2e-tenant-${stamp}-${String(i + 1).padStart(2, '0')}`,
        created_by: null,
      })),
    );
    // The needle. Alphabetically last and created first, so the default
    // newest-first order puts it on the final page.
    await seed('organisations', {
      name: `Zulu Care Homes ${stamp}`,
      slug: `zulu-care-${stamp}`,
      created_by: null,
      created_at: new Date(Date.now() - 400 * 86_400_000).toISOString(),
    });

    // ---- the directory ------------------------------------------------
    await page.goto('/admin/organisations');

    // The range line is the assertion. It is the only thing on the screen
    // that can tell "these are all of them" from "these are the first
    // twenty-five", and before this pass it did not exist: the total tile
    // printed the length of whatever PostgREST returned.
    const range = page.getByText(/Showing 1–25 of \d+ organisations/);
    await expect(range).toBeVisible({ timeout: 60_000 });
    const rangeText = (await range.textContent()) ?? '';
    const total = Number(/of (\d+)/.exec(rangeText)?.[1] ?? '0');
    expect(
      total,
      'the total counts every seeded tenant, not the page',
    ).toBeGreaterThanOrEqual(30);

    await expect(page.getByRole('row')).toHaveCount(26); // 25 rows plus the header

    // ---- the search finds what the first page does not -----------------
    await page.getByRole('searchbox', { name: /search/i }).fill(`zulu-care-${stamp}`);
    await expect(
      page.getByRole('link', { name: new RegExp(`Zulu Care Homes ${stamp}`) }),
    ).toBeVisible({ timeout: 30_000 });

    // Filtering must move the count with the rows. A total that stays at 30
    // while one row is shown is the "count and page disagree" defect.
    await expect(page.getByText(/1 of 1|Showing 1–1 of 1/)).toBeVisible({
      timeout: 30_000,
    });

    // ---- page two ------------------------------------------------------
    await page.getByRole('searchbox', { name: /search/i }).fill('');
    await expect(range).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText(/Showing 26–\d+ of \d+ organisations/)).toBeVisible({
      timeout: 30_000,
    });

    expect(errors, 'uncaught errors in the platform console').toEqual([]);
  });

  test('a narrower platform role meets a refusal, not an empty table', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const stamp = Date.now();
    const email = `e2e-finance-${stamp}@example.test`;
    const password = `E2e-${stamp}-Passw0rd`;

    const userId = await createConfirmedUser(email, password);

    // Finance may read organisations and subscriptions — that is what the
    // billing console it exists for is built on — and may not read profiles or
    // memberships (0122). Before this pass the nav offered Users anyway, RLS
    // filtered it to the reader's own row, and the screen rendered a
    // one-account table: a boundary that looked like a broken product.
    await seed('platform_admins', { user_id: userId, role: 'platform_finance' });
    await signIn(page, email, password);

    await page.goto('/admin/users');
    await expect(
      page.getByRole('heading', { name: 'Not part of your platform role' }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('You are signed in as Platform Finance.')).toBeVisible();

    // And the nav does not offer what the route refuses. A hidden link whose
    // route still renders when typed is a decoration; a visible link to a
    // refusal is worse.
    await expect(page.getByRole('link', { name: 'Users', exact: true })).toHaveCount(0);

    // The billing console is the one it exists to use, and it must still work.
    await page.goto('/admin/billing');
    await expect(page.getByRole('heading', { name: 'Billing and finance' })).toBeVisible({
      timeout: 60_000,
    });

    // Promoting the same account proves the gate reads the live grant rather
    // than something cached at sign-in.
    await patch(`platform_admins?user_id=eq.${userId}`, { role: 'platform_owner' });
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible({
      timeout: 60_000,
    });
  });
});
