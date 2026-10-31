import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  allFlags,
  apiAs,
  authFile,
  orgId,
  setFlag,
  sql,
  visitClean,
  type Role,
} from './support';

/**
 * Each R2 flag on its own: off it is dark (the server answers 403 feature_off and the screen shows nothing new), on its
 * main path works end to end in the browser against the local API. Platform support sessions are refused on documents,
 * cover and the payroll export whatever the flags say.
 */

async function as(
  browser: Browser,
  baseURL: string | undefined,
  role: Role | 'staff2',
  url = '/app/help',
): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(role), baseURL });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForLoadState('load');
  await page.waitForFunction(
    () =>
      Boolean((window as unknown as { Clerk?: { session?: unknown } }).Clerk?.session),
    null,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(1500); // let the app settle its first redirects before calling the API from the page
  return page;
}

const shiftOf = (email: string, when: 'future' | 'past'): string =>
  sql(
    `SELECT s.id FROM shifts s JOIN staff_profiles p ON p.id = s.staff_profile_id JOIN rotas r ON r.id = s.rota_id
      WHERE p.email = '${email}' AND r.status = 'published' AND s.starts_at ${when === 'future' ? '>' : '<'} UTC_TIMESTAMP() + INTERVAL 1 DAY
      ORDER BY s.starts_at ${when === 'future' ? 'ASC' : 'DESC'} LIMIT 1`,
  );

