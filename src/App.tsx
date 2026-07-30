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
import { DashboardPage } from '@/pages/app/DashboardPage';
import { StaffPage } from '@/pages/app/StaffPage';
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
