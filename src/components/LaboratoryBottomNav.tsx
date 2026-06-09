import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BarChart3, MoreHorizontal, Scale, ShieldCheck } from 'lucide-react';

type LaboratoryBottomNavProps = {
  basePath: '/rc' | '/admin';
};

const RC_TABS = [
  { id: 'laboratory', label: 'Laboratory', path: '/rc/laboratory', icon: Scale },
  { id: 'verifications', label: 'Verifications', path: '/rc/verification', icon: ShieldCheck },
  { id: 'reports', label: 'Reports', path: '/rc/reports', icon: BarChart3 },
  { id: 'more', label: 'More', path: '/rc', icon: MoreHorizontal },
] as const;

const ADMIN_TABS = [
  { id: 'laboratory', label: 'Laboratory', path: '/admin/laboratory', icon: Scale },
  { id: 'verifications', label: 'Verifications', path: '/admin/verifications', icon: ShieldCheck },
  { id: 'reports', label: 'Reports', path: '/admin/reports', icon: BarChart3 },
  { id: 'more', label: 'More', path: '/admin', icon: MoreHorizontal },
] as const;

export const LaboratoryBottomNav: React.FC<LaboratoryBottomNavProps> = ({ basePath }) => {
  const location = useLocation();
  const tabs = basePath === '/admin' ? ADMIN_TABS : RC_TABS;

  return (
    <nav className="laboratory-bottom-nav" aria-label="Laboratory dashboard navigation">
      {tabs.map(tab => {
        const Icon = tab.icon;
        const isActive =
          tab.id === 'laboratory'
            ? location.pathname === tab.path
            : tab.id !== 'more' && location.pathname.startsWith(tab.path);

        return (
          <Link
            key={tab.id}
            to={tab.path}
            className={`laboratory-bottom-nav-item${isActive ? ' laboratory-bottom-nav-item--active' : ''}`}
            aria-current={isActive ? 'page' : undefined}
          >
            <Icon size={20} strokeWidth={isActive ? 2.25 : 2} aria-hidden />
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
};
