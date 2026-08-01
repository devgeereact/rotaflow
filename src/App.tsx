import { Suspense, lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/context/AuthContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { ToastProvider } from '@/context/ToastContext';
import { OrgProvider } from '@/context/OrgContext';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { AppShell } from '@/components/layout/AppShell';
import { InstallPrompt } from '@/components/InstallPrompt';
import { UpdatePrompt } from '@/components/UpdatePrompt';
import { OfflineBanner } from '@/components/OfflineBanner';
import { SplashScreen } from '@/components/SplashScreen';
import { AppBootScreen } from '@/components/AppBootScreen';
import { HomePage } from '@/pages/HomePage';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { RouteFallback } from '@/components/RouteFallback';

/**
 * `React.lazy` for a module that uses a NAMED export. Every page in this
 * project does, and `lazy` insists on a default.
 *
 * The dynamic `import()` stays a literal inside the caller's arrow function so
 * Rollup can still see it statically and split the chunk — passing a pre-built
 * promise here would defeat that silently.
 */
function lazyPage<K extends string>(
  name: K,
  loader: () => Promise<Record<K, ComponentType>>,
): LazyExoticComponent<ComponentType> {
  return lazy(() => loader().then((m) => ({ default: m[name] })));
}

/*
 * Route-level code splitting.
 *
 * Everything used to arrive in one 802 kB chunk, so a carer opening /app/clock
 * downloaded the rota builder's drag-and-drop engine, the reports CSV exporter
 * and every settings screen before they could clock in.
 *
 * HomePage, LoginPage and NotFoundPage stay EAGER on purpose: they are the
 * public entry points, and on a genuinely first visit — no service worker yet —
 * lazy-loading them would add a round trip to the moment first impressions are
 * made. Everything behind auth is lazy; by then the service worker has
 * precached every chunk, so those loads come from cache and offline still works.
 */
const OnboardingPage = lazyPage('OnboardingPage', () => import('@/pages/OnboardingPage'));
const OnboardingPreviewPage = lazyPage(
  'OnboardingPreviewPage',
  () => import('@/pages/OnboardingPreviewPage'),
);
const RotaBuilderPreviewPage = lazyPage(
  'RotaBuilderPreviewPage',
  () => import('@/pages/RotaBuilderPreviewPage'),
);
const SchedulePreviewPage = lazyPage(
  'SchedulePreviewPage',
  () => import('@/pages/SchedulePreviewPage'),
);
const TimesheetsPreviewPage = lazyPage(
  'TimesheetsPreviewPage',
  () => import('@/pages/TimesheetsPreviewPage'),
);
const ClockInPreviewPage = lazyPage(
  'ClockInPreviewPage',
  () => import('@/pages/ClockInPreviewPage'),
);
const StaffPreviewPage = lazyPage(
  'StaffPreviewPage',
  () => import('@/pages/StaffPreviewPage'),
);
const StaffProfilePreviewPage = lazyPage(
  'StaffProfilePreviewPage',
  () => import('@/pages/StaffProfilePreviewPage'),
);
const LocationsPreviewPage = lazyPage(
  'LocationsPreviewPage',
  () => import('@/pages/LocationsPreviewPage'),
);
const AnnouncementsPreviewPage = lazyPage(
  'AnnouncementsPreviewPage',
  () => import('@/pages/AnnouncementsPreviewPage'),
);
const AcceptInvitePage = lazyPage(
  'AcceptInvitePage',
  () => import('@/pages/AcceptInvitePage'),
);
const SignupPage = lazyPage('SignupPage', () => import('@/pages/SignupPage'));
const ForgotPasswordPage = lazyPage(
  'ForgotPasswordPage',
  () => import('@/pages/ForgotPasswordPage'),
);
const ResetPasswordPage = lazyPage(
  'ResetPasswordPage',
  () => import('@/pages/ResetPasswordPage'),
);
const TeamPage = lazyPage('TeamPage', () => import('@/pages/app/TeamPage'));
const SchedulePage = lazyPage('SchedulePage', () => import('@/pages/app/SchedulePage'));
const ClockInPage = lazyPage('ClockInPage', () => import('@/pages/app/ClockInPage'));
const TimesheetsPage = lazyPage(
  'TimesheetsPage',
  () => import('@/pages/app/TimesheetsPage'),
);
const AvailabilityPage = lazyPage(
  'AvailabilityPage',
  () => import('@/pages/app/AvailabilityPage'),
);
const LeavePage = lazyPage('LeavePage', () => import('@/pages/app/LeavePage'));
const SwapsPage = lazyPage('SwapsPage', () => import('@/pages/app/SwapsPage'));
const AnnouncementsPage = lazyPage(
  'AnnouncementsPage',
  () => import('@/pages/app/AnnouncementsPage'),
);
const NotificationsPage = lazyPage(
  'NotificationsPage',
  () => import('@/pages/app/NotificationsPage'),
);
const IntegrationsPage = lazyPage(
  'IntegrationsPage',
  () => import('@/pages/app/IntegrationsPage'),
);
const OrgSettingsPage = lazyPage(
  'OrgSettingsPage',
  () => import('@/pages/app/OrgSettingsPage'),
);
const ReportsPage = lazyPage('ReportsPage', () => import('@/pages/app/ReportsPage'));
const AccountSettingsPage = lazyPage(
  'AccountSettingsPage',
  () => import('@/pages/app/AccountSettingsPage'),
);
const DashboardPage = lazyPage(
  'DashboardPage',
  () => import('@/pages/app/DashboardPage'),
);
const DashboardPreviewPage = lazyPage(
  'DashboardPreviewPage',
  () => import('@/pages/app/DashboardPreviewPage'),
);
const StaffPage = lazyPage('StaffPage', () => import('@/pages/app/StaffPage'));
const StaffProfilePage = lazyPage(
  'StaffProfilePage',
  () => import('@/pages/app/StaffProfilePage'),
);
const LocationsPage = lazyPage(
  'LocationsPage',
  () => import('@/pages/app/LocationsPage'),
);
const RotaBuilderPage = lazyPage(
  'RotaBuilderPage',
  () => import('@/pages/app/RotaBuilderPage'),
);

export function App(): JSX.Element {
  return (
    <ThemeProvider>
      {/* Outside AuthProvider so sign-in/sign-out failures can surface too. */}
      <ToastProvider>
        <AuthProvider>
          <OrgProvider>
            <BrowserRouter>
              {/* Covers the lazy PUBLIC routes (signup, onboarding, invite,
                  password reset). /app/* has its own boundary inside AppShell
                  so the chrome survives navigation — see there. */}
              <Suspense fallback={<RouteFallback />}>
                <Routes>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/signup" element={<SignupPage />} />
                  <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                  <Route path="/reset-password" element={<ResetPasswordPage />} />
                  <Route path="/splash" element={<SplashScreen />} />
                  {/* ---------------------------------------------------------
                    Design-loop preview routes — DEV ONLY.

                    Every screen below lives behind auth in the real product and
                    needs a Supabase session, an org and seeded rows that the
                    design loop cannot produce, so each preview renders the same
                    component tree against fixed mock data chosen to reproduce
                    its reference PNG's exact numbers. See docs/LOOP.md.

                    They shipped to production unguarded until 2026-07-31: all
                    seven answered 200 unauthenticated on rota.gakinz.com, so
                    anyone who guessed a URL got a page of invented staff names
                    and metrics with no branding and no way back into the app.
                    Every preview page and its mock dataset was also carried in
                    the production bundle.

                    `import.meta.env.DEV` is statically replaced with `false` at
                    build time, so Rollup drops this whole branch AND tree-shakes
                    the preview pages and their mock modules out of the bundle.
                    The loop is unaffected — it drives the dev server, where DEV
                    is true. Keep new preview routes inside this block.
                    --------------------------------------------------------- */}
                  {import.meta.env.DEV && (
                    <>
                      {/* The real screen only ever renders inline from
                        ProtectedRoute/AppShell while auth or org membership is
                        resolving. Fixed props reproduce the "setting up
                        organisation" mid-boot state in design/appboot.png. */}
                      <Route
                        path="/appboot"
                        element={<AppBootScreen authResolved orgResolved={false} />}
                      />
                      {/* /onboarding writes real rows. ?step=1|2|5 reproduces the
                        reference-designed steps against mock local state. */}
                      <Route
                        path="/onboarding-preview"
                        element={<OnboardingPreviewPage />}
                      />
                      {/* design/Workforce-Dashboard.png's numbers. */}
                      <Route
                        path="/dashboard-preview"
                        element={<DashboardPreviewPage />}
                      />
                      {/* Mirrors RotaBuilderPage's render tree against mock data. */}
                      <Route
                        path="/rota-builder-preview"
                        element={<RotaBuilderPreviewPage />}
                      />
                      {/* design/published-schedule.png's numbers. */}
                      <Route path="/schedule-preview" element={<SchedulePreviewPage />} />
                      {/* design/Timesheets-Dashboard.png's numbers. */}
                      <Route
                        path="/timesheets-preview"
                        element={<TimesheetsPreviewPage />}
                      />
                      {/* design/clockin.png. */}
                      <Route path="/clockin-preview" element={<ClockInPreviewPage />} />
                      {/* design/staff.png and design/Staff-Profile.png. */}
                      <Route path="/staff-preview" element={<StaffPreviewPage />} />
                      <Route
                        path="/staff-preview/:staffId"
                        element={<StaffProfilePreviewPage />}
                      />
                      {/* design/Locations-Management.png and
                        design/Location-department.png, merged into one
                        tabbed workspace. ?tab=departments opens the second. */}
                      <Route
                        path="/locations-preview"
                        element={<LocationsPreviewPage />}
                      />
                      <Route
                        path="/locations-preview/departments"
                        element={<LocationsPreviewPage />}
                      />
                      {/* design/Announcements-Dashboard.png's rows and metrics. */}
                      <Route
                        path="/announcements-preview"
                        element={<AnnouncementsPreviewPage />}
                      />
                    </>
                  )}
                  {/* Public on purpose: an invitee has no account yet, and
                    preview_invite is granted to anon so they can see who
                    invited them before signing up. */}
                  <Route path="/invite/:token" element={<AcceptInvitePage />} />
                  <Route
                    path="/onboarding"
                    element={
                      <ProtectedRoute>
                        <OnboardingPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/app"
                    element={
                      <ProtectedRoute>
                        <AppShell />
                      </ProtectedRoute>
                    }
                  >
                    <Route index element={<Navigate to="dashboard" replace />} />
                    <Route path="dashboard" element={<DashboardPage />} />
                    <Route path="staff" element={<StaffPage />} />
                    <Route path="staff/:staffId" element={<StaffProfilePage />} />
                    <Route path="team" element={<TeamPage />} />
                    <Route path="locations" element={<LocationsPage />} />
                    {/* Second half of the same workspace, on its own URL so it
                      can be linked and refreshed into. */}
                    <Route path="locations/departments" element={<LocationsPage />} />
                    <Route path="rota" element={<RotaBuilderPage />} />
                    <Route path="schedule" element={<SchedulePage />} />
                    <Route path="clock" element={<ClockInPage />} />
                    <Route path="timesheets" element={<TimesheetsPage />} />
                    <Route path="availability" element={<AvailabilityPage />} />
                    <Route path="leave" element={<LeavePage />} />
                    <Route path="swaps" element={<SwapsPage />} />
                    <Route path="announcements" element={<AnnouncementsPage />} />
                    <Route path="notifications" element={<NotificationsPage />} />
                    <Route path="integrations" element={<IntegrationsPage />} />
                    <Route path="settings" element={<OrgSettingsPage />} />
                    <Route path="reports" element={<ReportsPage />} />
                    <Route path="account" element={<AccountSettingsPage />} />
                  </Route>
                  <Route path="*" element={<NotFoundPage />} />
                </Routes>
              </Suspense>

              {/* Global PWA affordances */}
              <UpdatePrompt />
              <InstallPrompt />
              <OfflineBanner />
            </BrowserRouter>
          </OrgProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
