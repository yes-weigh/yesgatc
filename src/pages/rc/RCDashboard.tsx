import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { getDocs } from 'firebase/firestore';
import { useAppContext } from '../../context/AppContext';
import {
  UserPlus,
  ClipboardPlus,
  Users,
  FilePenLine,
  Send,
  Award,
  Clock,
  Check,
  ArrowUpRight,
  Scale,
} from 'lucide-react';
import { db } from '../../firebase';
import { fetchRcVctUsers } from '../../lib/rcVctMembers';
import { verificationRecordsQuery } from '../../lib/verificationRecordsQuery';
import { useRoleBasePath, useRcScope } from '../../lib/roleScope';
import { normalizeVerificationStatus } from '../../lib/verificationRequest';
import type { SiteCalibration, WorkflowMode } from '../../types';

interface VCTOption {
  uid: string;
  username: string;
  phone?: string;
  email?: string;
  workflowMode: WorkflowMode;
}

interface KpiCardProps {
  to: string;
  label: string;
  value: number | string;
  sub: string;
  icon: React.ReactNode;
  accent: 'violet' | 'sky' | 'cyan' | 'slate' | 'blue' | 'emerald';
  placeholder?: boolean;
  loading?: boolean;
}

const NEW_JOB_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function KpiCard({ to, label, value, sub, icon, accent, placeholder, loading }: KpiCardProps) {
  return (
    <Link to={to} className={`rc-kpi-card rc-kpi-card--${accent}${placeholder ? ' rc-kpi-card--placeholder' : ''}`}>
      <div className="rc-kpi-card__glow" aria-hidden="true" />
      <div className="rc-kpi-card__top">
        <div className="rc-kpi-card__icon">{icon}</div>
        <ArrowUpRight size={16} className="rc-kpi-card__arrow" aria-hidden="true" />
      </div>
      <div className="rc-kpi-card__body">
        <p className="rc-kpi-card__label">{label}</p>
        {loading ? (
          <span className="rc-kpi-card__skeleton" aria-hidden="true" />
        ) : (
          <p className="rc-kpi-card__value">{value}</p>
        )}
        <p className="rc-kpi-card__sub">{sub}</p>
      </div>
      {placeholder && <span className="rc-kpi-card__pill">Coming soon</span>}
    </Link>
  );
}

