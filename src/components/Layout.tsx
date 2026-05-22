import React, { useState, useEffect } from 'react';
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
  Menu,
  X,
  UserCircle,
  ShieldCheck,
  Settings,
} from 'lucide-react';

export const Layout: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Desktop: collapsed = narrow icon-only sidebar
  const [collapsed, setCollapsed] = useState(false);
  // Mobile: mobileOpen = slide-in overlay sidebar
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

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

  const sidebarContent = (mobile: boolean) => (
    <>
      {/* Header / Logo */}
      <div
        className="sidebar-header"
        style={{ cursor: mobile ? 'default' : 'pointer' }}
        onClick={mobile ? undefined : () => setCollapsed(!collapsed)}
        title={mobile ? undefined : (collapsed ? 'Expand sidebar' : 'Collapse sidebar')}
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
            justifyContent: (!mobile && collapsed) ? 'center' : 'flex-start',
          }}
        >
          <img
            src="/dark logo.png"
            alt="YES LAB"
            style={
              (!mobile && collapsed)
                ? { maxHeight: '40px', maxWidth: '64px', objectFit: 'contain' }
                : { maxHeight: '40px', maxWidth: '160px', objectFit: 'contain' }
            }
          />
        </div>
      </div>

      {/* Nav */}
      <nav className="nav-menu">
        {navItems.map((item) => (
          <div
            key={item.path}
            className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
            onClick={() => navigate(item.path)}
            title={(!mobile && collapsed) ? item.label : undefined}
          >
            <div className="nav-icon">{item.icon}</div>
            <span className="nav-label">{item.label}</span>
          </div>
        ))}
      </nav>

      {/* Role badge */}
      {(mobile || !collapsed) && (
        <div className="sidebar-footer">
          <ShieldCheck size={14} />
          <span>{roleLabel}</span>
        </div>
      )}
    </>
  );

  return (
    <div className="app-wrapper">

      {/* ── Desktop Sidebar ── */}
      {!isMobile && (
        <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
          {sidebarContent(false)}
        </aside>
      )}

      {/* ── Mobile: Backdrop ── */}
      {isMobile && mobileOpen && (
        <div className="sidebar-backdrop" onClick={() => setMobileOpen(false)} />
      )}

      {/* ── Mobile: Slide-in Sidebar ── */}
      {isMobile && (
        <aside className={`sidebar sidebar-mobile ${mobileOpen ? 'mobile-open' : ''}`}>
          {sidebarContent(true)}
        </aside>
      )}

      {/* ── Main Content ── */}
      <main className={`main-content ${(!isMobile && collapsed) ? 'expanded' : ''} ${isMobile ? 'mobile-main' : ''}`}>
        <header className="top-bar glass">
          {/* Mobile hamburger */}
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
