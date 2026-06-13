import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { formatContactSubtitle } from '../lib/contactFields';
import { rcProfilePhotoFromUser } from '../lib/rcProfileFields';
import { vctProfilePhotoFromUser } from '../lib/vctProfileFields';
import { MobileAppBarBrandIcon } from './MobileAppBarBrandIcon';
import { StorageImage } from './StorageImage';
import { VehicleLogoMark } from './VehicleLogoMark';
import {
  LayoutDashboard,
  Building2,
  Package,
  BarChart3,
  ClipboardList,
  Menu,
  X,
  UserCircle,
  ShieldCheck,
  Plug,
  Settings,
  UserRound,
  Wrench,
  Scale,
  ClipboardCheck,
  Bell,
  UserPlus,
  Sparkles,
  GraduationCap,
  LogOut,
  Wallet,
} from 'lucide-react';

import { useHistoryOverlay } from '../hooks/useHistoryOverlay';
import type { FirestoreUserDoc } from '../types';

type NavItem = {
  path: string;
  icon: React.ReactNode;
  label: string;
  pageTitle?: string;
  mobileSubtitle?: string;
};

export const Layout: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [suppressSidebarOverlayHistory, setSuppressSidebarOverlayHistory] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [profilePhoto, setProfilePhoto] = useState<{ url?: string; path?: string } | null>(null);
  const [pageRefreshKey, setPageRefreshKey] = useState(0);

  const profilePath =
    user?.role === 'rc_admin' ? '/rc/profile' : user?.role === 'vct' ? '/vct/profile' : null;

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    setSuppressSidebarOverlayHistory(true);
    setMobileOpen(false);
  }, [location.pathname]);

  useHistoryOverlay(isMobile && mobileOpen, () => setMobileOpen(false), {
    suppressHistoryBackWhenInactive: suppressSidebarOverlayHistory,
  });

  useEffect(() => {
    if (!user?.uid || (user.role !== 'rc_admin' && user.role !== 'vct')) {
      setProfilePhoto(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (cancelled || !snap.exists()) return;
        const data = snap.data() as FirestoreUserDoc;
        const photo =
          user.role === 'rc_admin'
            ? rcProfilePhotoFromUser(data)
            : vctProfilePhotoFromUser(data);
        setProfilePhoto(photo ? { url: photo.url, path: photo.path } : null);
      } catch {
        if (!cancelled) setProfilePhoto(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.uid, user?.role, location.pathname]);

  if (!user) return null;

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const handleNavClick = (path: string) => {
    if (location.pathname === path) {
      setPageRefreshKey(key => key + 1);
    } else {
      navigate(path);
    }
    setSuppressSidebarOverlayHistory(true);
    setMobileOpen(false);
  };

  const getNavItems = (): NavItem[] => {
    switch (user.role) {
      case 'super_admin':
        return [
          { path: '/admin', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
          {
            path: '/admin/verifications',
            icon: <ShieldCheck size={20} />,
            label: 'Verification',
            mobileSubtitle: 'Powered by AI',
          },
          { path: '/admin/wallet', icon: <Wallet size={20} />, label: 'Wallet' },
          { path: '/admin/products', icon: <Package size={20} />, label: 'Products' },
          { path: '/admin/vehicles', icon: <VehicleLogoMark size="sm" variant="plain" />, label: 'Vehicle' },
          { path: '/admin/rc', icon: <Building2 size={20} />, label: 'Regional Centers' },
          {
            path: '/admin/technicians',
            icon: <Wrench size={20} />,
            label: 'Technician',
            pageTitle: 'Verification and Calibration Technician',
          },
          { path: '/admin/laboratory', icon: <Scale size={20} />, label: 'Laboratory' },
          { path: '/admin/quality-management', icon: <ClipboardCheck size={20} />, label: 'Quality Management' },
          { path: '/admin/notifications', icon: <Bell size={20} />, label: 'Notifications' },
          { path: '/admin/reports', icon: <BarChart3 size={20} />, label: 'Reports' },
          { path: '/admin/integrations', icon: <Plug size={20} />, label: 'Integrations' },
        ];
      case 'rc_admin':
        return [
          { path: '/rc', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
          { path: '/rc/wallet', icon: <Wallet size={20} />, label: 'Wallet' },
          { path: '/rc/leads', icon: <UserPlus size={20} />, label: 'Leads' },
          { path: '/rc/new-job', icon: <ClipboardList size={20} />, label: 'New Job' },
          { path: '/rc/verification', icon: <ShieldCheck size={20} />, label: 'Verification', mobileSubtitle: 'Powered by AI' },
          { path: '/rc/customers', icon: <UserRound size={20} />, label: 'Customer' },
          { path: '/rc/products', icon: <Package size={20} />, label: 'Product' },
          {
            path: '/rc/vct',
            icon: <Wrench size={20} />,
            label: 'Technician',
            pageTitle: 'Verification and Calibration Technician',
          },
          { path: '/rc/vehicles', icon: <VehicleLogoMark size="sm" variant="plain" />, label: 'Vehicle' },
          { path: '/rc/laboratory', icon: <Scale size={20} />, label: 'Laboratory' },
          { path: '/rc/quality-management', icon: <ClipboardCheck size={20} />, label: 'Quality Management' },
          { path: '/rc/notifications', icon: <Bell size={20} />, label: 'Notifications' },
          { path: '/rc/reports', icon: <BarChart3 size={20} />, label: 'Report' },
          { path: '/rc/profile', icon: <Settings size={20} />, label: 'My profile' },
        ];
      case 'vct':
        return [
          { path: '/vct', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
          { path: '/vct/leads', icon: <UserPlus size={20} />, label: 'Leads' },
          { path: '/vct/new-job', icon: <ClipboardList size={20} />, label: 'New Job' },
          { path: '/vct/verification', icon: <ShieldCheck size={20} />, label: 'Verification', mobileSubtitle: 'Powered by AI' },
          { path: '/vct/customers', icon: <UserRound size={20} />, label: 'Customer' },
          { path: '/vct/products', icon: <Package size={20} />, label: 'Product' },
          { path: '/vct/training', icon: <GraduationCap size={20} />, label: 'Training' },
          { path: '/vct/notifications', icon: <Bell size={20} />, label: 'Notifications' },
          { path: '/vct/reports', icon: <BarChart3 size={20} />, label: 'Report' },
          { path: '/vct/profile', icon: <Settings size={20} />, label: 'My profile' },
        ];
      default:
        return [];
    }
  };

  const navItems = getNavItems();
  const currentNavItem = navItems.find(item => {
    if (location.pathname === item.path) {
      return true;
    }
    if (item.path === '/admin' || item.path === '/rc' || item.path === '/vct') {
      return false;
    }
    return location.pathname.startsWith(`${item.path}/`);
  });
  const pageTitle = currentNavItem?.pageTitle ?? currentNavItem?.label ?? 'Dashboard';
  const pageIcon = currentNavItem?.icon ?? <LayoutDashboard size={22} />;
  const useShieldBrand = location.pathname.includes('verification');
  const isLaboratoryPage = /\/laboratory$/.test(location.pathname);

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
            onClick={() => handleNavClick(item.path)}
            title={!mobile && collapsed ? item.label : undefined}
          >
            <div className="nav-icon">{item.icon}</div>
            <span className="nav-label">{item.label}</span>
          </div>
        ))}
      </nav>

      {user.role === 'super_admin' && (
        <div className={`sidebar-mobile-account${!mobile && collapsed ? ' sidebar-mobile-account--collapsed' : ''}`}>
          {(!collapsed || mobile) && (
            <div className="sidebar-mobile-user">
              <UserCircle size={28} className="text-blue shrink-0" />
              <div className="sidebar-mobile-user-text">
                <div className="sidebar-mobile-user-name">{user.username}</div>
                <div className="sidebar-mobile-user-meta text-muted">{roleLabel}</div>
              </div>
            </div>
          )}
          <button
            type="button"
            className="sidebar-mobile-logout"
            onClick={() => void handleLogout()}
            title={!mobile && collapsed ? 'Logout' : undefined}
          >
            <LogOut size={16} aria-hidden />
            <span className="sidebar-logout-label">Logout</span>
          </button>
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
        className={`main-content ${!isMobile && collapsed ? 'expanded' : ''} ${isMobile ? 'mobile-main' : ''}${useShieldBrand ? ' mobile-verification' : ''}${isMobile && isLaboratoryPage ? ' mobile-laboratory-dashboard' : ''}`}
      >
        {isMobile && (
          <header className={`mobile-app-bar${useShieldBrand ? ' mobile-app-bar--sticky' : ''}`}>
            <button
              type="button"
              className="mobile-app-bar-menu collapse-btn"
              onClick={() => {
                setSuppressSidebarOverlayHistory(false);
                setMobileOpen(true);
              }}
              title="Open menu"
              aria-label="Open menu"
            >
              <Menu size={22} />
            </button>
            <div className="mobile-app-bar-brand">
              <MobileAppBarBrandIcon variant={useShieldBrand ? 'shield' : 'page'}>
                {!useShieldBrand ? pageIcon : null}
              </MobileAppBarBrandIcon>
              <div className="mobile-app-bar-text">
                <h1 className="mobile-app-bar-title">{pageTitle}</h1>
                {currentNavItem?.mobileSubtitle && (
                  <p className="mobile-app-bar-subtitle">
                    <Sparkles size={14} className="mobile-app-bar-subtitle-icon" aria-hidden />
                    {currentNavItem.mobileSubtitle}
                  </p>
                )}
              </div>
            </div>
            {isLaboratoryPage ? (
              <div className="mobile-app-bar-actions">
                {profilePath ? (
                  <button
                    type="button"
                    className={`mobile-profile-shortcut${location.pathname === profilePath ? ' mobile-profile-shortcut--active' : ''}`}
                    onClick={() => navigate(profilePath)}
                    title="My profile"
                    aria-label="Open my profile"
                  >
                    {profilePhoto?.url || profilePhoto?.path ? (
                      <StorageImage
                        url={profilePhoto.url}
                        path={profilePhoto.path}
                        alt=""
                        className="mobile-profile-shortcut-img"
                      />
                    ) : (
                      <span className="mobile-profile-shortcut-placeholder" aria-hidden>
                        <UserCircle size={22} className="text-blue" />
                      </span>
                    )}
                  </button>
                ) : (
                  <span className="mobile-profile-shortcut mobile-profile-shortcut--static" aria-hidden>
                    <UserCircle size={22} className="text-blue" />
                  </span>
                )}
                {user.role !== 'super_admin' && (
                  <button
                    type="button"
                    className="mobile-logout-shortcut"
                    onClick={() => void handleLogout()}
                    title="Logout"
                    aria-label="Logout"
                  >
                    <LogOut size={20} className="text-red" aria-hidden />
                  </button>
                )}
              </div>
            ) : profilePath ? (
              <button
                type="button"
                className={`mobile-profile-shortcut${location.pathname === profilePath ? ' mobile-profile-shortcut--active' : ''}`}
                onClick={() => navigate(profilePath)}
                title="My profile"
                aria-label="Open my profile"
              >
                {profilePhoto?.url || profilePhoto?.path ? (
                  <StorageImage
                    url={profilePhoto.url}
                    path={profilePhoto.path}
                    alt=""
                    className="mobile-profile-shortcut-img"
                  />
                ) : (
                  <span className="mobile-profile-shortcut-placeholder" aria-hidden>
                    <UserCircle size={22} className="text-blue" />
                  </span>
                )}
              </button>
            ) : null}
          </header>
        )}
        {!isMobile && (
          <header className="top-bar glass">
            <h1 className="page-title">{pageTitle}</h1>
            {profilePath ? (
              <button
                type="button"
                className="user-chip user-chip--profile-link"
                onClick={() => navigate(profilePath)}
                title="My profile"
              >
                {profilePhoto?.url || profilePhoto?.path ? (
                  <StorageImage
                    url={profilePhoto.url}
                    path={profilePhoto.path}
                    alt=""
                    className="user-chip-avatar"
                  />
                ) : (
                  <UserCircle size={20} className="text-blue" />
                )}
                <div className="user-info">
                  <span className="user-name">{user.username}</span>
                  <span className="user-email text-muted">{formatContactSubtitle(user)}</span>
                </div>
              </button>
            ) : (
              <div className="user-chip">
                <UserCircle size={20} className="text-blue" />
                <div className="user-info">
                  <span className="user-name">{user.username}</span>
                  <span className="user-email text-muted">{formatContactSubtitle(user)}</span>
                </div>
              </div>
            )}
          </header>
        )}
        <div className="content-area">
          <Outlet key={`${location.pathname}-${pageRefreshKey}`} />
        </div>
      </main>
    </div>
  );
};
