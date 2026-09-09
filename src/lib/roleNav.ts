import type { Role } from '../types';
import { roleCanOpenVrAllotted } from './vrAllotted.ts';

export type RoleNavSpec = {
  path: string;
  label: string;
  pageTitle?: string;
  mobileSubtitle?: string;
};

export type RoleNavOptions = {
  hasCreatedVerifiers?: boolean;
};

/** Certificates list + sign pages. RC admin only. Hidden from verifier and VCT. */
export function roleCanOpenCertificates(role: Role | undefined): boolean {
  return role === 'rc_admin';
}

export { roleCanOpenVrAllotted };

export function navSpecsForRole(role: Role, options?: RoleNavOptions): RoleNavSpec[] {
  switch (role) {
    case 'super_admin':
      return [
        { path: '/admin', label: 'Dashboard' },
        {
          path: '/admin/verifications',
          label: 'Verification',
          mobileSubtitle: 'Powered by AI',
        },
        { path: '/admin/rc-quota', label: 'RC quata' },
        { path: '/admin/products', label: 'Products' },
        { path: '/admin/wallet', label: 'Wallet' },
        { path: '/admin/vehicles', label: 'Car' },
        { path: '/admin/rc', label: 'Regional Centers' },
        {
          path: '/admin/technicians',
          label: 'VCT',
          pageTitle: 'Verification and Calibration Technician',
        },
        { path: '/admin/laboratory', label: 'Laboratory' },
        { path: '/admin/notifications', label: 'Notifications' },
        { path: '/admin/reports', label: 'Reports' },
        { path: '/admin/contractor-fee', label: 'Contractor fee' },
        { path: '/admin/integrations', label: 'Integrations' },
        { path: '/admin/settings', label: 'Setting' },
      ];
    case 'rc_admin':
      return [
        { path: '/rc', label: 'Dashboard' },
        { path: '/rc/verification', label: 'Verification', mobileSubtitle: 'Powered by AI' },
        { path: '/rc/certificates', label: 'Certificates' },
        ...(roleCanOpenVrAllotted('rc_admin', Boolean(options?.hasCreatedVerifiers))
          ? [{ path: '/rc/vr-allotted', label: 'Vr Allotted' }]
          : []),
        { path: '/rc/customers', label: 'Customers' },
        { path: '/rc/wallet', label: 'Wallets' },
        { path: '/rc/products', label: 'Product' },
        {
          path: '/rc/vct',
          label: 'VCT',
          pageTitle: 'Verification and Calibration Technician',
        },
        {
          path: '/rc/verifier',
          label: 'Verifier',
          pageTitle: 'Temporary verifiers',
        },
        { path: '/rc/vehicles', label: 'Car' },
        { path: '/rc/laboratory', label: 'Laboratory' },
        { path: '/rc/reports', label: 'Reports' },
        { path: '/rc/settings', label: 'Setting' },
        { path: '/rc/profile', label: 'My Profile' },
      ];
    case 'vct':
      return [
        { path: '/vct', label: 'Dashboard' },
        { path: '/vct/verification', label: 'Verification', mobileSubtitle: 'Powered by AI' },
        { path: '/vct/customers', label: 'Customers' },
        { path: '/vct/products', label: 'Product' },
        { path: '/vct/vehicles', label: 'Car' },
        { path: '/vct/laboratory', label: 'Laboratory' },
        { path: '/vct/training', label: 'Training' },
        { path: '/vct/reports', label: 'Reports' },
        { path: '/vct/profile', label: 'My Profile' },
      ];
    case 'verifier':
      return [
        { path: '/verifier', label: 'Dashboard' },
        { path: '/verifier/verification', label: 'Verification', mobileSubtitle: 'Powered by AI' },
        { path: '/verifier/profile', label: 'My Profile' },
      ];
    default:
      return [];
  }
}
