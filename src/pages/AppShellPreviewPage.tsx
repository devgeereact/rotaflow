import { useMemo } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { OrgContext, type OrgContextValue } from '@/context/OrgContext';
import { DashboardPreviewPage } from '@/pages/app/DashboardPreviewPage';
import { RotaBuilderPreviewPage } from '@/pages/RotaBuilderPreviewPage';
import { SchedulePreviewPage } from '@/pages/app/SchedulePreviewPage';
import { ClockInPreviewPage } from '@/pages/ClockInPreviewPage';
import { TimesheetsPreviewPage } from '@/pages/app/TimesheetsPreviewPage';
import { AvailabilityPreviewPage } from '@/pages/app/AvailabilityPreviewPage';
import { LeavePreviewPage } from '@/pages/app/LeavePreviewPage';
import { SwapsPreviewPage } from '@/pages/SwapsPreviewPage';
import { StaffPreviewPage } from '@/pages/StaffPreviewPage';
import { LocationsPreviewPage } from '@/pages/LocationsPreviewPage';
import { AnnouncementsPreviewPage } from '@/pages/AnnouncementsPreviewPage';
import { ReportsPreviewPage } from '@/pages/ReportsPreviewPage';

/**
 * Design-loop harness for the whole `/app/*` shell, **development only**.
 *
 * ## Why this exists
 *
 * Every screen inside the org workspace already has a `*PreviewPage`. a
 * presentational component rendered against fixtures, with no `AppShell`
 * around it (see `docs/preview_pages_exclude_appshell` in memory), so the
 * chrome itself. The rail, the org switcher, the topbar, the mobile tab bar.
 * has never once been screenshotted, only inferred from reading the
 * component source. `AdminPreviewHarness` solved exactly this problem for
 * `/admin/*` by mounting the real shell with a stubbed `OrgContext`; this is
 * the same move for the organisation workspace, reusing the `*PreviewPage`
 * components that already exist as its routed children instead of fixturing
 * Supabase, since none of them fetch.
 *
 * `?role=owner|manager|staff` switches the stubbed membership role so the
 * rail's role-gated rows (Rota Builder, Team, Locations, Reports, Settings
 * vs My Profile) can be checked for all three without a second login.
 *
 * Gated behind `import.meta.env.DEV` in `App.tsx` exactly like every other
 * preview route, so Rollup drops this module from the production bundle.
 */
const ROLE_ORG_NAME = 'Sunnyvale Care Group';

export function AppShellPreviewPage(): JSX.Element {
  const role = (new URLSearchParams(window.location.search).get('role') ?? 'owner') as
    'owner' | 'manager' | 'staff';

  const org = useMemo<OrgContextValue>(
    () => ({
      orgId: 'preview-org',
      orgName: ROLE_ORG_NAME,
      role,
      memberships: [
        { orgId: 'preview-org', orgName: ROLE_ORG_NAME, role },
        { orgId: 'preview-org-2', orgName: 'Oak Lodge Residential', role: 'manager' },
      ],
      isPlatformAdmin: false,
      platformRole: null,
      switchOrg: () => {},
      loading: false,
      loadFailed: false,
      createOrg: async () => {},
      refresh: async () => {},
    }),
    [role],
  );

  return (
    <OrgContext.Provider value={org}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPreviewPage />} />
          <Route path="rota" element={<RotaBuilderPreviewPage />} />
          <Route path="schedule" element={<SchedulePreviewPage />} />
          <Route path="clock" element={<ClockInPreviewPage />} />
          <Route path="timesheets" element={<TimesheetsPreviewPage />} />
          <Route path="availability" element={<AvailabilityPreviewPage />} />
          <Route path="leave" element={<LeavePreviewPage />} />
          <Route path="swaps" element={<SwapsPreviewPage />} />
          <Route path="team" element={<StaffPreviewPage />} />
          <Route path="locations" element={<LocationsPreviewPage />} />
          <Route path="announcements" element={<AnnouncementsPreviewPage />} />
          <Route path="reports" element={<ReportsPreviewPage />} />
        </Route>
      </Routes>
    </OrgContext.Provider>
  );
}
