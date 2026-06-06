import React, { useState, useEffect, useMemo } from 'react';
import { useAppContext } from '../../context/AppContext';
import { Link } from 'react-router-dom';
import { ShieldCheck, XCircle, AlertTriangle, Clock, Users, Building2, Wallet } from 'lucide-react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { tallyVerificationStatusFilters } from '../../lib/verificationRequest';
import { AdminRazorpayTestCard } from '../../components/AdminRazorpayTestCard';
import { RvPaymentSettingsCard } from '../../components/RvPaymentSettingsCard';
import { fetchWalletTopUps } from '../../lib/rcWallet';
import type { FirestoreUserDoc, Role, SiteCalibration } from '../../types';

interface UserCounts { super_admin: number; rc_admin: number; vct: number; }

export const AdminDashboard: React.FC = () => {
  const { jobs } = useAppContext();
  const [userCounts, setUserCounts] = useState<UserCounts>({ super_admin: 0, rc_admin: 0, vct: 0 });
  const [verifications, setVerifications] = useState<SiteCalibration[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingVerifications, setLoadingVerifications] = useState(true);
  const [pendingWalletTopUps, setPendingWalletTopUps] = useState(0);

  useEffect(() => {
    const fetchCounts = async () => {
      const [userSnap, calibrationSnap] = await Promise.all([
        getDocs(collection(db, 'users')),
        getDocs(collection(db, 'siteCalibrations')),
      ]);

      const counts: UserCounts = { super_admin: 0, rc_admin: 0, vct: 0 };
      userSnap.docs.forEach(d => {
        const role = (d.data() as FirestoreUserDoc).role as Role;
        if (role in counts) counts[role]++;
      });
      setUserCounts(counts);
      setLoadingUsers(false);

      const records: SiteCalibration[] = calibrationSnap.docs.map(d => ({
        id: d.id,
        ...(d.data() as Omit<SiteCalibration, 'id'>),
      }));
      setVerifications(records);
      setLoadingVerifications(false);

      const pendingTopUps = await fetchWalletTopUps({ status: 'pending' });
      setPendingWalletTopUps(pendingTopUps.length);
    };
    void fetchCounts();
  }, []);

  const verificationTally = useMemo(
    () => tallyVerificationStatusFilters(verifications),
    [verifications],
  );

  return (
    <div className="fade-in">

      {/* ── Top KPI Row ── */}
      <div className="stats-grid">
        <div className="stat-card glass">
          <div className="stat-icon text-blue"><ShieldCheck /></div>
          <div className="stat-content">
            <h3>Total Verifications</h3>
            <p className="stat-value">
              {loadingVerifications ? '—' : verificationTally.all}
            </p>
            <p className="stat-sub">
              {loadingVerifications
                ? 'Loading…'
                : `${verificationTally.certified} fully certified`}
            </p>
          </div>
        </div>
        <div className="stat-card glass">
          <div className="stat-icon text-red"><XCircle /></div>
          <div className="stat-content">
            <h3>Failed at Submit</h3>
            <p className="stat-value">
              {loadingVerifications ? '—' : verificationTally.failed_submit}
            </p>
            <p className="stat-sub">Submit pipeline failures</p>
          </div>
        </div>
        <div className="stat-card glass">
          <div className="stat-icon text-orange"><AlertTriangle /></div>
          <div className="stat-content">
            <h3>Failed at Certification</h3>
            <p className="stat-value">
              {loadingVerifications ? '—' : verificationTally.failed_certification}
            </p>
            <p className="stat-sub">Incomplete certification data</p>
          </div>
        </div>
      </div>

      {/* ── User Breakdown ── */}
      <div className="mt-6">
        {/* User counts */}
        <div className="panel glass">
          <div className="panel-header">
            <h2><Users className="inline-icon" /> System Users</h2>
          </div>
          <div className="panel-body">
            {loadingUsers ? (
              <div className="text-center py-4"><span className="spinner-inline"></span></div>
            ) : (
              <div className="user-count-grid">
                <div className="user-count-card badge-super-bg">
                  <div className="user-count-icon"><Users size={20} /></div>
                  <div>
                    <p className="user-count-val">{userCounts.super_admin}</p>
                    <p className="user-count-label">Super Admins</p>
                  </div>
                </div>
                <div className="user-count-card badge-rc-bg">
                  <div className="user-count-icon"><Building2 size={20} /></div>
                  <div>
                    <p className="user-count-val">{userCounts.rc_admin}</p>
                    <p className="user-count-label">RC Admins</p>
                  </div>
                </div>
                <div className="user-count-card badge-vct-bg">
                  <div className="user-count-icon"><Users size={20} /></div>
                  <div>
                    <p className="user-count-val">{userCounts.vct}</p>
                    <p className="user-count-label">VCT Technicians</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="panel glass mt-6">
        <div className="panel-header">
          <h2><Wallet className="inline-icon" /> Wallet approvals</h2>
          {pendingWalletTopUps > 0 && <span className="badge-count">{pendingWalletTopUps}</span>}
        </div>
        <div className="panel-body flex items-center justify-between gap-3 flex-wrap">
          <p className="text-muted text-sm mb-0">
            Review RC payment screenshots and credit wallet balances.
          </p>
          <Link to="/admin/wallet" className="btn btn-primary btn-sm">
            {pendingWalletTopUps > 0
              ? `Review ${pendingWalletTopUps} pending`
              : 'View all top-ups'}
          </Link>
        </div>
      </div>

      <RvPaymentSettingsCard />

      <AdminRazorpayTestCard />

      {/* ── Recent Activity ── */}
      <div className="panel glass mt-6">
        <div className="panel-header">
          <h2><Clock className="inline-icon text-orange" /> Recent Activity</h2>
        </div>
        <div className="panel-body p-0">
          {jobs.length === 0 ? (
            <p className="text-muted text-center py-8">No jobs in the system yet.</p>
          ) : (
            <div className="table-scroll-wrap">
            <table className="data-table data-table--dashboard-jobs data-table--mobile-cards">
              <thead>
                <tr>
                  <th>Job ID</th>
                  <th>Customer</th>
                  <th>Product</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {jobs.slice(0, 8).map(job => (
                  <tr key={job.id} className="table-mobile-row table-mobile-row--simple">
                    <td className="text-mono-muted table-mobile-col-hide">
                      {job.id.slice(0, 16)}…
                    </td>
                    <td className="font-medium table-mobile-col-primary">
                      <span className="table-mobile-primary-text">{job.customer}</span>
                      <div className="table-mobile-summary">
                        <span className="table-mobile-summary-meta">{job.product}</span>
                        <span className="text-mono table-mobile-summary-meta">{job.id.slice(0, 16)}…</span>
                        <span className="table-mobile-summary-badges">
                          <span className={`role-badge ${job.jobType === 'OV' ? 'badge-rc' : 'badge-vct'}`}>
                            {job.jobType}
                          </span>
                          <span className={`status-badge ${job.status}`}>{job.status.replace('_', ' ')}</span>
                        </span>
                        <span className="table-mobile-summary-meta">
                          {new Date(job.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                        </span>
                      </div>
                    </td>
                    <td className="text-muted text-sm table-mobile-col-hide">{job.product}</td>
                    <td className="table-mobile-col-hide">
                      <span className={`role-badge ${job.jobType === 'OV' ? 'badge-rc' : 'badge-vct'}`}>
                        {job.jobType}
                      </span>
                    </td>
                    <td className="table-mobile-col-hide"><span className={`status-badge ${job.status}`}>{job.status.replace('_', ' ')}</span></td>
                    <td className="text-muted text-xs table-mobile-col-hide">
                      {new Date(job.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
