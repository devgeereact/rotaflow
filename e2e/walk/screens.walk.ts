import { test, type BrowserContext, type Page } from '@playwright/test';
import { allFlags, authFile, visitClean, type Role, type VisitOptions } from './support';

/**
 * Every screen, as every role, with every R2 flag OFF (must behave as before the move) and then with every flag ON.
 * Each screen must load without console errors, without a failed API call and without a failure message. A role that may
 * not see a screen must get the app's own refusal (a redirect or the "not for your role" card), never a crash.
 * Per-flag behaviour is in flags.walk.ts.
 */

const APP_SCREENS = [
  '/app/dashboard',
  '/app/team',
  '/app/locations',
  '/app/locations/departments',
  '/app/rota',
  '/app/setup',
  '/app/schedule',
  '/app/attendance',
  '/app/clock',
  '/app/timesheets',
  '/app/availability',
  '/app/leave',
  '/app/swaps',
  '/app/overtime',
  '/app/open-shifts',
  '/app/compliance',
  '/app/cover',
  '/app/announcements',
  '/app/notifications',
  '/app/help',
  '/app/approvals',
  '/app/reports',
  '/app/settings/organisation',
  '/app/settings/permissions',
  '/app/settings/roles',
  '/app/settings/policies',
  '/app/settings/document-types',
  '/app/settings/notifications',
  '/app/settings/integrations',
  '/app/settings/billing',
  '/app/settings/audit',
  '/app/account/profile',
  '/app/account/preferences',
  '/app/account/security',
  '/app/account/tokens',
  '/app/account/activity',
  '/app/account/data',
];

const ADMIN_SCREENS = [
  '/admin',
  '/admin/organisations',
  '/admin/users',
  '/admin/subscriptions',
  '/admin/billing',
  '/admin/support',
  '/admin/enquiries',
  '/admin/support-access',
  '/admin/audit',
  '/admin/platform-health',
  '/admin/incidents',
  '/admin/integrations',
  '/admin/notifications',
  '/admin/feature-flags',
  '/admin/gdpr',
  '/admin/settings',
];

/** Screens a role is refused, with the API calls the refusal may cost (none should be a crash). */
const DENIED: Partial<Record<Role, VisitOptions['allowApi']>> = {};

/** One signed-in page per role, reused across its screens (see `navigate`). */
function walkRole(role: Role, screens: string[]): void {
  test.describe(role, () => {
    test.describe.configure({ mode: 'default' });
    let ctx: BrowserContext;
    let page: Page;
    test.beforeAll(async ({ browser, baseURL }) => {
      ctx = await browser.newContext({ storageState: authFile(role), baseURL });
      page = await ctx.newPage();
    });
    test.afterAll(async () => {
      await ctx.close();
    });
    for (const url of screens) {
      test(url, async () => {
        await visitClean(page, url, { allowApi: DENIED[role] });
      });
    }
  });
}

for (const flagState of ['off', 'on'] as const) {
  test.describe(`all R2 flags ${flagState}`, () => {
    test.describe.configure({ mode: 'default' });
    test.beforeAll(() => allFlags(flagState === 'on'));
    test.afterAll(() => allFlags(false));
    walkRole('owner', APP_SCREENS);
    walkRole('manager', APP_SCREENS);
    walkRole('staff', APP_SCREENS);
    walkRole('admin', ADMIN_SCREENS);
  });
}
