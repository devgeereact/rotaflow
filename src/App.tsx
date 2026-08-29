import { Suspense, lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/context/AuthContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { ToastProvider } from '@/context/ToastContext';
import { ConfirmProvider } from '@/context/ConfirmContext';
import { OrgProvider } from '@/context/OrgContext';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { RequireRole } from '@/components/RequireRole';
import { RequirePlatformAdmin } from '@/components/RequirePlatformAdmin';
import { RequirePlatformRole } from '@/components/RequirePlatformRole';
import { PLATFORM_BILLING_ROLES, PLATFORM_CONFIG_ROLES } from '@/lib/platformRoles';
import type { MembershipRole } from '@/types';
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
import {
  AuthCallbackPage,
  ProfileRedirect,
  StaffMemberRedirect,
} from '@/components/RouteAliases';

/**
 * `React.lazy` for a module that uses a NAMED export. Every page in this
 * project does, and `lazy` insists on a default.
 *
 * The dynamic `import()` stays a literal inside the caller's arrow function so
 * Rollup can still see it statically and split the chunk. Passing a pre-built
 * promise here would defeat that silently.
 */
function lazyPage<K extends string>(
  name: K,
  loader: () => Promise<Record<K, ComponentType>>,
): LazyExoticComponent<ComponentType> {
  return lazy(() => loader().then((m) => ({ default: m[name] })));
}

/**
 * A preview page. DEV only, and **absent from the production bundle**.
 *
 * The routes below were already gated behind `import.meta.env.DEV`, which
 * correctly made them unreachable in production. But the `lazyPage(...)` calls
 * that defined them sat at module top level, outside the gate, so Rollup still
 * saw thirteen live `import()` expressions and emitted a chunk for each. Those
 * chunks were written to `dist/assets/`, listed in the service worker's
 * precache manifest, and therefore **downloaded by every user on first visit**
 *, 87 kB of fabricated staff names, invented metrics and mock organisations,
 * on the phone of a carer on ward wifi.
 *
 * Gating the definition rather than only the usage is what actually removes
 * them. Vite replaces `import.meta.env.DEV` with the literal `false`, so the
 * whole ternary folds to the stub and Rollup drops the `import()` along with
 * every preview page and mock dataset behind it.
 *
 * CI enforces this since 2026-08-30 — `npm run check:bundle` fails the build if
 * any preview chunk is emitted or precached, so the rule is no longer carried
 * by this comment alone. Locally: build, then `npm run check:bundle`.
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
 * public entry points, and on a genuinely first visit, no service worker yet,
 * lazy-loading them would add a round trip to the moment first impressions are
 * made. Everything behind auth is lazy; by then the service worker has
 * precached every chunk, so those loads come from cache and offline still works.
 */
/*
 * Marketing routes. Lazy for the same reason the app routes are: a visitor
 * landing on `/` should not download the pricing FAQ and the contact form's
 * validation before the hero paints. `HomePage` itself stays eager below,
 * it is the entry point, and on a genuinely first visit (no service worker
 * yet) lazy-loading it would add a round trip to the first impression.
 */
const FeaturesPage = lazyPage('FeaturesPage', () => import('@/pages/FeaturesPage'));
const SolutionsPage = lazyPage('SolutionsPage', () => import('@/pages/SolutionsPage'));
const PricingPage = lazyPage('PricingPage', () => import('@/pages/PricingPage'));
const ResourcesPage = lazyPage('ResourcesPage', () => import('@/pages/ResourcesPage'));
const AboutPage = lazyPage('AboutPage', () => import('@/pages/AboutPage'));
const ContactPage = lazyPage('ContactPage', () => import('@/pages/ContactPage'));
const PrivacyPage = lazyPage('PrivacyPage', () => import('@/pages/legal/PrivacyPage'));
const TermsPage = lazyPage('TermsPage', () => import('@/pages/legal/TermsPage'));
const CookiesPage = lazyPage('CookiesPage', () => import('@/pages/legal/CookiesPage'));
const AccessibilityPage = lazyPage(
  'AccessibilityPage',
  () => import('@/pages/legal/AccessibilityPage'),
);

const OnboardingPage = lazyPage('OnboardingPage', () => import('@/pages/OnboardingPage'));
const OnboardingPreviewPage = devPage(
  'OnboardingPreviewPage',
  () => import('@/pages/OnboardingPreviewPage'),
);
const RotaBuilderPreviewPage = devPage(
  'RotaBuilderPreviewPage',
  () => import('@/pages/RotaBuilderPreviewPage'),
);
const TimesheetsPreviewPage = devPage(
  'TimesheetsPreviewPage',
  () => import('@/pages/app/TimesheetsPreviewPage'),
);
const ClockInPreviewPage = devPage(
  'ClockInPreviewPage',
  () => import('@/pages/ClockInPreviewPage'),
);
const StaffPreviewPage = devPage(
  'StaffPreviewPage',
  () => import('@/pages/app/StaffPreviewPage'),
);
const StaffProfilePreviewPage = devPage(
  'StaffProfilePreviewPage',
  () => import('@/pages/app/StaffProfilePreviewPage'),
);
const LocationsPreviewPage = devPage(
  'LocationsPreviewPage',
  () => import('@/pages/LocationsPreviewPage'),
);
const AnnouncementsPreviewPage = devPage(
  'AnnouncementsPreviewPage',
  () => import('@/pages/AnnouncementsPreviewPage'),
);
const ReportsPreviewPage = devPage(
  'ReportsPreviewPage',
  () => import('@/pages/ReportsPreviewPage'),
);
const AppShellPreviewPage = devPage(
  'AppShellPreviewPage',
  () => import('@/pages/AppShellPreviewPage'),
);
const DashboardLivePreviewPage = devPage(
  'DashboardLivePreviewPage',
  () => import('@/pages/app/DashboardLivePreviewPage'),
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
const OvertimePage = lazyPage('OvertimePage', () => import('@/pages/app/OvertimePage'));
const AnnouncementsPage = lazyPage(
  'AnnouncementsPage',
  () => import('@/pages/app/AnnouncementsPage'),
);
const NotificationsPage = lazyPage(
  'NotificationsPage',
  () => import('@/pages/app/NotificationsPage'),
);
const ReportsPage = lazyPage('ReportsPage', () => import('@/pages/app/ReportsPage'));
const HelpPage = lazyPage('HelpPage', () => import('@/pages/app/HelpPage'));
const DashboardPage = lazyPage(
  'DashboardPage',
  () => import('@/pages/app/DashboardPage'),
);
const DashboardPreviewPage = devPage(
  'DashboardPreviewPage',
  () => import('@/pages/app/DashboardPreviewPage'),
);
const SchedulePreviewPage = devPage(
  'SchedulePreviewPage',
  () => import('@/pages/app/SchedulePreviewPage'),
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
 * Settings and My Profile. The fourteen tabbed sections.
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
const ConnectedAccountsPage = lazyPage(
  'ConnectedAccountsPage',
  () => import('@/pages/app/account/ConnectedAccountsPage'),
);

// Platform administration. Lazy like every other area, so a tenant user never
// downloads the cross-tenant screens they cannot open.
const AdminShell = lazyPage('AdminShell', () => import('@/components/layout/AdminShell'));
const AdminOverviewPage = lazyPage(
  'AdminOverviewPage',
  () => import('@/pages/admin/AdminOverviewPage'),
);
const AdminOrganisationsPage = lazyPage(
  'AdminOrganisationsPage',
  () => import('@/pages/admin/AdminOrganisationsPage'),
);
const AdminOrganisationDetailPage = lazyPage(
  'AdminOrganisationDetailPage',
  () => import('@/pages/admin/AdminOrganisationDetailPage'),
);
const AdminUserDetailPage = lazyPage(
  'AdminUserDetailPage',
  () => import('@/pages/admin/AdminUserDetailPage'),
);
const AdminSubscriptionsPage = lazyPage(
  'AdminSubscriptionsPage',
  () => import('@/pages/admin/AdminSubscriptionsPage'),
);
const AdminSettingsPage = lazyPage(
  'AdminSettingsPage',
  () => import('@/pages/admin/AdminSettingsPage'),
);
const AdminUsersPage = lazyPage(
  'AdminUsersPage',
  () => import('@/pages/admin/AdminUsersPage'),
);
const AdminBillingPage = lazyPage(
  'AdminBillingPage',
  () => import('@/pages/admin/AdminBillingPage'),
);
const AdminSupportPage = lazyPage(
  'AdminSupportPage',
  () => import('@/pages/admin/AdminSupportPage'),
);
const AdminSupportCaseDetailPage = lazyPage(
  'AdminSupportCaseDetailPage',
  () => import('@/pages/admin/AdminSupportCaseDetailPage'),
);
const AdminAuditPage = lazyPage(
  'AdminAuditPage',
  () => import('@/pages/admin/AdminAuditPage'),
);
const AdminFeatureFlagsPage = lazyPage(
  'AdminFeatureFlagsPage',
  () => import('@/pages/admin/AdminFeatureFlagsPage'),
);
const AdminPlatformHealthPage = lazyPage(
  'AdminPlatformHealthPage',
  () => import('@/pages/admin/AdminPlatformHealthPage'),
);
const AdminIncidentsPage = lazyPage(
  'AdminIncidentsPage',
  () => import('@/pages/admin/AdminIncidentsPage'),
);
const AdminSupportAccessPage = lazyPage(
  'AdminSupportAccessPage',
  () => import('@/pages/admin/AdminSupportAccessPage'),
);
const AdminGdprPage = lazyPage(
  'AdminGdprPage',
  () => import('@/pages/admin/AdminGdprPage'),
);
const AdminPreviewHarness = devPage(
  'AdminPreviewHarness',
  () => import('@/pages/admin/AdminPreviewHarness'),
);
const AdminIntegrationsPage = lazyPage(
  'AdminIntegrationsPage',
  () => import('@/pages/admin/AdminIntegrationsPage'),
);
const AdminNotificationsPage = lazyPage(
  'AdminNotificationsPage',
  () => import('@/pages/admin/AdminNotificationsPage'),
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
        {/* Above AuthProvider: a confirmation may be raised from anywhere,
            including sign-out. */}
        <ConfirmProvider>
          <AuthProvider>
            <OrgProvider>
              <BrowserRouter>
                {/* Covers the lazy PUBLIC routes (signup, onboarding, invite,
                  password reset). /app/* has its own boundary inside AppShell
                  so the chrome survives navigation. See there. */}
                <Suspense fallback={<RouteFallback />}>
                  <Routes>
                    <Route path="/" element={<HomePage />} />
                    {/* Public marketing site. Every one of these is linked from
                      PublicNav or PublicFooter, and navigationTargets.test.ts
                      asserts each link resolves to a Route declared here. The
                      nav and the route table cannot drift apart silently. */}
                    <Route path="/features" element={<FeaturesPage />} />
                    <Route path="/solutions" element={<SolutionsPage />} />
                    <Route path="/pricing" element={<PricingPage />} />
                    <Route path="/resources" element={<ResourcesPage />} />
                    <Route path="/about" element={<AboutPage />} />
                    <Route path="/contact" element={<ContactPage />} />
                    <Route path="/legal/privacy" element={<PrivacyPage />} />
                    <Route path="/legal/terms" element={<TermsPage />} />
                    <Route path="/legal/cookies" element={<CookiesPage />} />
                    <Route path="/legal/accessibility" element={<AccessibilityPage />} />
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/signup" element={<SignupPage />} />
                    <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                    <Route path="/reset-password" element={<ResetPasswordPage />} />
                    <Route path="/splash" element={<SplashScreen />} />
                    {/* Where an OAuth provider or magic link may return. See
                      RouteAliases for why this exists when sign-in already
                      redirects straight to the dashboard. */}
                    <Route path="/auth/callback" element={<AuthCallbackPage />} />
                    {/* ---------------------------------------------------------
                    Design-loop preview routes. DEV ONLY.

                    Every screen below lives behind auth in the real product and
                    needs a Supabase session, an org and seeded rows that the
                    design loop cannot produce, so each preview renders the same
                    component tree against fixed mock data chosen to reproduce
                    its reference PNG's exact numbers. See docs/LOOP.md.

                    They shipped to production unguarded until 2026-07-31: all
                    seven answered 200 unauthenticated in production, so
                    anyone who guessed a URL got a page of invented staff names
                    and metrics with no branding and no way back into the app.
                    Every preview page and its mock dataset was also carried in
                    the production bundle.

                    `import.meta.env.DEV` is statically replaced with `false` at
                    build time, so Rollup drops this whole branch AND tree-shakes
                    the preview pages and their mock modules out of the bundle.
                    The loop is unaffected. It drives the dev server, where DEV
                    is true. Keep new preview routes inside this block.
                    --------------------------------------------------------- */}
                    {import.meta.env.DEV && (
                      <>
                        {/* The real screen only ever renders inline from
                        ProtectedRoute/AppShell while auth or org membership is
                        resolving. Fixed props reproduce the "setting up
                        organisation" mid-boot state in docs/design/appboot.png. */}
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
                        {/* docs/design/Workforce-Dashboard.png's numbers. */}
                        <Route
                          path="/dashboard-preview"
                          element={<DashboardPreviewPage />}
                        />
                        {/* Mirrors RotaBuilderPage's render tree against mock data. */}
                        <Route
                          path="/rota-builder-preview"
                          element={<RotaBuilderPreviewPage />}
                        />
                        {/* Renders the real ManagerSchedule/StaffSchedule; ?role=staff switches branch. */}
                        <Route
                          path="/schedule-preview"
                          element={<SchedulePreviewPage />}
                        />
                        {/* docs/design/Timesheets-Dashboard.png's numbers. */}
                        <Route
                          path="/timesheets-preview"
                          element={<TimesheetsPreviewPage />}
                        />
                        {/* docs/design/clockin.png. */}
                        <Route path="/clockin-preview" element={<ClockInPreviewPage />} />
                        {/* The whole platform console against fixtures, with the
                        real shell and the real page components. The only way to
                        look at `/admin/*` without a seeded platform-admin
                        session. See `AdminPreviewHarness`. */}
                        <Route path="/admin-preview" element={<AdminPreviewHarness />}>
                          <Route index element={<AdminOverviewPage />} />
                          <Route
                            path="organisations"
                            element={<AdminOrganisationsPage />}
                          />
                          <Route
                            path="organisations/:organisationId"
                            element={<AdminOrganisationDetailPage />}
                          />
                          <Route path="users" element={<AdminUsersPage />} />
                          <Route path="users/:userId" element={<AdminUserDetailPage />} />
                          <Route
                            path="subscriptions"
                            element={<AdminSubscriptionsPage />}
                          />
                          <Route path="billing" element={<AdminBillingPage />} />
                          <Route path="support" element={<AdminSupportPage />} />
                          <Route
                            path="support/:caseId"
                            element={<AdminSupportCaseDetailPage />}
                          />
                          <Route
                            path="support-access"
                            element={<AdminSupportAccessPage />}
                          />
                          <Route
                            path="platform-health"
                            element={<AdminPlatformHealthPage />}
                          />
                          <Route path="incidents" element={<AdminIncidentsPage />} />
                          <Route
                            path="integrations"
                            element={<AdminIntegrationsPage />}
                          />
                          <Route
                            path="notifications"
                            element={<AdminNotificationsPage />}
                          />
                          <Route path="audit" element={<AdminAuditPage />} />
                          <Route
                            path="feature-flags"
                            element={<AdminFeatureFlagsPage />}
                          />
                          <Route path="gdpr" element={<AdminGdprPage />} />
                          <Route path="settings" element={<AdminSettingsPage />} />
                        </Route>
                        {/* docs/design/staff.png and docs/design/Staff-Profile.png. */}
                        <Route path="/staff-preview" element={<StaffPreviewPage />} />
                        <Route
                          path="/staff-preview/:staffId"
                          element={<StaffProfilePreviewPage />}
                        />
                        {/* docs/design/Locations-Management.png and
                        docs/design/Location-department.png, merged into one
                        tabbed workspace. ?tab=departments opens the second. */}
                        <Route
                          path="/locations-preview"
                          element={<LocationsPreviewPage />}
                        />
                        <Route
                          path="/locations-preview/departments"
                          element={<LocationsPreviewPage />}
                        />
                        {/* docs/design/Announcements-Dashboard.png's rows and metrics. */}
                        <Route
                          path="/announcements-preview"
                          element={<AnnouncementsPreviewPage />}
                        />
                        {/* docs/design/Reports-Dashboard.png's catalogue and figures. */}
                        <Route path="/reports-preview" element={<ReportsPreviewPage />} />
                        {/* The whole organisation workspace shell (rail, org
                        switcher, topbar, mobile tab bar) against a stubbed
                        OrgContext, with the real *PreviewPage components
                        routed inside it. See AppShellPreviewPage.
                        ?role=owner|manager|staff switches the stubbed role. */}
                        <Route path="/app-preview/*" element={<AppShellPreviewPage />} />
                        {/* The real DashboardPage, hooks and service calls
                        included, against a fetch-intercepted Supabase client
                        with realistic edge-case fixtures (null settings, a
                        null holiday_allowance, an orphaned leave request, a
                        null department_id). See DashboardLivePreviewPage. */}
                        <Route
                          path="/dashboard-live-preview"
                          element={<DashboardLivePreviewPage />}
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
                      {/* Manager-only areas.

                        The gate used to live inside whichever page remembered
                        it, as a one-line card, worded differently each time, and the staff directory, staff profiles and locations
                        had none at all, so a staff member who deep-linked to
                        them got the full manager interface with every write
                        failing silently on RLS. Declaring it on the Route means
                        a new page cannot forget. RLS is still the real
                        boundary; this only turns a wrong turn into an
                        explanation. See `RequireRole`. */}
                      {/* NEW_STRUCTURE §10/§34: the workforce directory lives
                      at /app/team, and the sidebar entry is "Team". It was
                      built at /app/staff, so that spelling now redirects here
                      rather than the other way round. Every bookmark and
                      every link already sent to staff still resolves. */}
                      <Route
                        path="team"
                        element={
                          <RequireRole allow={MANAGERIAL} area="the team directory">
                            <StaffPage />
                          </RequireRole>
                        }
                      />
                      <Route
                        path="team/:staffId"
                        element={
                          <RequireRole allow={MANAGERIAL} area="staff profiles">
                            <StaffProfilePage />
                          </RequireRole>
                        }
                      />
                      <Route path="staff" element={<Navigate to="/app/team" replace />} />
                      <Route path="staff/:staffId" element={<StaffMemberRedirect />} />
                      <Route
                        path="locations"
                        element={
                          <RequireRole allow={MANAGERIAL} area="locations">
                            <LocationsPage />
                          </RequireRole>
                        }
                      />
                      {/* SCREENS.locations folded department and staffing-
                      minimum management into per-card dialogs on the one
                      screen (LocationsPage), rather than a second tab or a
                      per-site detail route. Both old URLs still resolve. */}
                      <Route
                        path="locations/departments"
                        element={<Navigate to="/app/locations" replace />}
                      />
                      <Route
                        path="locations/:locationId"
                        element={<Navigate to="/app/locations" replace />}
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
                      {/* The spec's spelling. See RouteAliases. */}
                      <Route
                        path="clock-in"
                        element={<Navigate to="/app/clock" replace />}
                      />
                      <Route path="timesheets" element={<TimesheetsPage />} />
                      <Route path="availability" element={<AvailabilityPage />} />
                      <Route path="leave" element={<LeavePage />} />
                      <Route path="swaps" element={<SwapsPage />} />
                      {/* Open to every member: a staff member raises their own
                      overtime here, and the page's Team toggle is what gates
                      the approval queue behind `canApprove`. */}
                      <Route path="overtime" element={<OvertimePage />} />
                      <Route path="announcements" element={<AnnouncementsPage />} />
                      <Route path="notifications" element={<NotificationsPage />} />
                      <Route path="help" element={<HelpPage />} />
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
                        <Route path="accounts" element={<ConnectedAccountsPage />} />
                        <Route path="sessions" element={<SessionsPage />} />
                        <Route path="tokens" element={<TokensPage />} />
                        <Route path="activity" element={<ActivityPage />} />
                      </Route>
                      {/* The spec calls this area "My Profile" at
                        /app/profile/*. See RouteAliases. */}
                      <Route path="profile/*" element={<ProfileRedirect />} />
                    </Route>

                    {/* Platform administration (NEW_STRUCTURE §34). Outside
                    `/app` deliberately: this area sits above organisations, and
                    it is gated on `profiles.is_platform_admin` rather than on a
                    membership role, §2 is explicit that Super Admin is not one.
                    `ProtectedRoute` still applies, so an anonymous visitor is
                    sent to sign in rather than told the area exists. */}
                    <Route
                      path="/admin"
                      element={
                        <ProtectedRoute>
                          <RequirePlatformAdmin>
                            <AdminShell />
                          </RequirePlatformAdmin>
                        </ProtectedRoute>
                      }
                    >
                      <Route index element={<AdminOverviewPage />} />
                      <Route path="organisations" element={<AdminOrganisationsPage />} />
                      <Route
                        path="organisations/:organisationId"
                        element={<AdminOrganisationDetailPage />}
                      />
                      <Route path="users" element={<AdminUsersPage />} />
                      <Route path="users/:userId" element={<AdminUserDetailPage />} />
                      <Route
                        path="subscriptions"
                        element={
                          <RequirePlatformRole
                            allow={PLATFORM_BILLING_ROLES}
                            area="Subscriptions"
                          >
                            <AdminSubscriptionsPage />
                          </RequirePlatformRole>
                        }
                      />
                      <Route
                        path="settings"
                        element={
                          <RequirePlatformRole
                            allow={PLATFORM_CONFIG_ROLES}
                            area="Platform settings"
                          >
                            <AdminSettingsPage />
                          </RequirePlatformRole>
                        }
                      />
                      {/* Billing and feature flags are narrower than the area
                      itself: `adminNavForRole` hides them from a support
                      administrator, and §34 is explicit that restricted routes
                      "must not rely only on hidden navigation". So the route
                      gates too, a hidden link that still renders when typed is
                      not a permission, it is a decoration. The role lists mirror
                      the `has_platform_role(...)` predicates in the migrations. */}
                      <Route
                        path="billing"
                        element={
                          <RequirePlatformRole
                            allow={PLATFORM_BILLING_ROLES}
                            area="Platform billing"
                          >
                            <AdminBillingPage />
                          </RequirePlatformRole>
                        }
                      />
                      <Route path="support" element={<AdminSupportPage />} />
                      <Route
                        path="support/:caseId"
                        element={<AdminSupportCaseDetailPage />}
                      />
                      <Route path="support-access" element={<AdminSupportAccessPage />} />
                      <Route path="audit" element={<AdminAuditPage />} />
                      <Route
                        path="platform-health"
                        element={<AdminPlatformHealthPage />}
                      />
                      <Route path="incidents" element={<AdminIncidentsPage />} />
                      <Route path="integrations" element={<AdminIntegrationsPage />} />
                      {/* Config roles only: this reads every tenant's delivery
                      record, which is a cross-tenant view of who was told what.
                      The nav hides it for support and finance, and so does the
                      route, a hidden link that renders when typed is not a
                      permission. */}
                      <Route
                        path="notifications"
                        element={
                          <RequirePlatformRole
                            allow={PLATFORM_CONFIG_ROLES}
                            area="Platform notifications"
                          >
                            <AdminNotificationsPage />
                          </RequirePlatformRole>
                        }
                      />
                      <Route path="gdpr" element={<AdminGdprPage />} />
                      <Route
                        path="feature-flags"
                        element={
                          <RequirePlatformRole
                            allow={PLATFORM_CONFIG_ROLES}
                            area="Feature flags"
                          >
                            <AdminFeatureFlagsPage />
                          </RequirePlatformRole>
                        }
                      />
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
