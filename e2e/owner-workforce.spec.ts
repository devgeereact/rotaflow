import { expect, test } from '@playwright/test';

/**
 * The owner journey, against a real session and real RLS.
 *
 * `app-surface.spec.ts` renders these screens through `-preview` routes,
 * which mount the real components against fixtures with no session at all.
 * That proves a screen renders. It proves nothing about the thing this change
 * is actually about: that an owner **with no staff record** can run the
 * workforce, that the job-title catalogue writes through RLS, and that the
 * directory's status filter reaches a deactivated person.
 *
 * Every assertion below failed before this change set, and most of them could
 * not have been written: `/app/attendance` did not exist, the catalogue did
 * not exist, and the owner's sidebar led with a personal Clock In.
 *
 * ## Why it is skipped unless CI says otherwise
 *
 * It needs a Supabase stack on localhost. Running it against the developer's
 * `.env` would point it at PRODUCTION and create real organisations in a
 * customer's database — so it refuses to run unless `E2E_LIVE_SUPABASE` is
 * set, which only the `e2e-authenticated` job does, after `supabase start`.
 */
const LIVE = process.env.E2E_LIVE_SUPABASE === '1';

test.describe('an owner runs the workforce', () => {
  test.skip(!LIVE, 'needs a local Supabase stack — see e2e-authenticated in ci.yml');

  test('with no staff record of their own', async ({ page }) => {
    test.setTimeout(180_000);

    const stamp = Date.now();
    const email = `owner-${stamp}@example.test`;
    const password = `Owner-${stamp}-Passw0rd`;
    const orgName = `Workforce ${stamp}`;

    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    // ---- sign up and create the organisation --------------------------
    await page.goto('/signup');
    await page.getByLabel('First name').fill('Owner');
    await page.getByLabel('Last name').fill('Only');
    await page.getByLabel('Work email address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();

    await page.waitForURL(/\/onboarding/, { timeout: 60_000 });
    await page.getByLabel('Organisation name').fill(orgName);
    const create = page.getByRole('button', { name: /continue/i });
    await expect(create).toBeEnabled({ timeout: 30_000 });
    await create.click();
    await expect(
      page.getByRole('heading', { name: 'About your organisation', exact: true }),
    ).toBeVisible({ timeout: 60_000 });

    // ---- the operations dashboard, not a personal one -----------------
    await page.goto('/app/dashboard');
    await expect(page.getByRole('heading', { name: 'Operations' })).toBeVisible({
      timeout: 60_000,
    });

    // The tiles state what they count. "Clocked in now" is derived from clock
    // events, so a brand-new organisation reads zero — and says why zero.
    await expect(page.getByText('Clocked in now')).toBeVisible();
    await expect(page.getByText('Scheduled today')).toBeVisible();

    // The board says what it cannot see, rather than implying absence.
    await expect(
      page.getByText(/A clock-in queued offline is not visible here/i),
    ).toBeVisible();

    // ---- navigation: management, not a personal rota ------------------
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Team Attendance' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Team Availability' })).toBeVisible();
    // The assumption this change reverses: an owner with no staff profile was
    // given a personal punch clock that opened on an empty screen.
    await expect(nav.getByRole('link', { name: 'Clock In' })).toHaveCount(0);

    // ---- the job-title catalogue writes through RLS -------------------
    await page.goto('/app/settings/roles');
    await expect(page.getByRole('heading', { name: 'Job titles' })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByLabel('Add a job title').fill('Registered Nurse');
    await page.getByRole('button', { name: 'Add job title' }).click();
    // The badge renders its short code and its name inside one element, so
    // the row is located rather than the bare string.
    const nurseRows = page
      .getByRole('listitem')
      .filter({ hasText: 'Registered Nurse' });
    await expect(nurseRows).toHaveCount(1, { timeout: 30_000 });

    // A case and spacing variant is the same title. Asserted as an outcome —
    // the catalogue still holds one entry — rather than on the wording of the
    // inline warning: the refusal has two independent enforcers (the form's
    // pre-flight check and `job_titles_org_name_key`), and the guarantee is
    // that one of them stops it, not which.
    await page.getByLabel('Add a job title').fill('  registered   NURSE ');
    const addButton = page.getByRole('button', { name: 'Add job title' });
    if (await addButton.isEnabled()) await addButton.click();
    await page.waitForTimeout(1_000);
    await expect(nurseRows).toHaveCount(1);

    // ---- add a staff member and give them the title -------------------
    await page.goto('/app/team');
    await page.getByRole('button', { name: 'Add Staff' }).click();
    await page.getByLabel('First name').fill('Ada');
    await page.getByLabel('Last name').fill('Chen');
    // By id: "Job title" appears as a column heading in the directory behind
    // the dialog as well, and a role/label lookup would be ambiguous.
    await page.locator('#staff-title').selectOption({ label: 'Registered Nurse' });
    await page.getByRole('button', { name: 'Add staff', exact: true }).click();
    // The directory draws the same person twice — labelled rows on a phone and
    // a table above `md` — so this counts rather than expecting one node.
    await expect(page.getByRole('link', { name: 'Ada Chen' }).first()).toBeVisible({
      timeout: 30_000,
    });

    // ---- the status filter reaches a deactivated person ---------------
    //
    // The directory used to drop every inactive row unconditionally, which
    // made the Reactivate action in the row menu unreachable: the only people
    // it applies to were removed from the list before the menu could open.
    await expect(page.getByLabel('Status')).toBeVisible();
    await page.getByLabel('Status').selectOption('inactive');
    // The URL carries the filter, so the view survives a reload and can be
    // linked to. The search box is deliberately NOT in it.
    await expect(page).toHaveURL(/status=inactive/);
    await page.reload();
    await expect(page.getByLabel('Status')).toHaveValue('inactive');

    await page.getByLabel('Status').selectOption('all');
    // The directory draws the same person twice — labelled rows on a phone and
    // a table above `md` — so this counts rather than expecting one node.
    await expect(page.getByRole('link', { name: 'Ada Chen' }).first()).toBeVisible({
      timeout: 30_000,
    });

    // ---- the search term never travels in the URL ---------------------
    await page.getByLabel(/Search name, job title or site/i).fill('Ada');
    await expect(page.getByRole('link', { name: 'Ada Chen' }).first()).toBeVisible();
    expect(page.url()).not.toContain('Ada');

    // ---- attendance opens with the filters a tile would hand it -------
    await page.goto('/app/attendance?status=late');
    await expect(page.getByRole('heading', { name: 'Team Attendance' })).toBeVisible({
      timeout: 30_000,
    });
    // The applied filter is shown as a removable chip. Located by its
    // accessible name, because the label and the value are separate spans
    // inside one button and a text match would span an element boundary.
    await expect(
      page.getByRole('button', { name: /Attendance status:\s*Late/i }),
    ).toBeVisible();

    expect(errors, 'uncaught errors during the owner journey').toEqual([]);
  });
});
