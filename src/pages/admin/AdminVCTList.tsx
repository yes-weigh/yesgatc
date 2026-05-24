import React, { useState, useEffect, useCallback } from 'react';
import { collection, deleteDoc, doc, getDocs, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { InlineFormPanel } from '../../components/InlineFormPanel';
import { formatAadharDisplay } from '../../lib/aadharAuth';
import { vctApprovalLabel } from '../../lib/vctApproval';
import { vctDocMetaFromUser, VCT_DOC_KEYS, VCT_DOC_LABELS } from '../../lib/vctProfileFields';
import {
  Users, Building2, RefreshCw, Trash2, Zap, ClipboardList, CheckCircle2, Eye, X, ExternalLink, UserCircle,
} from 'lucide-react';
import type { FirestoreUserDoc } from '../../types';

interface VCTRecord extends FirestoreUserDoc {
  uid: string;
  rcCenterName: string;
}

export const AdminVCTList: React.FC = () => {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [vctList, setVctList] = useState<VCTRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState<VCTRecord | null>(null);
  const [approving, setApproving] = useState(false);

  const fetchVCTs = useCallback(async () => {
    setLoading(true);
    const snap = await getDocs(collection(db, 'users'));
    const allUsers = snap.docs.map(d => ({ uid: d.id, ...(d.data() as FirestoreUserDoc) }));

    const rcByUid = new Map<string, string>();
    allUsers
      .filter(u => u.role === 'rc_admin')
      .forEach(rc => {
        rcByUid.set(rc.uid, rc.companyName || rc.username || '—');
      });

    const vcts: VCTRecord[] = allUsers
      .filter(u => u.role === 'vct')
      .map(v => ({
        ...v,
        rcCenterName: (v.rcId && rcByUid.get(v.rcId)) || '—',
      }));

    vcts.sort((a, b) => {
      const aPending = a.approvalStatus === 'pending' ? 0 : 1;
      const bPending = b.approvalStatus === 'pending' ? 0 : 1;
      if (aPending !== bPending) return aPending - bPending;
      return a.rcCenterName.localeCompare(b.rcCenterName) || (a.username || '').localeCompare(b.username || '');
    });
    setVctList(vcts);
    setLoading(false);
  }, []);

  useEffect(() => {
    Promise.resolve().then(() => fetchVCTs());
  }, [fetchVCTs]);

  const pendingCount = vctList.filter(v => v.approvalStatus === 'pending').length;

  const handleDelete = async (uid: string, name: string) => {
    const ok = await confirm({
      title: 'Remove technician?',
      message: `Remove VCT technician "${name}"?\nThey will lose access immediately.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;

    try {
      await deleteDoc(doc(db, 'users', uid));
      if (reviewing?.uid === uid) setReviewing(null);
      await fetchVCTs();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to remove technician.');
    }
  };

  const handleApprove = async (vct: VCTRecord) => {
    setApproving(true);
    try {
      await updateDoc(doc(db, 'users', vct.uid), {
        approvalStatus: 'approved',
        approvedAt: new Date().toISOString(),
        approvedByUid: user?.uid,
      });
      setReviewing(null);
      await fetchVCTs();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to approve technician.');
    } finally {
      setApproving(false);
    }
  };

  const renderDocLink = (label: string, url?: string) => (
    url ? (
      <a href={url} target="_blank" rel="noopener noreferrer" className="vct-review-doc-link">
        <ExternalLink size={14} /> {label}
      </a>
    ) : (
      <span className="text-muted text-sm">Not uploaded</span>
    )
  );

  return (
    <div className="fade-in page-content">
      <div className="stats-grid mb-6">
        <div className="stat-card glass">
          <div className="stat-icon text-green"><Users /></div>
          <div className="stat-content">
            <h3>VCT Technicians</h3>
            <p className="stat-value">{vctList.length}</p>
          </div>
        </div>
        <div className="stat-card glass">
          <div className="stat-icon text-blue"><Building2 /></div>
          <div className="stat-content">
            <h3>Regional centers represented</h3>
            <p className="stat-value">
              {new Set(vctList.map(v => v.rcId).filter(Boolean)).size}
            </p>
          </div>
        </div>
        <div className="stat-card glass">
          <div className="stat-icon text-orange"><CheckCircle2 /></div>
          <div className="stat-content">
            <h3>Pending approval</h3>
            <p className="stat-value">{pendingCount}</p>
          </div>
        </div>
      </div>

      {reviewing && (
        <InlineFormPanel id="vct-review" className="mb-6 inline-form-panel--wide inline-form-panel--vct">
          <div className="product-form-panel">
            <div className="product-form-topbar">
              <div className="product-form-topbar-text">
                <h2 id="vct-review-title">
                  <Eye className="inline-icon" /> Review Technician
                </h2>
                <p className="text-muted text-sm mb-0">{reviewing.username}</p>
              </div>
              <button
                type="button"
                className="btn btn-secondary text-sm py-1.5 px-3 flex items-center gap-1 shrink-0"
                onClick={() => setReviewing(null)}
                disabled={approving}
              >
                <X size={15} /> Close
              </button>
            </div>

            <div className="product-form-body vct-review-body">
              <div className="vct-review-profile">
                {reviewing.profilePhotoUrl ? (
                  <img
                    src={reviewing.profilePhotoUrl}
                    alt={reviewing.username || 'Technician'}
                    className="vct-review-avatar"
                  />
                ) : (
                  <span className="vct-review-avatar vct-review-avatar--placeholder">
                    <UserCircle size={40} />
                  </span>
                )}
                <div>
                  <p className="vct-review-profile-name">{reviewing.username || '—'}</p>
                  <p className="text-muted text-sm">{formatAadharDisplay(reviewing.aadhar)}</p>
                </div>
              </div>

              <div className="vct-review-grid">
                <div><span className="vct-review-label">Regional Center</span><p>{reviewing.rcCenterName}</p></div>
                <div><span className="vct-review-label">Status</span><p>{vctApprovalLabel(reviewing.approvalStatus)}</p></div>
                <div><span className="vct-review-label">Aadhar Number</span><p>{formatAadharDisplay(reviewing.aadhar)}</p></div>
                <div><span className="vct-review-label">Mobile Number</span><p>{reviewing.phone || '—'}</p></div>
                <div><span className="vct-review-label">PIN Code</span><p>{reviewing.pincode || '—'}</p></div>
                <div><span className="vct-review-label">Police Station</span><p>{reviewing.policeStation || '—'}</p></div>
                <div className="vct-review-span-2">
                  <span className="vct-review-label">Residential Address</span>
                  <p>{reviewing.address || '—'}</p>
                </div>
                <div><span className="vct-review-label">Emergency Contact</span><p>{reviewing.secondaryContactName || '—'}</p></div>
                <div><span className="vct-review-label">Relationship</span><p>{reviewing.secondaryContactRelationship || '—'}</p></div>
                <div><span className="vct-review-label">Emergency Phone</span><p>{reviewing.secondaryContactPhone || '—'}</p></div>
                <div><span className="vct-review-label">Job Mode</span><p>{reviewing.workflowMode === 'manual' ? 'Manual' : 'Auto'}</p></div>
              </div>

              <div className="vct-review-docs">
                <span className="vct-review-label">Documents</span>
                <div className="vct-review-doc-links">
                  {VCT_DOC_KEYS.map(key => (
                    renderDocLink(VCT_DOC_LABELS[key].label, vctDocMetaFromUser(reviewing, key)?.url)
                  ))}
                </div>
              </div>
            </div>

            {reviewing.approvalStatus === 'pending' && (
              <div className="product-form-footer">
                <button
                  type="button"
                  className="btn btn-primary flex items-center gap-2"
                  onClick={() => handleApprove(reviewing)}
                  disabled={approving}
                >
                  {approving ? (
                    <span className="spinner-inline"></span>
                  ) : (
                    <>
                      <CheckCircle2 size={18} /> Approve Technician
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </InlineFormPanel>
      )}

      {!reviewing && (
      <div className="panel glass panel--table mb-6">
        <div className="panel-header justify-between">
          <div>
            <h2>
              <Users className="inline-icon" /> VCT Technicians
            </h2>
            <p className="text-muted text-sm mt-1">
              Review profiles and approve technicians before they can sign in.
            </p>
          </div>
          <button className="btn-icon" onClick={fetchVCTs} title="Refresh" type="button">
            <RefreshCw size={18} />
          </button>
        </div>
        <div className="panel-body p-0">
          {loading ? (
            <div className="flex justify-center py-16">
              <span className="spinner-inline large"></span>
            </div>
          ) : (
            <div className="table-scroll-wrap">
              <table className="data-table data-table--vct">
                <thead>
                  <tr>
                    <th className="vct-col-name">Name</th>
                    <th className="vct-col-rc">Regional Center</th>
                    <th className="vct-col-phone">Phone</th>
                    <th className="vct-col-status">Status</th>
                    <th className="vct-col-mode">Job Mode</th>
                    <th className="vct-col-created">Created</th>
                    <th className="text-right vct-col-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {vctList.map(v => (
                    <tr key={v.uid}>
                      <td className="vct-col-name font-medium table-cell-truncate" title={v.username}>
                        {v.username || '—'}
                      </td>
                      <td className="vct-col-rc table-cell-truncate" title={v.rcCenterName}>
                        {v.rcCenterName}
                      </td>
                      <td className="vct-col-phone text-sm">{v.phone || '—'}</td>
                      <td className="vct-col-status">
                        <span
                          className={`status-badge ${
                            v.approvalStatus === 'pending' ? 'vct-status-pending' : 'vct-status-approved'
                          }`}
                        >
                          {vctApprovalLabel(v.approvalStatus)}
                        </span>
                      </td>
                      <td className="vct-col-mode">
                        <span
                          className={`mode-badge ${v.workflowMode === 'auto' ? 'mode-auto' : 'mode-manual'}`}
                        >
                          {v.workflowMode === 'auto' ? (
                            <>
                              <Zap size={12} /> Auto
                            </>
                          ) : (
                            <>
                              <ClipboardList size={12} /> Manual
                            </>
                          )}
                        </span>
                      </td>
                      <td className="vct-col-created text-muted text-sm">
                        {v.createdAt ? new Date(v.createdAt).toLocaleDateString('en-IN') : '—'}
                      </td>
                      <td className="vct-col-actions text-right">
                        <button
                          type="button"
                          className="btn-icon text-blue mr-2"
                          onClick={() => setReviewing(v)}
                          title="Review profile"
                        >
                          <Eye size={18} />
                        </button>
                        {v.approvalStatus === 'pending' && (
                          <button
                            type="button"
                            className="btn-icon text-green mr-2"
                            onClick={() => handleApprove(v)}
                            title="Approve"
                          >
                            <CheckCircle2 size={18} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn-icon text-red"
                          onClick={() => handleDelete(v.uid, v.username || v.aadhar)}
                          title="Remove"
                        >
                          <Trash2 size={18} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {vctList.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center py-10 text-muted">
                        No VCT technicians registered yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
};
