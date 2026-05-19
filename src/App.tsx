import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { AppProvider } from './context/AppContext';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';

import { Login } from './pages/Login';
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { Products } from './pages/admin/Products';
import { UserManagement } from './pages/admin/UserManagement';
import { RCList } from './pages/admin/RCList';
import { RCDashboard } from './pages/rc/RCDashboard';
import { VCTManagement } from './pages/rc/VCTManagement';
import { RCProfile } from './pages/rc/RCProfile';
import { RCJobQueue } from './pages/rc/RCJobQueue';
import { VCTDashboard } from './pages/vct/VCTDashboard';
import { Certificates } from './pages/vct/Certificates';
import { Reports } from './pages/shared/Reports';
import { Placeholder } from './pages/Placeholder';

const App: React.FC = () => {
  return (
    <AuthProvider>
      <AppProvider>
        <Router>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Navigate to="/login" replace />} />

            {/* Super Admin Routes */}
            <Route element={<ProtectedRoute allowedRoles={['super_admin']} />}>
              <Route path="/admin" element={<Layout />}>
                <Route index element={<AdminDashboard />} />
                <Route path="rc" element={<RCList />} />
                <Route path="products" element={<Products />} />
                <Route path="users" element={<UserManagement />} />
                <Route path="reports" element={<Reports />} />
              </Route>
            </Route>

            {/* RC Admin Routes */}
            <Route element={<ProtectedRoute allowedRoles={['rc_admin']} />}>
              <Route path="/rc" element={<Layout />}>
                <Route index element={<RCDashboard />} />
                <Route path="vct" element={<VCTManagement />} />
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
      </AppProvider>
    </AuthProvider>
  );
};

export default App;
