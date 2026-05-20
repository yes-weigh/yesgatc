import React, { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  LayoutDashboard,
  Building2,
  Package,
  BarChart3,
  Users,
  ClipboardList,
  Award,
  LogOut,
  ChevronLeft,
  ChevronRight,
  UserCircle,
  ShieldCheck,
  Settings,
} from 'lucide-react';

export const Layout: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  if (!user) return null;

  const getNavItems = () => {
    switch (user.role) {
      case 'super_admin':
        return [
          { path: '/admin', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
          { path: '/admin/rc', icon: <Building2 size={20} />, label: 'Regional Centers' },
          { path: '/admin/products', icon: <Package size={20} />, label: 'Products' },
          { path: '/admin/reports', icon: <BarChart3 size={20} />, label: 'Reports' },
        ];
      case 'rc_admin':
        return [
          { path: '/rc', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
          { path: '/rc/vct', icon: <Users size={20} />, label: 'My Technicians' },
          { path: '/rc/queue', icon: <ClipboardList size={20} />, label: 'Job Queue' },
          { path: '/rc/reports', icon: <BarChart3 size={20} />, label: 'Reports' },
          { path: '/rc/profile', icon: <Settings size={20} />, label: 'My Profile' },
        ];
      case 'vct':
        return [
          { path: '/vct', icon: <ClipboardList size={20} />, label: 'Job Queue' },
          { path: '/vct/certificates', icon: <Award size={20} />, label: 'Certificates' },
          { path: '/vct/reports', icon: <BarChart3 size={20} />, label: 'Reports' },
        ];
      default:
        return [];
    }
  };

  const navItems = getNavItems();

  const getPageTitle = () => {
    const item = navItems.find(n => n.path === location.pathname);
    return item ? item.label : 'Dashboard';
  };

  const roleLabel = {
    super_admin: 'Super Admin',
    rc_admin: 'RC Admin',
    vct: 'VCT Technician',
  }[user.role];

  return (
    <div className="app-wrapper">
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          {!collapsed && (
            <div className="logo-area">
              <div className="logo-icon"></div>
              <span className="logo-text">GATC Flow</span>
            </div>
          )}
          {collapsed && <div className="logo-icon mx-auto"></div>}
          <button className="collapse-btn" onClick={() => setCollapsed(!collapsed)} title="Toggle sidebar">
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>

        <nav className="nav-menu">
          {navItems.map((item) => (
            <div
              key={item.path}
              className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
              onClick={() => navigate(item.path)}
              title={collapsed ? item.label : undefined}
            >
              <div className="nav-icon">{item.icon}</div>
              <span className="nav-label">{item.label}</span>
            </div>
          ))}
        </nav>

        {/* Role badge at bottom of sidebar */}
        {!collapsed && (
          <div className="sidebar-footer">
            <ShieldCheck size={14} />
            <span>{roleLabel}</span>
          </div>
        )}
      </aside>

      <main className={`main-content ${collapsed ? 'expanded' : ''}`}>
        <header className="top-bar glass">
          <h1 className="page-title">{getPageTitle()}</h1>
          <div className="user-chip">
            <UserCircle size={20} className="text-blue" />
            <div className="user-info">
              <span className="user-name">{user.username}</span>
              <span className="user-email text-muted">{user.email}</span>
            </div>
            <button className="logout-btn" onClick={handleLogout}>
              <LogOut size={16} />
              <span>Logout</span>
            </button>
          </div>
        </header>
        <div className="content-area">
          <Outlet />
        </div>
      </main>
    </div>
  );
};
