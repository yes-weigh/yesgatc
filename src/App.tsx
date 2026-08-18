import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { AppProvider } from './context/AppContext';
import { ConfirmProvider } from './context/ConfirmContext';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';

import { Login } from './pages/Login';
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { Products } from './pages/admin/Products';
import { RCList } from './pages/admin/RCList';
import { AdminVCTList } from './pages/admin/AdminVCTList';
import { AdminVehicleList } from './pages/admin/AdminVehicleList';
import { AdminVerificationList } from './pages/admin/AdminVerificationList';
import { AdminLaboratory } from './pages/admin/AdminLaboratory';
import { AdminWalletTopUps } from './pages/admin/AdminWalletTopUps';
import { AdminIntegrations } from './pages/admin/AdminIntegrations';
import { AdminPortalSettings } from './pages/admin/AdminPortalSettings';
import { AdminEmaapSessionLogs } from './pages/admin/AdminEmaapSessionLogs';
import { AdminNotifications } from './pages/admin/AdminMenuPages';
import { RCDashboard } from './pages/rc/RCDashboard';
import { VCTManagement } from './pages/rc/VCTManagement';
import { RCProfile } from './pages/rc/RCProfile';
import { RCWallet } from './pages/rc/RCWallet';
import { NewJobComingSoon } from './pages/rc/RCMenuPages';
import { RCVehicles } from './pages/rc/RCVehicles';
import { RCCustomers } from './pages/rc/RCCustomers';
import { RCProducts } from './pages/rc/RCProducts';
import { RCSiteCalibration } from './pages/rc/RCSiteCalibration';
import {
  RCLaboratory,
  RCNotifications,
  RCLeads,
} from './pages/rc/RCMenuPages';
import { VCTProfile } from './pages/vct/VCTProfile';
import { VCTTraining } from './pages/vct/VCTMenuPages';
import { Certificates } from './pages/vct/Certificates';
import { CertificateSign } from './pages/vct/CertificateSign';
import { ManualPdf } from './pages/shared/ManualPdf';
import { Reports } from './pages/shared/Reports';
import { PwaInstallBanner } from './components/PwaInstallBanner';

const App: React.FC = () => {
  return (
    <AuthProvider>
      <AppProvider>
        <ConfirmProvider>
        <PwaInstallBanner />
        <Router>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Navigate to="/login" replace />} />

            {/* Super Admin Routes */}
            <Route element={<ProtectedRoute allowedRoles={['super_admin']} />}>
              <Route path="/admin" element={<Layout />}>
                <Route index element={<AdminDashboard />} />
                <Route path="doca-scraping" element={<Navigate to="/admin/integrations/worker" replace />} />
                <Route path="verifications" element={<AdminVerificationList />} />
                <Route path="wallet" element={<AdminWalletTopUps />} />
                <Route path="products" element={<Products />} />
                <Route path="vehicles" element={<AdminVehicleList />} />
                <Route path="rc" element={<RCList />} />
                <Route path="technicians" element={<AdminVCTList />} />
                <Route path="vct" element={<Navigate to="/admin/technicians" replace />} />
                <Route path="laboratory" element={<AdminLaboratory />} />
                <Route path="manual-pdf" element={<ManualPdf />} />
                <Route path="quality-management" element={<Navigate to="/admin/manual-pdf" replace />} />
                <Route path="notifications" element={<AdminNotifications />} />
                <Route path="reports" element={<Reports />} />
                <Route path="integrations/worker/sessions" element={<AdminEmaapSessionLogs />} />
                <Route path="integrations/worker/sessions/:sessionId" element={<AdminEmaapSessionLogs />} />
                <Route path="integrations" element={<AdminIntegrations />} />
                <Route path="integrations/:integrationId" element={<AdminIntegrations />} />
                <Route path="settings" element={<AdminPortalSettings />} />
              </Route>
            </Route>

            {/* RC Admin Routes */}
            <Route element={<ProtectedRoute allowedRoles={['rc_admin']} />}>
              <Route path="/rc" element={<Layout />}>
                <Route index element={<RCDashboard />} />
                <Route path="new-job" element={<NewJobComingSoon />} />
                <Route path="verification" element={<RCSiteCalibration />} />
                <Route path="site-calibration" element={<Navigate to="/rc/verification" replace />} />
                <Route path="queue" element={<Navigate to="/rc/new-job" replace />} />
                <Route path="customers" element={<RCCustomers />} />
                <Route path="leads" element={<RCLeads />} />
                <Route path="products" element={<RCProducts />} />
                <Route path="vct" element={<VCTManagement />} />
                <Route path="vehicles" element={<RCVehicles />} />
                <Route path="laboratory" element={<RCLaboratory />} />
                <Route path="certificates" element={<Certificates />} />
                <Route path="certificates/:recordId" element={<CertificateSign />} />
                <Route path="manual-pdf" element={<ManualPdf />} />
                <Route path="quality-management" element={<Navigate to="/rc/manual-pdf" replace />} />
                <Route path="notifications" element={<RCNotifications />} />
                <Route path="reports" element={<Reports />} />
                <Route path="profile" element={<RCProfile />} />
                <Route path="wallet" element={<RCWallet />} />
              </Route>
            </Route>

            {/* VCT Routes */}
            <Route element={<ProtectedRoute allowedRoles={['vct']} />}>
              <Route path="/vct" element={<Layout />}>
                <Route index element={<RCDashboard />} />
                <Route path="leads" element={<RCLeads />} />
                <Route path="new-job" element={<NewJobComingSoon />} />
                <Route path="verification" element={<RCSiteCalibration />} />
                <Route path="customers" element={<RCCustomers />} />
                <Route path="products" element={<RCProducts />} />
                <Route path="vehicles" element={<RCVehicles />} />
                <Route path="laboratory" element={<RCLaboratory />} />
                <Route path="certificates" element={<Certificates />} />
                <Route path="certificates/:recordId" element={<CertificateSign />} />
                <Route path="manual-pdf" element={<ManualPdf />} />
                <Route path="quality-management" element={<Navigate to="/vct/manual-pdf" replace />} />
                <Route path="training" element={<VCTTraining />} />
                <Route path="notifications" element={<RCNotifications />} />
                <Route path="reports" element={<Reports />} />
                <Route path="profile" element={<VCTProfile />} />
                <Route path="queue" element={<Navigate to="/vct/new-job" replace />} />
              </Route>
            </Route>

          </Routes>
        </Router>
        </ConfirmProvider>
      </AppProvider>
    </AuthProvider>
  );
};

export default App;
