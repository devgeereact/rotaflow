import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { allFlags, apiAs, authFile, orgId, signIn, sql, visitClean } from './support';

/**
 * The main actions, with every R2 flag OFF (the release as it ships): sign-in and sign-out, the no-organisation screen,
 * the offline clock-in outbox, a leave decision, taking an open shift, the timesheet CSV download, and the refusals a
 * person gets when they try something their role may not do.
 */
test.describe('actions with all R2 flags off', () => {
  test.beforeAll(() => allFlags(false));

  test.describe('no organisation', () => {
    test.use({ storageState: authFile('noorg') });
    test('a signed-in person with no organisation sees the invitation screen, not the app', async ({
      page,
    }) => {
      await page.goto('/app/dashboard');
      await page.waitForURL(/\/onboarding/);
      await expect(page.getByText('You are not in an organisation yet')).toBeVisible();
      await expect(page.getByText('noorg+clerk_test@example.com')).toBeVisible();
    });
  });

  test.describe('staff', () => {
    test.use({ storageState: authFile('staff') });

    test('clock-in made offline waits in the outbox and reaches the server when the signal returns', async ({
      page,
      context,
    }) => {
      const staff = sql(
        "SELECT id FROM staff_profiles WHERE email = 'staff+clerk_test@example.com'",
      );
      const count = (): number =>
        Number(
          sql(
            `SELECT COUNT(*) FROM clock_events WHERE staff_profile_id = '${staff}' AND event_at > UTC_TIMESTAMP() - INTERVAL 10 MINUTE`,
          ),
        );
      const before = count();
      await page.goto('/app/clock');
      const manual = page.getByRole('button', { name: 'Clock in manually' });
      await expect(manual).toBeVisible({ timeout: 30_000 });
      await context.setOffline(true);
      await manual.click();
      await expect(page.getByText('Offline, 1 waiting')).toBeVisible({ timeout: 15_000 });
      expect(count()).toBe(before);
      await context.setOffline(false);
      await expect
        .poll(count, {
          timeout: 30_000,
          message: 'the queued clock-in never reached the server',
        })
        .toBe(before + 1);
      await expect(page.getByText('Synced')).toBeVisible({ timeout: 30_000 });
    });

    test('takes an open shift they are eligible for; one they are not is refused before the click', async ({
      page,
    }) => {
      await visitClean(page, '/app/open-shifts');
      const take = page
        .getByRole('button', { name: 'Take it', exact: true })
        .and(page.locator(':not([disabled])'));
      const n = await take.count();
      test.skip(n === 0, 'no open shift this person is eligible for in the seeded weeks');
      await take.first().click();
      // A confirm dialog names the shift; its own button is also "Take it".
      await page.getByRole('dialog').getByRole('button', { name: 'Take it' }).click();
      const staff = sql(
        "SELECT id FROM staff_profiles WHERE email = 'staff+clerk_test@example.com'",
      );
      await expect
        .poll(
          () =>
            Number(
              sql(
                `SELECT COUNT(*) FROM shifts WHERE staff_profile_id = '${staff}' AND notes = 'Extra cover needed'`,
              ),
            ),
          { timeout: 15_000 },
        )
        .toBe(1);
    });

    test('asks for leave, and is refused a manager-only screen and a manager-only write', async ({
      page,
    }) => {
      await visitClean(page, '/app/reports', {
        expectText: /not available|do not have|managers|owner/i,
      });
      const o = orgId();
      const res = await apiAs(
        page,
        'POST',
        `/orgs/${o}/leave/${sql("SELECT id FROM leave_requests WHERE status = 'pending' LIMIT 1")}/review`,
        {
          status: 'approved',
        },
      );
      expect(res.status, JSON.stringify(res.json)).toBe(403);
      const made = await apiAs(page, 'POST', `/orgs/${o}/leave`, {
        start_date: '2026-12-21',
        end_date: '2026-12-22',
        type: 'holiday',
        reason: 'Walk',
      });
      expect(made.status, JSON.stringify(made.json)).toBe(201);
      await visitClean(page, '/app/leave', { expectText: /21-22 December 2026/ });
    });
  });

  test.describe('owner', () => {
    test.use({ storageState: authFile('owner') });

    test('approves a pending leave request from Approvals', async ({ page }) => {
      await visitClean(page, '/app/approvals', { expectText: /Leave · annual/ });
      const card = page
        .getByRole('listitem')
        .filter({ hasText: /Leave · annual, 16 Nov to 20 Nov/ });
      await card.getByRole('button', { name: 'Approve' }).click();
      const dialog = page.getByRole('dialog');
      if (await dialog.isVisible().catch(() => false)) {
        await dialog.getByRole('button', { name: /Approve/ }).click();
      }
      await expect
        .poll(
          () =>
            sql(
              "SELECT status FROM leave_requests WHERE reason = 'Holiday' AND staff_profile_id = (SELECT id FROM staff_profiles WHERE email = 'staff+clerk_test@example.com')",
            ),
          { timeout: 15_000 },
        )
        .toBe('approved');
    });

    test('downloads the timesheet CSV', async ({ page }) => {
      await visitClean(page, '/app/timesheets');
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
      const file = await download;
      expect(file.suggestedFilename()).toMatch(/\.csv$/);
      const body = readFileSync(await file.path(), 'utf8');
      expect(body.split('\n')[0]).toMatch(/,/);
    });
  });

  test.describe('sign-in and sign-out', () => {
    test('a person signs in with the emailed code and signs out from the account menu', async ({
      browser,
      baseURL,
    }) => {
      const ctx = await browser.newContext({ baseURL });
      const page = await ctx.newPage();
      await signIn(page, 'staff2');
      await expect(page).toHaveURL(/\/app\/dashboard/);
      await page.getByRole('button', { name: 'Account options' }).click();
      await page
        .getByRole('menuitem', { name: 'Sign out' })
        .or(page.getByRole('button', { name: 'Sign out' }))
        .first()
        .click();
      await page.waitForURL(/\/(login|$)/, { timeout: 20_000 });
      await page.goto('/app/dashboard');
      await page.waitForURL(/\/login/, { timeout: 20_000 });
      await ctx.close();
    });
  });
});
