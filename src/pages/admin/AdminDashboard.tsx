import React, { useState, useEffect } from 'react';
import { useAppContext } from '../../context/AppContext';
import { Activity, Package, CheckCircle2, Clock, Users, Building2 } from 'lucide-react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import type { FirestoreUserDoc, Role } from '../../types';

interface UserCounts { super_admin: number; rc_admin: number; vct: number; }

export const AdminDashboard: React.FC = () => {
  const { jobs, products, certificates } = useAppContext();
  const [userCounts, setUserCounts] = useState<UserCounts>({ super_admin: 0, rc_admin: 0, vct: 0 });
  const [loadingUsers, setLoadingUsers] = useState(true);

  useEffect(() => {
    const fetchCounts = async () => {
      const snap = await getDocs(collection(db, 'users'));
      const counts: UserCounts = { super_admin: 0, rc_admin: 0, vct: 0 };
      snap.docs.forEach(d => {
        const role = (d.data() as FirestoreUserDoc).role as Role;
        if (role in counts) counts[role]++;
      });
      setUserCounts(counts);
      setLoadingUsers(false);
    };
    fetchCounts();
  }, []);

  const completedJobs = jobs.filter(j => j.status === 'completed').length;
  const pendingJobs   = jobs.filter(j => j.status === 'pending_review').length;
  const assignedJobs  = jobs.filter(j => j.status === 'assigned').length;

  return (
    <div className="fade-in">

      {/* ── Top KPI Row ── */}
      <div className="stats-grid">
        <div className="stat-card glass">
          <div className="stat-icon text-blue"><Activity /></div>
          <div className="stat-content">
            <h3>Total Jobs</h3>
            <p className="stat-value">{jobs.length}</p>
            <p className="stat-sub">{assignedJobs} active · {pendingJobs} pending</p>
          </div>
        </div>
        <div className="stat-card glass">
          <div className="stat-icon text-green"><CheckCircle2 /></div>
          <div className="stat-content">
            <h3>Completed Jobs</h3>
            <p className="stat-value">{completedJobs}</p>
            <p className="stat-sub">{certificates.length} certificates issued</p>
          </div>
        </div>
        <div className="stat-card glass">
          <div className="stat-icon text-orange"><Package /></div>
          <div className="stat-content">
            <h3>Products</h3>
            <p className="stat-value">{products.length}</p>
            <p className="stat-sub">Configured in system</p>
          </div>
        </div>
      </div>

      {/* ── User Breakdown + Config ── */}
      <div className="grid-2 mt-6">

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

        {/* Global config */}
        <div className="panel glass">
          <div className="panel-header">
            <h2>Global Configuration</h2>
          </div>
          <div className="panel-body">
            <p className="text-muted mb-4" style={{ fontSize: '0.9rem' }}>
              Standard fee templates applied across all Regional Centers.
            </p>
            <div className="config-box">
              <p>OV Standard Fee: <span className="highlight">₹150</span></p>
              <p>RV Fee (incl. GST): <span className="highlight">₹295</span></p>
            </div>
            <button className="btn btn-primary mt-4" onClick={() => alert('Fee editor coming soon.')}>
              Update Master Fees
            </button>
          </div>
        </div>
      </div>

      {/* ── Recent Activity ── */}
      <div className="panel glass mt-6">
        <div className="panel-header">
          <h2><Clock className="inline-icon text-orange" /> Recent Activity</h2>
        </div>
        <div className="panel-body p-0">
          {jobs.length === 0 ? (
            <p className="text-muted text-center py-8">No jobs in the system yet.</p>
          ) : (
            <table className="data-table">
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
                  <tr key={job.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      {job.id.slice(0, 16)}…
                    </td>
                    <td className="font-medium">{job.customer}</td>
                    <td className="text-muted" style={{ fontSize: '0.875rem' }}>{job.product}</td>
                    <td>
                      <span className={`role-badge ${job.jobType === 'OV' ? 'badge-rc' : 'badge-vct'}`}>
                        {job.jobType}
                      </span>
                    </td>
                    <td><span className={`status-badge ${job.status}`}>{job.status.replace('_', ' ')}</span></td>
                    <td className="text-muted" style={{ fontSize: '0.8rem' }}>
                      {new Date(job.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
