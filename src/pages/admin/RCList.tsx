import React, { useState, useEffect } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAppContext } from '../../context/AppContext';
import {
  Building2, Users, CheckCircle2, Briefcase, Phone, FileText, RefreshCw, MapPin,
} from 'lucide-react';
import type { FirestoreUserDoc } from '../../types';

interface RCRecord extends FirestoreUserDoc {
  uid: string;
  vctCount: number;
  totalJobs: number;
  completedJobs: number;
}

export const RCList: React.FC = () => {
  const { jobs } = useAppContext();
  const [rcList,   setRcList]   = useState<RCRecord[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchRCs = async () => {
    setLoading(true);
    const snap = await getDocs(collection(db, 'users'));
    const allUsers = snap.docs.map(d => ({ uid: d.id, ...(d.data() as FirestoreUserDoc) }));

    const rcAdmins = allUsers.filter(u => u.role === 'rc_admin');

    const records: RCRecord[] = rcAdmins.map(rc => {
      const vctCount      = allUsers.filter(u => u.role === 'vct' && u.rcId === rc.uid).length;
      const rcJobs        = jobs.filter(j => j.createdByUid === rc.uid);
      const completedJobs = rcJobs.filter(j => j.status === 'completed').length;
      return {
        ...rc,
        vctCount,
        totalJobs: rcJobs.length,
        completedJobs,
      };
    });

    // Sort by most jobs first
    records.sort((a, b) => b.totalJobs - a.totalJobs);
    setRcList(records);
    setLoading(false);
  };

  useEffect(() => { fetchRCs(); }, [jobs]);

  const toggleExpand = (uid: string) =>
    setExpanded(prev => (prev === uid ? null : uid));

  return (
    <div className="fade-in">
      {/* Header bar */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <p className="text-muted" style={{ fontSize: '0.88rem' }}>
            {rcList.length} registered regional centre{rcList.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button className="btn-icon" onClick={fetchRCs} title="Refresh">
          <RefreshCw size={18} />
        </button>
      </div>

      {/* Summary KPI strip */}
      <div className="stats-grid mb-6">
        <div className="stat-card glass">
          <div className="stat-icon text-blue"><Building2 /></div>
          <div className="stat-content">
            <h3>Regional Centers</h3>
            <p className="stat-value">{rcList.length}</p>
          </div>
        </div>
        <div className="stat-card glass">
          <div className="stat-icon text-green"><Users /></div>
          <div className="stat-content">
            <h3>Total VCT Technicians</h3>
            <p className="stat-value">{rcList.reduce((s, r) => s + r.vctCount, 0)}</p>
          </div>
        </div>
        <div className="stat-card glass">
          <div className="stat-icon text-orange"><Briefcase /></div>
          <div className="stat-content">
            <h3>Total Jobs</h3>
            <p className="stat-value">{rcList.reduce((s, r) => s + r.totalJobs, 0)}</p>
            <p className="stat-sub">{rcList.reduce((s, r) => s + r.completedJobs, 0)} completed</p>
          </div>
        </div>
      </div>

      {/* RC Cards grid */}
      {loading ? (
        <div className="flex justify-center py-16">
          <span className="spinner-inline large"></span>
        </div>
      ) : rcList.length === 0 ? (
        <div className="panel glass">
          <div className="panel-body text-center py-16">
            <Building2 size={48} className="text-muted" style={{ display: 'block', margin: '0 auto 1rem', opacity: 0.3 }} />
            <p className="text-muted">No Regional Centers found.</p>
            <p className="text-muted mt-1" style={{ fontSize: '0.85rem' }}>
              Create RC Admin accounts in User Management.
            </p>
          </div>
        </div>
      ) : (
        <div className="rc-cards-grid">
          {rcList.map(rc => {
            const completionRate = rc.totalJobs > 0
              ? Math.round((rc.completedJobs / rc.totalJobs) * 100)
              : 0;
            const isExpanded = expanded === rc.uid;

            return (
              <div key={rc.uid} className={`rc-card glass ${isExpanded ? 'expanded' : ''}`}>
                {/* Card header */}
                <div
                  className="rc-card-header"
                  onClick={() => toggleExpand(rc.uid)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="rc-card-avatar">
                    <Building2 size={20} />
                  </div>
                  <div className="rc-card-title">
                    <h3>{rc.companyName || rc.username || rc.email}</h3>
                    <p className="text-muted" style={{ fontSize: '0.8rem' }}>{rc.email}</p>
                  </div>
                  <span className="role-badge badge-rc ml-auto">RC Admin</span>
                </div>

                {/* Stats row */}
                <div className="rc-card-stats">
                  <div className="rc-stat">
                    <Users size={14} className="text-muted" />
                    <span>{rc.vctCount} VCT</span>
                  </div>
                  <div className="rc-stat">
                    <Briefcase size={14} className="text-muted" />
                    <span>{rc.totalJobs} Jobs</span>
                  </div>
                  <div className="rc-stat">
                    <CheckCircle2 size={14} className="text-green" />
                    <span>{rc.completedJobs} Done</span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="rc-progress-bar">
                  <div
                    className="rc-progress-fill"
                    style={{ width: `${completionRate}%` }}
                  />
                </div>
                <p className="text-muted mt-1" style={{ fontSize: '0.75rem' }}>
                  {completionRate}% completion rate
                </p>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="rc-card-detail">
                    {rc.phone && (
                      <div className="rc-detail-row">
                        <Phone size={13} className="text-muted" />
                        <span>{rc.phone}</span>
                      </div>
                    )}
                    {rc.gstNumber && (
                      <div className="rc-detail-row">
                        <FileText size={13} className="text-muted" />
                        <span>GST: {rc.gstNumber}</span>
                      </div>
                    )}
                    {rc.address && (
                      <div className="rc-detail-row">
                        <MapPin size={13} className="text-muted" />
                        <span>{rc.address}</span>
                      </div>
                    )}
                    {!rc.phone && !rc.gstNumber && !rc.address && (
                      <p className="text-muted" style={{ fontSize: '0.82rem' }}>
                        No additional profile data. Ask the RC Admin to fill their profile.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
