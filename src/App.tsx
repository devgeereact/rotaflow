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
import { OnboardingPage } from '@/pages/OnboardingPage';
import { OnboardingPreviewPage } from '@/pages/OnboardingPreviewPage';
import { RotaBuilderPreviewPage } from '@/pages/RotaBuilderPreviewPage';
import { SchedulePreviewPage } from '@/pages/SchedulePreviewPage';
import { TimesheetsPreviewPage } from '@/pages/TimesheetsPreviewPage';
import { ClockInPreviewPage } from '@/pages/ClockInPreviewPage';
import { StaffPreviewPage } from '@/pages/StaffPreviewPage';
import { StaffProfilePreviewPage } from '@/pages/StaffProfilePreviewPage';
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
import { StaffProfilePage } from '@/pages/app/StaffProfilePage';
import { LocationsPage } from '@/pages/app/LocationsPage';
import { RotaBuilderPage } from '@/pages/app/RotaBuilderPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

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
                    <Route path="/dashboard-preview" element={<DashboardPreviewPage />} />
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
