import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/context/AuthContext';
import { ThemeProvider } from '@/context/ThemeContext';
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
import { DashboardPage } from '@/pages/app/DashboardPage';
import { StaffPage } from '@/pages/app/StaffPage';
import { LocationsPage } from '@/pages/app/LocationsPage';
import { RotaBuilderPage } from '@/pages/app/RotaBuilderPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

export function App(): JSX.Element {
  return (
    <ThemeProvider>
      <AuthProvider>
        <OrgProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/splash" element={<SplashScreen />} />
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
    </ThemeProvider>
  );
}