test.describe('R2 flags one at a time', () => {
  test.beforeAll(() => allFlags(false));
  test.afterAll(() => allFlags(false));

  test('staff_documents: off is dark; on, a person uploads, the owner opens it through the signed link and approves', async ({
    browser,
    baseURL,
  }) => {
    const o = orgId();
    const owner = await as(browser, baseURL, 'owner');
    expect((await apiAs(owner, 'GET', `/orgs/${o}/documents/queue`)).json).toMatchObject({
      error: { code: 'feature_off' },
    });

    setFlag('staff_documents', true);
    const staff = await as(browser, baseURL, 'staff');
    await visitClean(staff, '/app/compliance', { expectText: /My documents/ });
    await staff.getByRole('button', { name: 'Upload or manage' }).click();
    const dialog = staff.getByRole('dialog');
    await dialog.locator('#doc-type').selectOption({ label: 'Right to work' });
    await dialog.locator('#doc-file').setInputFiles({
      name: 'passport.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(
        '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
      ),
    });
    await dialog.locator('#doc-issued').fill('2026-01-05');
    await dialog.getByRole('button', { name: 'Add document' }).click();
    await expect
      .poll(
        () =>
          sql(
            "SELECT status FROM documents WHERE name LIKE 'passport%' OR (type = 'Right to work' AND staff_profile_id = (SELECT id FROM staff_profiles WHERE email = 'staff+clerk_test@example.com'))",
          ),
        { timeout: 15_000 },
      )
      .toMatch(/uploaded|awaiting_review/);
    const docId = sql(
      "SELECT id FROM documents WHERE type = 'Right to work' AND staff_profile_id = (SELECT id FROM staff_profiles WHERE email = 'staff+clerk_test@example.com')",
    );
    if (sql(`SELECT status FROM documents WHERE id = '${docId}'`) === 'uploaded') {
      expect(
        (
          await apiAs(staff, 'POST', `/orgs/${o}/documents/${docId}/submit`, {
            version: Number(sql(`SELECT version FROM documents WHERE id = '${docId}'`)),
          })
        ).status,
      ).toBe(200);
    }
    // Four eyes: the person cannot approve their own document.
    const self = await apiAs(staff, 'POST', `/orgs/${o}/documents/${docId}/review`, {
      decision: 'approve',
      version: Number(sql(`SELECT version FROM documents WHERE id = '${docId}'`)),
    });
    expect(self.status).toBeGreaterThanOrEqual(403);

    // The owner opens it from the queue: a new tab on the signed /api/document-files link answers the PDF.
    await visitClean(owner, '/app/compliance', { expectText: /Review queue/ });
    const row = owner
      .getByRole('listitem')
      .filter({ hasText: 'Sam Staff' })
      .or(owner.locator('div').filter({ hasText: /^Sam Staff: Right to work/ }))
      .first();
    const popup = owner.waitForEvent('popup');
    await row.getByRole('button', { name: 'Open' }).click();
    const tab = await popup;
    const file = await tab
      .waitForResponse((r) => r.url().includes('/api/document-files'), {
        timeout: 15_000,
      })
      .catch(() => null);
    expect(file?.status()).toBe(200);
    expect(file?.headers()['content-type']).toMatch(/application\/pdf/);
    await tab.close();
    await row.getByRole('button', { name: 'Approve' }).click();
    await expect
      .poll(() => sql(`SELECT status FROM documents WHERE id = '${docId}'`), {
        timeout: 15_000,
      })
      .toBe('approved');
    // A signed link is useless once tampered with.
    const link = (await apiAs(owner, 'GET', `/orgs/${o}/documents/${docId}/link`))
      .json as { url: string };
    const bad = await owner.request.get(link.url.replace(/s=[^&]+/, 's=00'));
    expect(bad.status()).toBeGreaterThanOrEqual(400);
    setFlag('staff_documents', false);
  });

  test('scheduling_tools: off is dark; on, the draft week has a publish preview', async ({
    browser,
    baseURL,
  }) => {
    const o = orgId();
    const draft = sql(
      "SELECT id FROM rotas WHERE status = 'draft' ORDER BY period_start LIMIT 1",
    );
    const manager = await as(browser, baseURL, 'manager');
    expect(
      (await apiAs(manager, 'GET', `/orgs/${o}/rotas/${draft}/publish-preview`)).status,
    ).toBe(403);
    setFlag('scheduling_tools', true);
    const r = await apiAs(manager, 'GET', `/orgs/${o}/rotas/${draft}/publish-preview`);
    expect(r.status, r.text).toBe(200);
    await visitClean(manager, '/app/rota');
    setFlag('scheduling_tools', false);
  });

  test('cover_tools: off is dark; on, staff report they cannot work and the manager sees it on the board', async ({
    browser,
    baseURL,
  }) => {
    const o = orgId();
    const shift = shiftOf('staff2+clerk_test@example.com', 'future');
    const staff2 = await as(browser, baseURL, 'staff2');
    expect(
      (
        await apiAs(staff2, 'POST', `/orgs/${o}/cover/absences`, {
          shift_id: shift,
          reason: 'Childcare fell through',
        })
      ).status,
    ).toBe(403);
    setFlag('cover_tools', true);
    const made = await apiAs(staff2, 'POST', `/orgs/${o}/cover/absences`, {
      shift_id: shift,
      reason: 'Childcare fell through',
    });
    // 409 already_reported when the database was kept from an earlier run (WALK_KEEP_DB=1).
    expect([201, 409], made.text).toContain(made.status);
    const manager = await as(browser, baseURL, 'manager');
    await visitClean(manager, '/app/cover', { expectText: /1 cannot work/ });
    setFlag('cover_tools', false);
  });

  test('timesheet_tools: off is dark; on, the payroll CSV downloads under its own name with a BOM and a safe "=" name', async ({
    browser,
    baseURL,
  }) => {
    const o = orgId();
    const owner = await as(browser, baseURL, 'owner');
    const q = '?period_start=2026-10-19&period_end=2026-10-25';
    expect((await apiAs(owner, 'GET', `/orgs/${o}/timesheets/export${q}`)).status).toBe(
      403,
    );
    setFlag('timesheet_tools', true);
    const r = await apiAs(owner, 'GET', `/orgs/${o}/timesheets/export${q}`);
    expect(r.status, r.text.slice(0, 300)).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    expect(r.headers['content-disposition']).toMatch(
      /attachment; filename="rotaflow-timesheets-demo-care-group-2026-10-19-2026-10-25\.csv"/,
    );
    expect(r.text.charCodeAt(0)).toBe(0xfeff);
    expect(r.text).not.toMatch(/(^|,)=Ivan/m);
    // In the app: the payroll export dialog downloads the same file.
    await visitClean(owner, '/app/timesheets');
    await owner.getByRole('button', { name: 'Export payroll CSV' }).click();
    const dialog = owner.getByRole('dialog');
    await dialog.locator('#payroll-from').fill('2026-10-19');
    await dialog.locator('#payroll-to').fill('2026-10-25');
    const download = owner.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download CSV' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(
      /^rotaflow-timesheets-demo-care-group-.*\.csv$/,
    );
    expect(readFileSync(await file.path(), 'utf8').split('\n')[0]).toMatch(/,/);
    setFlag('timesheet_tools', false);
  });

  test('two_way_swaps: needs cover_tools too; on, a person sees the shifts they could ask for in return', async ({
    browser,
    baseURL,
  }) => {
    const o = orgId();
    const shift = shiftOf('staff+clerk_test@example.com', 'future');
    const staff = await as(browser, baseURL, 'staff');
    expect(
      (await apiAs(staff, 'GET', `/orgs/${o}/swaps/options?shift_id=${shift}`)).status,
    ).toBe(403);
    setFlag('cover_tools', true);
    setFlag('two_way_swaps', true);
    const r = await apiAs(staff, 'GET', `/orgs/${o}/swaps/options?shift_id=${shift}`);
    expect(r.status, r.text).toBe(200);
    await visitClean(staff, '/app/swaps');
    setFlag('two_way_swaps', false);
    setFlag('cover_tools', false);
  });

  test('a platform support session is refused on documents, cover and the payroll export, flags on or off', async ({
    browser,
    baseURL,
  }) => {
    const o = orgId();
    const owner = await as(browser, baseURL, 'owner');
    expect(
      (await apiAs(owner, 'POST', `/orgs/${o}/support-access`, { allowed: true })).status,
    ).toBe(200);
    const admin = await as(browser, baseURL, 'admin', '/admin');
    const opened = await apiAs(admin, 'POST', `/platform/orgs/${o}/support-sessions`, {
      reason: 'Local walk: checking the support refusals on R2 routes',
      case_ref: 'CASE-WALK',
      scope: 'read_write',
      minutes: 30,
    });
    // 409 session_open when the database was kept from an earlier run (WALK_KEEP_DB=1).
    expect([201, 409], opened.text).toContain(opened.status);
    for (const on of [false, true]) {
      allFlags(on);
      for (const p of [
        '/documents',
        '/cover/overview',
        '/timesheets/export?period_start=2026-10-19&period_end=2026-10-25',
      ]) {
        const r = await apiAs(admin, 'GET', `/orgs/${o}${p}`);
        expect(r.status, `${p} flags ${on ? 'on' : 'off'}: ${r.text.slice(0, 200)}`).toBe(
          403,
        );
      }
      expect((await apiAs(admin, 'GET', `/orgs/${o}/locations`)).status).toBe(200);
    }
    allFlags(false);
  });
});
