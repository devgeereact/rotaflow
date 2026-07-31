import { Suspense, lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/context/AuthContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { ToastProvider } from '@/context/ToastContext';
import { ConfirmProvider } from '@/context/ConfirmContext';
import { OrgProvider } from '@/context/OrgContext';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { RequireRole } from '@/components/RequireRole';
import type { MembershipRole } from '@/types';
import { AppShell } from '@/components/layout/AppShell';
import { InstallPrompt } from '@/components/InstallPrompt';
import { UpdatePrompt } from '@/components/UpdatePrompt';
import { OfflineBanner } from '@/components/OfflineBanner';
import { SplashScreen } from '@/components/SplashScreen';
import { AppBootScreen } from '@/components/AppBootScreen';
import { HomePage } from '@/pages/HomePage';
import { LoginPage } from '@/pages/LoginPage';
import { OnboardingPage } from '@/pages/OnboardingPage';
import { OnboardingPreviewPage } from '@/pages/OnboardingPreviewPage';
import { RotaBuilderPreviewPage } from '@/pages/RotaBuilderPreviewPage';
import { SchedulePreviewPage } from '@/pages/SchedulePreviewPage';
import { TimesheetsPreviewPage } from '@/pages/TimesheetsPreviewPage';
import { AvailabilityPreviewPage } from '@/pages/AvailabilityPreviewPage';
import { ClockInPreviewPage } from '@/pages/ClockInPreviewPage';
import { AcceptInvitePage } from '@/pages/AcceptInvitePage';
import { SignupPage } from '@/pages/SignupPage';
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
import { TeamPage } from '@/pages/app/TeamPage';
import { SchedulePage } from '@/pages/app/SchedulePage';
import { ClockInPage } from '@/pages/app/ClockInPage';
import { TimesheetsPage } from '@/pages/app/TimesheetsPage';
import { AvailabilityPage } from '@/pages/app/AvailabilityPage';
import { LeavePage } from '@/pages/app/LeavePage';
import { SwapsPage } from '@/pages/app/SwapsPage';
import { AnnouncementsPage } from '@/pages/app/AnnouncementsPage';
import { NotificationsPage } from '@/pages/app/NotificationsPage';
import { IntegrationsPage } from '@/pages/app/IntegrationsPage';
import { OrgSettingsPage } from '@/pages/app/OrgSettingsPage';
import { ReportsPage } from '@/pages/app/ReportsPage';
import { AccountSettingsPage } from '@/pages/app/AccountSettingsPage';
import { DashboardPage } from '@/pages/app/DashboardPage';
import { DashboardPreviewPage } from '@/pages/app/DashboardPreviewPage';
import { StaffPage } from '@/pages/app/StaffPage';
import { LocationsPage } from '@/pages/app/LocationsPage';
import { RotaBuilderPage } from '@/pages/app/RotaBuilderPage';
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

/**
 * A preview page — DEV only, and **absent from the production bundle**.
 *
 * The routes below were already gated behind `import.meta.env.DEV`, which
 * correctly made them unreachable in production. But the `lazyPage(...)` calls
 * that defined them sat at module top level, outside the gate, so Rollup still
 * saw thirteen live `import()` expressions and emitted a chunk for each. Those
 * chunks were written to `dist/assets/`, listed in the service worker's
 * precache manifest, and therefore **downloaded by every user on first visit**
 * — 87 kB of fabricated staff names, invented metrics and mock organisations,
 * on the phone of a carer on ward wifi.
 *
 * Gating the definition rather than only the usage is what actually removes
 * them. Vite replaces `import.meta.env.DEV` with the literal `false`, so the
 * whole ternary folds to the stub and Rollup drops the `import()` along with
 * every preview page and mock dataset behind it.
 *
 * Verify with `grep -c PreviewPage dist/sw.js` after a build: it must be 0.
 */
function devPage<K extends string>(
  name: K,
  loader: () => Promise<Record<K, ComponentType>>,
): ComponentType {
  return import.meta.env.DEV ? lazyPage(name, loader) : NotFoundPage;
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
/*
 * Marketing routes. Lazy for the same reason the app routes are: a visitor
 * landing on `/` should not download the pricing FAQ and the contact form's
 * validation before the hero paints. `HomePage` itself stays eager below —
 * it is the entry point, and on a genuinely first visit (no service worker
 * yet) lazy-loading it would add a round trip to the first impression.
 */
const FeaturesPage = lazyPage('FeaturesPage', () => import('@/pages/FeaturesPage'));
const SolutionsPage = lazyPage('SolutionsPage', () => import('@/pages/SolutionsPage'));
const PricingPage = lazyPage('PricingPage', () => import('@/pages/PricingPage'));
const ResourcesPage = lazyPage('ResourcesPage', () => import('@/pages/ResourcesPage'));
const AboutPage = lazyPage('AboutPage', () => import('@/pages/AboutPage'));
const ContactPage = lazyPage('ContactPage', () => import('@/pages/ContactPage'));

const OnboardingPage = lazyPage('OnboardingPage', () => import('@/pages/OnboardingPage'));
const OnboardingPreviewPage = devPage(
  'OnboardingPreviewPage',
  () => import('@/pages/OnboardingPreviewPage'),
);
const RotaBuilderPreviewPage = devPage(
  'RotaBuilderPreviewPage',
  () => import('@/pages/RotaBuilderPreviewPage'),
);
const SchedulePreviewPage = devPage(
  'SchedulePreviewPage',
  () => import('@/pages/SchedulePreviewPage'),
);
const TimesheetsPreviewPage = devPage(
  'TimesheetsPreviewPage',
  () => import('@/pages/TimesheetsPreviewPage'),
);
const ClockInPreviewPage = devPage(
  'ClockInPreviewPage',
  () => import('@/pages/ClockInPreviewPage'),
);
const StaffPreviewPage = devPage(
  'StaffPreviewPage',
  () => import('@/pages/StaffPreviewPage'),
);
const StaffProfilePreviewPage = devPage(
  'StaffProfilePreviewPage',
  () => import('@/pages/StaffProfilePreviewPage'),
);
const LocationsPreviewPage = devPage(
  'LocationsPreviewPage',
  () => import('@/pages/LocationsPreviewPage'),
);
const AnnouncementsPreviewPage = devPage(
  'AnnouncementsPreviewPage',
  () => import('@/pages/AnnouncementsPreviewPage'),
);
const SwapsPreviewPage = devPage(
  'SwapsPreviewPage',
  () => import('@/pages/SwapsPreviewPage'),
);
const ReportsPreviewPage = devPage(
  'ReportsPreviewPage',
  () => import('@/pages/ReportsPreviewPage'),
);
const LeavePreviewPage = devPage(
  'LeavePreviewPage',
  () => import('@/pages/LeavePreviewPage'),
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
const ReportsPage = lazyPage('ReportsPage', () => import('@/pages/app/ReportsPage'));
const DashboardPage = lazyPage(
  'DashboardPage',
  () => import('@/pages/app/DashboardPage'),
);
const DashboardPreviewPage = devPage(
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

/*
 * Settings and My Profile — the fourteen tabbed sections.
 *
 * `settingsTabs.ts` has listed these routes since #62 and NOTHING rendered
 * them: the file was imported only by its own unit test, so every tab in the
 * bar resolved to the `*` catch-all and produced the 404 page. They are real
 * routes from here.
 */
const SettingsLayout = lazyPage(
  'SettingsLayout',
  () => import('@/components/layout/SettingsLayout'),
);
const SettingsOrganisationPage = lazyPage(
  'SettingsOrganisationPage',
  () => import('@/pages/app/settings/SettingsOrganisationPage'),
);
const SettingsPermissionsPage = lazyPage(
  'SettingsPermissionsPage',
  () => import('@/pages/app/settings/SettingsPermissionsPage'),
);
const SettingsRolesPage = lazyPage(
  'SettingsRolesPage',
  () => import('@/pages/app/settings/SettingsRolesPage'),
);
const SettingsPoliciesPage = lazyPage(
  'SettingsPoliciesPage',
  () => import('@/pages/app/settings/SettingsPoliciesPage'),
);
const SettingsNotificationsPage = lazyPage(
  'SettingsNotificationsPage',
  () => import('@/pages/app/settings/SettingsNotificationsPage'),
);
const SettingsIntegrationsPage = lazyPage(
  'SettingsIntegrationsPage',
  () => import('@/pages/app/settings/SettingsIntegrationsPage'),
);
const SettingsBillingPage = lazyPage(
  'SettingsBillingPage',
  () => import('@/pages/app/settings/SettingsBillingPage'),
);
const SettingsAuditPage = lazyPage(
  'SettingsAuditPage',
  () => import('@/pages/app/settings/SettingsAuditPage'),
);
const ProfileLayout = lazyPage(
  'ProfileLayout',
  () => import('@/components/layout/ProfileLayout'),
);
const ProfilePage = lazyPage(
  'ProfilePage',
  () => import('@/pages/app/account/ProfilePage'),
);
const PreferencesPage = lazyPage(
  'PreferencesPage',
  () => import('@/pages/app/account/PreferencesPage'),
);
const SecurityPage = lazyPage(
  'SecurityPage',
  () => import('@/pages/app/account/SecurityPage'),
);
const SessionsPage = lazyPage(
  'SessionsPage',
  () => import('@/pages/app/account/SessionsPage'),
);
const TokensPage = lazyPage('TokensPage', () => import('@/pages/app/account/TokensPage'));
const ActivityPage = lazyPage(
  'ActivityPage',
  () => import('@/pages/app/account/ActivityPage'),
);

/**
 * Roles that may reach the manager-only routes. Named once so the route table
 * cannot drift into allowing `['owner']` on one screen and
 * `['owner','manager']` on the next by a copy-paste.
 */
const MANAGERIAL: readonly MembershipRole[] = ['owner', 'manager'];

export function App(): JSX.Element {
  return (
    <ThemeProvider>
      {/* Outside AuthProvider so sign-in/sign-out failures can surface too. */}
      <ToastProvider>
        <AuthProvider>
          <OrgProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/signup" element={<SignupPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/splash" element={<SplashScreen />} />
                {/* Design-loop preview only — the real screen only ever
                    renders inline from ProtectedRoute/AppShell while auth or
                    org membership is resolving. Fixed props reproduce the
                    "setting up organisation" mid-boot state in design/appboot.png. */}
                <Route
                  path="/appboot"
                  element={<AppBootScreen authResolved orgResolved={false} />}
                />
                {/* Design-loop preview only — /onboarding needs a real
                    Supabase session and writes real rows. ?step=1|2|5
                    reproduces the reference-designed steps against mock
                    local state. */}
                <Route path="/onboarding-preview" element={<OnboardingPreviewPage />} />
                {/* Design-loop preview only — /app/dashboard needs a real
                    Supabase session and a seeded organisation. Fixed mock
                    data reproduces design/Workforce-Dashboard.png's numbers. */}
                <Route path="/dashboard-preview" element={<DashboardPreviewPage />} />
                {/* Design-loop preview only — /app/rota needs a real
                    Supabase session, org and shifts. Mirrors RotaBuilderPage's
                    render tree against local mock data. */}
                <Route
                  path="/rota-builder-preview"
                  element={<RotaBuilderPreviewPage />}
                />
                {/* Design-loop preview only — /app/schedule needs a real
                    Supabase session and a published rota. Fixed mock data
                    reproduces design/published-schedule.png's numbers. */}
                <Route path="/schedule-preview" element={<SchedulePreviewPage />} />
                {/* Design-loop preview only — /app/timesheets needs a real
                    Supabase session and clock events. Fixed mock data
                    reproduces design/Timesheets-Dashboard.png's numbers. */}
                <Route path="/timesheets-preview" element={<TimesheetsPreviewPage />} />
                {/* Design-loop preview only — /app/availability needs a real
                    Supabase session and availability rows. Fixed mock data
                    reproduces design/Availability.png. */}
                <Route
                  path="/availability-preview"
                  element={<AvailabilityPreviewPage />}
                />
                {/* Design-loop preview only — /app/clock-in needs a real
                    Supabase session, a staff profile and a scheduled shift.
                    Fixed mock data reproduces design/clockin.png. */}
                <Route path="/clockin-preview" element={<ClockInPreviewPage />} />
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
                      {/* Manager-only areas.

                        The gate used to live inside whichever page remembered
                        it — as a one-line card, worded differently each time —
                        and the staff directory, staff profiles and locations
                        had none at all, so a staff member who deep-linked to
                        them got the full manager interface with every write
                        failing silently on RLS. Declaring it on the Route means
                        a new page cannot forget. RLS is still the real
                        boundary; this only turns a wrong turn into an
                        explanation. See `RequireRole`. */}
                      <Route
                        path="staff"
                        element={
                          <RequireRole allow={MANAGERIAL} area="the staff directory">
                            <StaffPage />
                          </RequireRole>
                        }
                      />
                      <Route
                        path="staff/:staffId"
                        element={
                          <RequireRole allow={MANAGERIAL} area="staff profiles">
                            <StaffProfilePage />
                          </RequireRole>
                        }
                      />
                      {/* Team folded into Settings -> Permissions: it is
                      invite/revoke, i.e. organisation administration, and the
                      designed sidebar has no Team entry. Redirect kept so
                      existing links and bookmarks survive. */}
                      <Route
                        path="team"
                        element={<Navigate to="/app/settings/permissions" replace />}
                      />
                      <Route
                        path="locations"
                        element={
                          <RequireRole allow={MANAGERIAL} area="locations">
                            <LocationsPage />
                          </RequireRole>
                        }
                      />
                      {/* Second half of the same workspace, on its own URL so it
                      can be linked and refreshed into. */}
                      <Route
                        path="locations/departments"
                        element={
                          <RequireRole allow={MANAGERIAL} area="locations">
                            <LocationsPage />
                          </RequireRole>
                        }
                      />
                      <Route
                        path="rota"
                        element={
                          <RequireRole allow={MANAGERIAL} area="the rota builder">
                            <RotaBuilderPage />
                          </RequireRole>
                        }
                      />
                      <Route path="schedule" element={<SchedulePage />} />
                      <Route path="clock" element={<ClockInPage />} />
                      <Route path="timesheets" element={<TimesheetsPage />} />
                      <Route path="availability" element={<AvailabilityPage />} />
                      <Route path="leave" element={<LeavePage />} />
                      <Route path="swaps" element={<SwapsPage />} />
                      <Route path="announcements" element={<AnnouncementsPage />} />
                      <Route path="notifications" element={<NotificationsPage />} />
                      <Route
                        path="reports"
                        element={
                          <RequireRole allow={MANAGERIAL} area="reports">
                            <ReportsPage />
                          </RequireRole>
                        }
                      />
                      {/* Integrations moved under Settings, as the design shows. */}
                      <Route
                        path="integrations"
                        element={<Navigate to="/app/settings/integrations" replace />}
                      />
                      <Route path="settings" element={<SettingsLayout />}>
                        <Route index element={<Navigate to="organisation" replace />} />
                        <Route
                          path="organisation"
                          element={<SettingsOrganisationPage />}
                        />
                        <Route path="permissions" element={<SettingsPermissionsPage />} />
                        <Route path="roles" element={<SettingsRolesPage />} />
                        <Route path="policies" element={<SettingsPoliciesPage />} />
                        <Route
                          path="notifications"
                          element={<SettingsNotificationsPage />}
                        />
                        <Route
                          path="integrations"
                          element={<SettingsIntegrationsPage />}
                        />
                        <Route path="billing" element={<SettingsBillingPage />} />
                        <Route path="audit" element={<SettingsAuditPage />} />
                      </Route>
                      <Route path="account" element={<ProfileLayout />}>
                        <Route index element={<Navigate to="profile" replace />} />
                        <Route path="profile" element={<ProfilePage />} />
                        <Route path="preferences" element={<PreferencesPage />} />
                        <Route path="security" element={<SecurityPage />} />
                        <Route path="sessions" element={<SessionsPage />} />
                        <Route path="tokens" element={<TokensPage />} />
                        <Route path="activity" element={<ActivityPage />} />
                      </Route>
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
        </ConfirmProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
