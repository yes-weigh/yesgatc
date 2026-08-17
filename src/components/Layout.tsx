import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { formatContactSubtitle } from '../lib/contactFields';
import { rcProfilePhotoFromUser } from '../lib/rcProfileFields';
import { vctProfilePhotoFromUser } from '../lib/vctProfileFields';
import { MobileAppBarBrandIcon } from './MobileAppBarBrandIcon';
import { EmaapStatusShortcut } from './EmaapStatusShortcut';
import { StorageImage } from './StorageImage';
import { VehicleLogoMark } from './VehicleLogoMark';
import { VctOfficerMark } from './VctOfficerMark';
import {
  LayoutDashboard,
  Building2,
  Package,
  BarChart3,
  Menu,
  X,
  UserCircle,
  ShieldCheck,
  Plug,
  Settings,
  UserRound,
  Scale,
  FileText,
  Bell,
  Sparkles,
  GraduationCap,
  LogOut,
  Wallet,
  Award,
} from 'lucide-react';

import { useHistoryOverlay } from '../hooks/useHistoryOverlay';
import { embedVerificationPath, isEmbedSession, rememberEmbedMode } from '../lib/embedMode';
import { APP_VERSION } from '../lib/appVersion';
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
  const [accountOpen, setAccountOpen] = useState(false);
  const [suppressAccountOverlayHistory, setSuppressAccountOverlayHistory] = useState(true);

  const profilePath =
    user?.role === 'rc_admin' ? '/rc/profile' : user?.role === 'vct' ? '/vct/profile' : null;

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    rememberEmbedMode();
    if (!isEmbedSession()) return undefined;
    document.body.classList.add('embed-mode');
    return () => document.body.classList.remove('embed-mode');
  }, []);

  useEffect(() => {
    if (!isEmbedSession()) return;
    if (location.pathname === '/rc' || location.pathname === '/rc/') {
      navigate(embedVerificationPath(), { replace: true });
    }
  }, [location.pathname, navigate]);

  useEffect(() => {
    setSuppressSidebarOverlayHistory(true);
    setSuppressAccountOverlayHistory(true);
    setMobileOpen(false);
    setAccountOpen(false);
  }, [location.pathname]);

  useHistoryOverlay(isMobile && mobileOpen, () => setMobileOpen(false), {
    suppressHistoryBackWhenInactive: suppressSidebarOverlayHistory,
  });

  useHistoryOverlay(accountOpen, () => setAccountOpen(false), {
    suppressHistoryBackWhenInactive: suppressAccountOverlayHistory,
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
    setSuppressAccountOverlayHistory(true);
    setAccountOpen(false);
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
          { path: '/admin/vehicles', icon: <VehicleLogoMark size="sm" variant="plain" />, label: 'Car' },
          { path: '/admin/rc', icon: <Building2 size={20} />, label: 'Regional Centers' },
          {
            path: '/admin/technicians',
            icon: <VctOfficerMark />,
            label: 'VCT',
            pageTitle: 'Verification and Calibration Technician',
          },
          { path: '/admin/laboratory', icon: <Scale size={20} />, label: 'Laboratory' },
          { path: '/admin/manual-pdf', icon: <FileText size={20} />, label: 'Manual PDF' },
          { path: '/admin/notifications', icon: <Bell size={20} />, label: 'Notifications' },
          { path: '/admin/reports', icon: <BarChart3 size={20} />, label: 'Reports' },
          { path: '/admin/integrations', icon: <Plug size={20} />, label: 'Integrations' },
        ];
      case 'rc_admin':
        return [
          { path: '/rc', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
          { path: '/rc/verification', icon: <ShieldCheck size={20} />, label: 'Verification', mobileSubtitle: 'Powered by AI' },
          { path: '/rc/certificates', icon: <Award size={20} />, label: 'Certificates' },
          { path: '/rc/customers', icon: <UserRound size={20} />, label: 'Customers' },
          { path: '/rc/wallet', icon: <Wallet size={20} />, label: 'Wallets' },
          { path: '/rc/products', icon: <Package size={20} />, label: 'Product' },
          {
            path: '/rc/vct',
            icon: <VctOfficerMark />,
            label: 'VCT',
            pageTitle: 'Verification and Calibration Technician',
          },
          { path: '/rc/vehicles', icon: <VehicleLogoMark size="sm" variant="plain" />, label: 'Car' },
          { path: '/rc/laboratory', icon: <Scale size={20} />, label: 'Laboratory' },
          { path: '/rc/manual-pdf', icon: <FileText size={20} />, label: 'Manual PDF' },
          { path: '/rc/reports', icon: <BarChart3 size={20} />, label: 'Reports' },
          { path: '/rc/profile', icon: <Settings size={20} />, label: 'My Profile' },
        ];
      case 'vct':
        return [
          { path: '/vct', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
          { path: '/vct/verification', icon: <ShieldCheck size={20} />, label: 'Verification', mobileSubtitle: 'Powered by AI' },
          { path: '/vct/certificates', icon: <Award size={20} />, label: 'Certificates' },
          { path: '/vct/customers', icon: <UserRound size={20} />, label: 'Customers' },
          { path: '/vct/products', icon: <Package size={20} />, label: 'Product' },
          { path: '/vct/vehicles', icon: <VehicleLogoMark size="sm" variant="plain" />, label: 'Car' },
          { path: '/vct/laboratory', icon: <Scale size={20} />, label: 'Laboratory' },
          { path: '/vct/manual-pdf', icon: <FileText size={20} />, label: 'Manual PDF' },
          { path: '/vct/training', icon: <GraduationCap size={20} />, label: 'Training' },
          { path: '/vct/reports', icon: <BarChart3 size={20} />, label: 'Reports' },
          { path: '/vct/profile', icon: <Settings size={20} />, label: 'My Profile' },
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
  const isEmaapSessions = location.pathname.includes('/integrations/worker/sessions');
  const pageTitle = isEmaapSessions
    ? 'Session Logs'
    : currentNavItem?.pageTitle ?? currentNavItem?.label ?? 'Dashboard';
  const pageIcon = currentNavItem?.icon ?? <LayoutDashboard size={22} />;
  const useShieldBrand = location.pathname.includes('verification');
  const isCertificatesList = /\/(rc|vct)\/certificates\/?$/.test(location.pathname);
  const isCustomersList = /\/(rc|vct)\/customers\/?$/.test(location.pathname);
  const isLaboratoryPage = /\/laboratory$/.test(location.pathname);
  const isHomeDashboard =
    location.pathname === '/rc' ||
    location.pathname === '/vct' ||
    location.pathname === '/admin';
  const showAppFilterSlot = useShieldBrand || isCertificatesList || isCustomersList;
  const stickyMobileAppBar = showAppFilterSlot || isHomeDashboard || isEmaapSessions;

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
            flexDirection: 'column',
            alignItems: !mobile && collapsed ? 'center' : 'flex-start',
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
          <span className="sidebar-app-version">{APP_VERSION}</span>
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
          <button
            type="button"
            className="sidebar-mobile-user sidebar-mobile-user--account"
            onClick={() => {
              setMobileOpen(false);
              setSuppressAccountOverlayHistory(false);
              setAccountOpen(true);
            }}
            title="Account"
            aria-label="Open account"
          >
            <span className="sidebar-mobile-user-icon" aria-hidden>
              <UserCircle size={28} className="text-blue shrink-0" />
            </span>
            {(!collapsed || mobile) && (
              <span className="sidebar-mobile-user-text">
                <span className="sidebar-mobile-user-name">{user.username}</span>
                <span className="sidebar-mobile-user-meta text-muted">{roleLabel}</span>
              </span>
            )}
          </button>
        </div>
      )}
    </>
  );

  const embed = isEmbedSession();

  return (
    <div className={`app-wrapper${embed ? ' embed-mode' : ''}`}>
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
        className={`main-content ${!isMobile && collapsed ? 'expanded' : ''} ${isMobile ? 'mobile-main' : ''}${useShieldBrand ? ' mobile-verification' : ''}${isMobile && isLaboratoryPage ? ' mobile-laboratory-dashboard' : ''}${isMobile && isHomeDashboard ? ' mobile-home-dashboard' : ''}`}
      >
        {isMobile && (
          <header
            className={`mobile-app-bar${stickyMobileAppBar ? ' mobile-app-bar--sticky' : ''}${
              isHomeDashboard ? ' mobile-app-bar--home' : ''
            }`}
          >
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
            {isHomeDashboard ? (
              <div className="mobile-app-bar-brand mobile-app-bar-brand--home">
                <div className="wl-brand-mark-wrap">
                  <img
                    className="wl-brand-mark"
                    src="/brand/weighlab-logo-dark.png"
                    alt=""
                    width={40}
                    height={40}
                    decoding="async"
                  />
                  <span className="wl-brand-version">{APP_VERSION}</span>
                </div>
                <div className="mobile-app-bar-text">
                  <h1 className="mobile-app-bar-title wl-brand-title">
                    <span className="wl-brand-title__weigh">WEIGH</span>
                    <span className="wl-brand-title__lab">LAB</span>
                  </h1>
                  <p className="mobile-app-bar-subtitle wl-brand-subtitle">
                    GOVERNMENT APPROVED TEST CENTER
                  </p>
                </div>
              </div>
            ) : (
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
            )}
            {isLaboratoryPage ? (
              <div className="mobile-app-bar-actions">
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
            ) : isHomeDashboard ? (
              <EmaapStatusShortcut />
            ) : showAppFilterSlot ? (
              <div id="verification-filter-slot-mobile" className="mobile-app-bar-actions" />
            ) : null}
          </header>
        )}
        {!isMobile && (
          <header className="top-bar glass">
            <h1 className="page-title">{pageTitle}</h1>
            <div className="top-bar-end">
              {isHomeDashboard ? <EmaapStatusShortcut /> : null}
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
              {showAppFilterSlot ? <div id="verification-filter-slot-desktop" /> : null}
            </div>
          </header>
        )}
        <div className="content-area">
          <Outlet key={`${location.pathname}-${pageRefreshKey}`} />
        </div>
      </main>
      {accountOpen && (
        <div
          className="modal-overlay sidebar-account-overlay"
          onClick={() => setAccountOpen(false)}
          role="presentation"
        >
          <div
            className="sidebar-account-panel glass"
            role="dialog"
            aria-labelledby="sidebar-account-title"
            onClick={event => event.stopPropagation()}
          >
            <button
              type="button"
              className="sidebar-account-panel__close"
              onClick={() => setAccountOpen(false)}
              aria-label="Close account"
            >
              <X size={18} />
            </button>
            <UserCircle size={48} className="text-blue sidebar-account-panel__avatar" />
            <h2 id="sidebar-account-title" className="sidebar-account-panel__name">
              {user.username}
            </h2>
            <p className="sidebar-account-panel__role text-muted">{roleLabel}</p>
            <button
              type="button"
              className="sidebar-account-panel__logout"
              onClick={() => void handleLogout()}
            >
              <LogOut size={16} aria-hidden />
              Logout
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
