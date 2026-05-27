import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { formatContactSubtitle } from '../lib/contactFields';
import {
  LayoutDashboard,
  Building2,
  Package,
  BarChart3,
  ClipboardList,
  Award,
  LogOut,
  Menu,
  X,
  UserCircle,
  ShieldCheck,
  Truck,
  Upload,
  UserRound,
  Wrench,
  Scale,
  ClipboardCheck,
  Bell,
  UserPlus,
} from 'lucide-react';

type NavItem = {
  path: string;
  icon: React.ReactNode;
  label: string;
  pageTitle?: string;
};

export const Layout: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  if (!user) return null;

  const getNavItems = (): NavItem[] => {
    switch (user.role) {
      case 'super_admin':
        return [
          { path: '/admin', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
          { path: '/admin/rc', icon: <Building2 size={20} />, label: 'Regional Centers' },
          {
            path: '/admin/technicians',
            icon: <Wrench size={20} />,
            label: 'Technician',
            pageTitle: 'Verification and Calibration Technician',
          },
          { path: '/admin/vehicles', icon: <Truck size={20} />, label: 'Vehicle' },
          { path: '/admin/verifications', icon: <ShieldCheck size={20} />, label: 'Verification' },
          { path: '/admin/products', icon: <Package size={20} />, label: 'Products' },
          { path: '/admin/reports', icon: <BarChart3 size={20} />, label: 'Reports' },
        ];
      case 'rc_admin':
        return [
          { path: '/rc', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
          { path: '/rc/leads', icon: <UserPlus size={20} />, label: 'Leads' },
          { path: '/rc/new-job', icon: <ClipboardList size={20} />, label: 'New Job' },
          { path: '/rc/verification', icon: <ShieldCheck size={20} />, label: 'Verification' },
          { path: '/rc/upload-certificate', icon: <Upload size={20} />, label: 'Manual Upload' },
          { path: '/rc/customers', icon: <UserRound size={20} />, label: 'Customer' },
          { path: '/rc/products', icon: <Package size={20} />, label: 'Product' },
          {
            path: '/rc/vct',
            icon: <Wrench size={20} />,
            label: 'Technician',
            pageTitle: 'Verification and Calibration Technician',
          },
          { path: '/rc/vehicles', icon: <Truck size={20} />, label: 'Vehicle' },
          { path: '/rc/laboratory', icon: <Scale size={20} />, label: 'Laboratory' },
          { path: '/rc/quality-management', icon: <ClipboardCheck size={20} />, label: 'Quality Management' },
          { path: '/rc/notifications', icon: <Bell size={20} />, label: 'Notifications' },
          { path: '/rc/reports', icon: <BarChart3 size={20} />, label: 'Report' },
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
    return item?.pageTitle ?? item?.label ?? 'Dashboard';
  };

  const roleLabel = {
    super_admin: 'Super Admin',
    rc_admin: 'RC Admin',
    vct: 'VCT Technician',
  }[user.role];

  const sidebarContent = (mobile: boolean) => (
    <>
      <div
        className="sidebar-header"
        style={{ cursor: mobile ? 'default' : 'pointer' }}
        onClick={mobile ? undefined : () => setCollapsed(!collapsed)}
        title={mobile ? undefined : collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {mobile && (
          <button
            className="collapse-btn"
            onClick={() => setMobileOpen(false)}
            title="Close menu"
            style={{ marginRight: '0.5rem' }}
          >
            <X size={20} />
          </button>
        )}
        <div
          className="logo-area"
          style={{
            display: 'flex',
            alignItems: 'center',
            width: '100%',
            justifyContent: !mobile && collapsed ? 'center' : 'flex-start',
          }}
        >
          <img
            src="/brand/logo-dark.png"
            alt="YES LAB"
            style={
              !mobile && collapsed
                ? { maxHeight: '40px', maxWidth: '64px', objectFit: 'contain' }
                : { maxHeight: '40px', maxWidth: '160px', objectFit: 'contain' }
            }
          />
        </div>
      </div>

      <nav className="nav-menu">
        {navItems.map(item => (
          <div
            key={item.path}
            className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
            onClick={() => navigate(item.path)}
            title={!mobile && collapsed ? item.label : undefined}
          >
            <div className="nav-icon">{item.icon}</div>
            <span className="nav-label">{item.label}</span>
          </div>
        ))}
      </nav>

      {user.role !== 'rc_admin' && (mobile || !collapsed) && (
        <div className="sidebar-footer">
          <ShieldCheck size={14} />
          <span>{roleLabel}</span>
        </div>
      )}
    </>
  );

  return (
    <div className="app-wrapper">
      {!isMobile && (
        <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
          {sidebarContent(false)}
        </aside>
      )}

      {isMobile && mobileOpen && (
        <div className="sidebar-backdrop" onClick={() => setMobileOpen(false)} />
      )}

      {isMobile && (
        <aside className={`sidebar sidebar-mobile ${mobileOpen ? 'mobile-open' : ''}`}>
          {sidebarContent(true)}
        </aside>
      )}

      <main
        className={`main-content ${!isMobile && collapsed ? 'expanded' : ''} ${isMobile ? 'mobile-main' : ''}`}
      >
        <header className="top-bar glass">
          {isMobile && (
            <button
              className="collapse-btn"
              onClick={() => setMobileOpen(true)}
              title="Open menu"
              style={{ marginRight: '1rem' }}
            >
              <Menu size={22} />
            </button>
          )}
          <h1 className="page-title">{getPageTitle()}</h1>
          <div className="user-chip">
            <UserCircle size={20} className="text-blue" />
            <div className="user-info">
              <span className="user-name">{user.username}</span>
              <span className="user-email text-muted">{formatContactSubtitle(user)}</span>
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