export const RCDashboard: React.FC = () => {
  const { jobs, updateJob, addCertificate, loadingData } = useAppContext();
  const { rcUid, actorUid, isVct } = useRcScope();
  const basePath = useRoleBasePath();
  const [vctOptions, setVctOptions] = useState<VCTOption[]>([]);
  const [verifications, setVerifications] = useState<SiteCalibration[]>([]);
  const [loadingVerifications, setLoadingVerifications] = useState(true);

  const fetchVerifications = useCallback(async () => {
    if (!rcUid) return;
    setLoadingVerifications(true);
    try {
      const q = verificationRecordsQuery(db, rcUid, { isVct, actorUid });
      const snap = await getDocs(q);
      setVerifications(snap.docs.map(d => ({ id: d.id, ...d.data() } as SiteCalibration)));
    } finally {
      setLoadingVerifications(false);
    }
  }, [rcUid, isVct, actorUid]);

  useEffect(() => {
    if (!rcUid) return;
    if (!isVct) {
      const fetchVCTs = async () => {
        const records = await fetchRcVctUsers(rcUid);
        setVctOptions(records.map(data => ({
          uid: data.uid,
          username: data.username || data.aadhar,
          phone: data.phone,
          email: data.email,
          workflowMode: data.workflowMode ?? 'auto',
        })));
      };
      void fetchVCTs();
    } else {
      setVctOptions([]);
    }
    void fetchVerifications();
  }, [rcUid, isVct, fetchVerifications]);

  const myJobs = useMemo(
    () =>
      isVct
        ? jobs.filter(j => j.assignedTo === actorUid)
        : jobs.filter(j => j.createdByUid === actorUid),
    [jobs, actorUid, isVct],
  );

  const metrics = useMemo(() => {
    const now = Date.now();
    const newJobs = myJobs.filter(j => now - new Date(j.createdAt).getTime() <= NEW_JOB_WINDOW_MS);
    const assignedJobs = myJobs.filter(j => j.status === 'assigned');
    const pendingReview = myJobs.filter(j => j.status === 'pending_review');

    const draftVerifications = verifications.filter(
      v => normalizeVerificationStatus(v) === 'draft',
    );
    const submittedVerifications = verifications.filter(
      v => normalizeVerificationStatus(v) === 'submitted',
    );
    const issuedVerifications = verifications.filter(
      v => normalizeVerificationStatus(v) === 'approved',
    );

    return {
      newLeads: 0,
      newJobs: newJobs.length,
      assignedJobs: assignedJobs.length,
      draftVerifications: draftVerifications.length,
      submittedVerifications: submittedVerifications.length,
      issuedVerifications: issuedVerifications.length,
      pendingReview,
      recentDrafts: draftVerifications.slice(0, 4),
    };
  }, [myJobs, verifications]);

  const handleApprove = async (jobId: string) => {
    await updateJob(jobId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      rcApproved: true,
      paymentStatus: 'paid',
    });
    await addCertificate({ jobId, issuedAt: new Date().toISOString() });
  };

  const kpiLoading = loadingData || loadingVerifications;

  return (
    <div className="fade-in rc-dashboard">
      <section className="rc-kpi-grid" aria-label="Dashboard overview">
        <KpiCard
          to={`${basePath}/customers`}
          label="New Lead"
          value={metrics.newLeads}
          sub="Inquiry pipeline — capture and convert prospects"
          icon={<UserPlus size={22} />}
          accent="violet"
          placeholder
          loading={false}
        />
        <KpiCard
          to={`${basePath}/new-job`}
          label="New Job"
          value={metrics.newJobs}
          sub="Created in the last 7 days"
          icon={<ClipboardPlus size={22} />}
          accent="sky"
          loading={kpiLoading}
        />
        <KpiCard
          to={`${basePath}/new-job`}
          label="Assigned Jobs"
          value={metrics.assignedJobs}
          sub="With VCT technicians in the field"
          icon={<Users size={22} />}
          accent="cyan"
          loading={kpiLoading}
        />
        <KpiCard
          to={`${basePath}/verification`}
          label="Verifications · Draft"
          value={metrics.draftVerifications}
          sub="Editable — finish and submit when ready"
          icon={<FilePenLine size={22} />}
          accent="slate"
          loading={kpiLoading}
        />
        <KpiCard
          to={`${basePath}/verification`}
          label="Verifications · Submitted"
          value={metrics.submittedVerifications}
          sub="Locked — awaiting certificate server"
          icon={<Send size={22} />}
          accent="blue"
          loading={kpiLoading}
        />
        <KpiCard
          to={`${basePath}/verification`}
          label="Verifications · Issued"
          value={metrics.issuedVerifications}
          sub="Approved certificates ready to download"
          icon={<Award size={22} />}
          accent="emerald"
          loading={kpiLoading}
        />
      </section>

      <div className="rc-dashboard-panels grid-2 mt-6">
        <div className="panel glass">
          <div className="panel-header">
            <h2><Clock className="inline-icon text-orange" /> Pending Approvals</h2>
            {metrics.pendingReview.length > 0 && (
              <span className="badge-count">{metrics.pendingReview.length}</span>
            )}
          </div>
          <div className="panel-body p-0">
            <ul className="list-group">
              {metrics.pendingReview.map(job => {
                const assignedVCT = vctOptions.find(v => v.uid === job.assignedTo);
                return (
                  <li key={job.id} className="list-item p-4 border-b">
                    <div className="flex justify-between items-start mb-1">
                      <div>
                        <h4 className="font-bold text-mono-xs">
                          {job.id.slice(0, 20)}…
                          <span className="text-muted ml-2 font-normal">{job.jobType}</span>
                        </h4>
                        <p className="text-sm mt-1">{job.customer} • {job.product}</p>
                        {assignedVCT && (
                          <p className="text-xs text-muted mt-1">
                            Tech: {assignedVCT.username}
                          </p>
                        )}
                      </div>
                      {!isVct && (
                        <button
                          className="btn-approve"
                          onClick={() => handleApprove(job.id)}
                          title="Approve & Issue Certificate"
                          type="button"
                        >
                          <Check size={18} />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
              {metrics.pendingReview.length === 0 && (
                <li className="p-6 text-center text-muted">No jobs pending review.</li>
              )}
            </ul>
          </div>
        </div>

        <div className="panel glass">
          <div className="panel-header">
            <h2><Scale className="inline-icon text-blue" /> Draft Verifications</h2>
            {metrics.recentDrafts.length > 0 && (
              <span className="badge-count">{metrics.draftVerifications}</span>
            )}
          </div>
          <div className="panel-body p-0">
            {loadingVerifications ? (
              <div className="text-center py-8"><span className="spinner-inline" /></div>
            ) : metrics.recentDrafts.length === 0 ? (
              <div className="rc-dashboard-empty">
                <FilePenLine size={36} className="text-muted" />
                <p className="text-muted">No draft verifications yet.</p>
                <Link to={`${basePath}/verification`} className="btn btn-secondary btn-sm mt-2">
                  Start verification
                </Link>
              </div>
            ) : (
              <ul className="list-group">
                {metrics.recentDrafts.map(record => (
                  <li key={record.id} className="list-item p-4 border-b">
                    <div className="flex justify-between items-start gap-3">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{record.customerName}</p>
                        <p className="text-sm text-muted truncate">
                          {record.productName} · S/N {record.serialNumber}
                        </p>
                      </div>
                      <span className="verification-status verification-status--draft shrink-0">
                        Draft
                      </span>
                    </div>
                  </li>
                ))}
                {metrics.draftVerifications > metrics.recentDrafts.length && (
                  <li className="p-3 text-center border-t">
                    <Link to={`${basePath}/verification`} className="text-sm text-blue">
                      View all {metrics.draftVerifications} drafts
                    </Link>
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
