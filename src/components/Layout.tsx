import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { formatContactSubtitle } from '../lib/contactFields';
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

type NavLink = {
  kind: 'link';
  path: string;
  icon: React.ReactNode;
  label: string;
};

type NavGroup = {
  kind: 'group';
  label: string;
  icon: React.ReactNode;
  children: { path: string; icon: React.ReactNode; label: string }[];
};

type NavEntry = NavLink | NavGroup;

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

  const getNavEntries = (): NavEntry[] => {
    switch (user.role) {
      case 'super_admin':
        return [
          { kind: 'link', path: '/admin', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
          {
            kind: 'group',
            label: 'Regional Center',
            icon: <Building2 size={20} />,
            children: [
              { path: '/admin/rc', icon: <Building2 size={18} />, label: 'Regional Centers' },
              { path: '/admin/vct', icon: <Users size={18} />, label: 'VCT' },
            ],
          },
          { kind: 'link', path: '/admin/products', icon: <Package size={20} />, label: 'Products' },
          { kind: 'link', path: '/admin/reports', icon: <BarChart3 size={20} />, label: 'Reports' },
        ];
      case 'rc_admin':
        return [
          { kind: 'link', path: '/rc', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
          { kind: 'link', path: '/rc/vct', icon: <Users size={20} />, label: 'My Technicians' },
          { kind: 'link', path: '/rc/queue', icon: <ClipboardList size={20} />, label: 'Job Queue' },
          { kind: 'link', path: '/rc/reports', icon: <BarChart3 size={20} />, label: 'Reports' },
          { kind: 'link', path: '/rc/profile', icon: <Settings size={20} />, label: 'My Profile' },
        ];
      case 'vct':
        return [
          { kind: 'link', path: '/vct', icon: <ClipboardList size={20} />, label: 'Job Queue' },
          { kind: 'link', path: '/vct/certificates', icon: <Award size={20} />, label: 'Certificates' },
          { kind: 'link', path: '/vct/reports', icon: <BarChart3 size={20} />, label: 'Reports' },
        ];
      default:
        return [];
    }
  };

  const navEntries = getNavEntries();

  const getPageTitle = () => {
    for (const entry of navEntries) {
      if (entry.kind === 'link' && entry.path === location.pathname) {
        return entry.label;
      }
      if (entry.kind === 'group') {
        const child = entry.children.find(c => c.path === location.pathname);
        if (child) return child.label;
      }
    }
    return 'Dashboard';
  };

  const roleLabel = {
    super_admin: 'Super Admin',
    rc_admin: 'RC Admin',
    vct: 'VCT Technician',
  }[user.role];

  const renderNavLink = (
    path: string,
    icon: React.ReactNode,
    label: string,
    sub = false,
  ) => (
    <div
      key={path}
      className={`nav-item${sub ? ' nav-item--sub' : ''} ${location.pathname === path ? 'active' : ''}`}
      onClick={() => navigate(path)}
      title={!isMobile && collapsed ? label : undefined}
    >
      <div className="nav-icon">{icon}</div>
      <span className="nav-label">{label}</span>
    </div>
  );

  const sidebarContent = (mobile: boolean) => {
    const showLabels = mobile || !collapsed;

    return (
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
              src="/dark logo.png"
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
          {navEntries.map(entry => {
            if (entry.kind === 'link') {
              return renderNavLink(entry.path, entry.icon, entry.label);
            }

            const groupActive = entry.children.some(c => c.path === location.pathname);

            return (
              <div key={entry.label} className={`nav-group${groupActive ? ' nav-group--active' : ''}`}>
                {showLabels && (
                  <div className="nav-group-label">
                    <span className="nav-group-label-icon">{entry.icon}</span>
                    <span>{entry.label}</span>
                  </div>
                )}
                {entry.children.map(child => renderNavLink(child.path, child.icon, child.label, showLabels))}
              </div>
            );
          })}
        </nav>

        {showLabels && (
          <div className="sidebar-footer">
            <ShieldCheck size={14} />
            <span>{roleLabel}</span>
          </div>
        )}
      </>
    );
  };

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
