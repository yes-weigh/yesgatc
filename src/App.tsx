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
import { RCDashboard } from './pages/rc/RCDashboard';
import { VCTManagement } from './pages/rc/VCTManagement';
import { RCProfile } from './pages/rc/RCProfile';
import { RCJobQueue } from './pages/rc/RCJobQueue';
import { RCVehicles } from './pages/rc/RCVehicles';
import { RCCustomers } from './pages/rc/RCCustomers';
import { RCProducts } from './pages/rc/RCProducts';
import {
  RCSiteCalibration,
  RCUploadCertificate,
  RCLaboratory,
  RCQualityManagement,
  RCNotifications,
} from './pages/rc/RCMenuPages';
import { VCTDashboard } from './pages/vct/VCTDashboard';
import { Certificates } from './pages/vct/Certificates';
import { Reports } from './pages/shared/Reports';
import { Placeholder } from './pages/Placeholder';

const App: React.FC = () => {
  return (
    <AuthProvider>
      <AppProvider>
        <ConfirmProvider>
        <Router>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Navigate to="/login" replace />} />

            {/* Super Admin Routes */}
            <Route element={<ProtectedRoute allowedRoles={['super_admin']} />}>
              <Route path="/admin" element={<Layout />}>
                <Route index element={<AdminDashboard />} />
                <Route path="rc" element={<RCList />} />
                <Route path="technicians" element={<AdminVCTList />} />
                <Route path="vct" element={<Navigate to="/admin/technicians" replace />} />
                <Route path="vehicles" element={<AdminVehicleList />} />
                <Route path="products" element={<Products />} />
                <Route path="reports" element={<Reports />} />
              </Route>
            </Route>

            {/* RC Admin Routes */}
            <Route element={<ProtectedRoute allowedRoles={['rc_admin']} />}>
              <Route path="/rc" element={<Layout />}>
                <Route index element={<RCDashboard />} />
                <Route path="site-calibration" element={<RCSiteCalibration />} />
                <Route path="upload-certificate" element={<RCUploadCertificate />} />
                <Route path="customers" element={<RCCustomers />} />
                <Route path="products" element={<RCProducts />} />
                <Route path="vct" element={<VCTManagement />} />
                <Route path="vehicles" element={<RCVehicles />} />
                <Route path="laboratory" element={<RCLaboratory />} />
                <Route path="quality-management" element={<RCQualityManagement />} />
                <Route path="notifications" element={<RCNotifications />} />
                <Route path="queue" element={<RCJobQueue />} />
                <Route path="reports" element={<Reports />} />
                <Route path="profile" element={<RCProfile />} />
              </Route>
            </Route>

            {/* VCT Routes */}
            <Route element={<ProtectedRoute allowedRoles={['vct']} />}>
              <Route path="/vct" element={<Layout />}>
                <Route index element={<VCTDashboard />} />
                <Route path="certificates" element={<Certificates />} />
                <Route path="reports" element={<Placeholder />} />
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
