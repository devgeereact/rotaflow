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
import { HomePage } from '@/pages/HomePage';
import { LoginPage } from '@/pages/LoginPage';
import { OnboardingPage } from '@/pages/OnboardingPage';
import { AcceptInvitePage } from '@/pages/AcceptInvitePage';
import { SignupPage } from '@/pages/SignupPage';
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
import { TeamPage } from '@/pages/app/TeamPage';
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
