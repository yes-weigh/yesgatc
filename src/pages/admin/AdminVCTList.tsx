import React, { useState, useEffect, useCallback } from 'react';
import { collection, deleteDoc, doc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { InlineFormPanel } from '../../components/InlineFormPanel';
import { ListViewBackBar } from '../../components/ListViewBackBar';
import { StorageImage } from '../../components/StorageImage';
import { formatAadharDisplay } from '../../lib/aadharAuth';
import { releaseAadharIndex } from '../../lib/aadharIndex';
import { deleteAuthUserAccount } from '../../lib/authUserAdmin';
import { buildRcVctMemberDoc, rcVctMemberRef } from '../../lib/rcVctMembers';
import { vctApprovalLabel } from '../../lib/vctApproval';
import { vctDocMetaFromUser, VCT_DOC_KEYS, VCT_DOC_LABELS } from '../../lib/vctProfileFields';
import {
  Users, Building2, RefreshCw, Trash2, Zap, ClipboardList, CheckCircle2, Eye, ExternalLink, UserCircle,
  ShieldCheck, Calendar,
} from 'lucide-react';
import {
  RcListCardActions,
  RcListCardToggle,
  RcListEditHint,
  RcListMetaChip,
  RcListPhoneChip,
  RcListPhoto,
  RcListStatusBadge,
} from '../../components/RcListCard';
import { vctProfilePhotoFromUser } from '../../lib/vctProfileFields';
import type { FirestoreUserDoc } from '../../types';

interface VCTRecord extends FirestoreUserDoc {
  uid: string;
  rcCenterName: string;
}

function vctDisplayName(record: VCTRecord): string {
  return (record.username || '—').trim().toUpperCase();
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

    await Promise.all(
      vcts
        .filter(v => v.rcId)
        .map(v => setDoc(rcVctMemberRef(v.rcId!, v.uid), buildRcVctMemberDoc(v, v.uid), { merge: true })),
    );

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
      const record = vctList.find(v => v.uid === uid);
      await deleteDoc(doc(db, 'users', uid));
      if (record?.rcId) await deleteDoc(rcVctMemberRef(record.rcId, uid));
      if (record?.aadhar) await releaseAadharIndex(record.aadhar);
      await deleteAuthUserAccount(uid).catch(() => undefined);
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
      if (vct.rcId) {
        await setDoc(
          rcVctMemberRef(vct.rcId, vct.uid),
          { approvalStatus: 'approved' },
          { merge: true },
        );
      }
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
            <ListViewBackBar
              onBack={() => setReviewing(null)}
              disabled={approving}
            />
            <div className="product-form-topbar">
              <div className="product-form-topbar-text">
                <h2 id="vct-review-title">
                  <Eye className="inline-icon" /> Review Technician
                </h2>
                <p className="text-muted text-sm mb-0">{reviewing.username}</p>
              </div>
            </div>

            <div className="product-form-body vct-review-body">
              <div className="vct-review-profile">
                {reviewing.profilePhotoUrl || reviewing.profilePhotoPath ? (
                  <StorageImage
                    url={reviewing.profilePhotoUrl}
                    path={reviewing.profilePhotoPath}
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
                <div><span className="vct-review-label">Blood Group</span><p>{reviewing.bloodGroup || '—'}</p></div>
                <div><span className="vct-review-label">Postal code</span><p>{reviewing.pincode || '—'}</p></div>
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
        <div className="rc-list-page">
          <section className="rc-vehicles-summary-card">
            <div className="rc-vehicles-summary-leading">
              <span className="rc-list-summary-icon" aria-hidden>
                <Users size={20} strokeWidth={1.85} />
              </span>
              <h2 className="rc-vehicles-summary-title">Technicians</h2>
              <p className="rc-vehicles-summary-sub">
                {vctList.length} technician{vctList.length !== 1 ? 's' : ''} · {pendingCount} pending
              </p>
            </div>
            <div className="rc-vehicles-summary-actions">
              <button
                type="button"
                className="rc-vehicles-refresh-btn"
                onClick={() => void fetchVCTs()}
                title="Refresh"
                aria-label="Refresh technicians"
                disabled={loading}
              >
                <RefreshCw size={18} className={loading ? 'spinner-inline' : undefined} />
              </button>
            </div>
          </section>

          {loading ? (
            <div className="rc-vehicles-loading">
              <span className="spinner-inline large" />
            </div>
          ) : vctList.length === 0 ? (
            <div className="rc-vehicles-empty">
              <span className="rc-list-summary-icon rc-list-summary-icon--lg" aria-hidden>
                <Users size={24} strokeWidth={1.85} />
              </span>
              <p>No technicians registered yet.</p>
            </div>
          ) : (
            <div className="rc-list-cards">
              {vctList.map(v => {
                const displayName = vctDisplayName(v);
                const photo = vctProfilePhotoFromUser(v);
                const pending = v.approvalStatus === 'pending';

                return (
                  <article key={v.uid} className="rc-list-card">
                    <div className="rc-list-card-top">
                      <button
                        type="button"
                        className="rc-list-card-main"
                        onClick={() => setReviewing(v)}
                        aria-label={`Review ${displayName}`}
                      >
                        <RcListPhoto
                          url={photo?.url}
                          path={photo?.path}
                          placeholder={<UserCircle size={28} strokeWidth={1.5} />}
                          badge={
                            !pending ? (
                              <span className="rc-list-card-photo-badge" aria-hidden>
                                <ShieldCheck size={11} strokeWidth={2.75} />
                              </span>
                            ) : undefined
                          }
                        />
                        <span className="rc-list-card-info">
                          <span className="rc-list-card-name-row">
                            <span className="rc-list-card-name">{displayName}</span>
                            <RcListEditHint />
                          </span>
                          <span className="rc-list-meta-chips">
                            <RcListMetaChip icon={<Building2 size={13} strokeWidth={2} />}>
                              {v.rcCenterName}
                            </RcListMetaChip>
                            {v.phone?.trim() && <RcListPhoneChip phone={v.phone} />}
                            <RcListMetaChip icon={<UserCircle size={13} strokeWidth={2} />}>
                              {formatAadharDisplay(v.aadhar)}
                            </RcListMetaChip>
                            {v.createdAt && (
                              <RcListMetaChip icon={<Calendar size={13} strokeWidth={2} />}>
                                {new Date(v.createdAt).toLocaleDateString('en-IN')}
                              </RcListMetaChip>
                            )}
                          </span>
                          <span className="rc-list-card-badges">
                            <RcListStatusBadge
                              tone={pending ? 'pending' : 'approved'}
                              label={vctApprovalLabel(v.approvalStatus)}
                              icon={<ShieldCheck size={12} strokeWidth={2.5} aria-hidden />}
                            />
                            <RcListStatusBadge
                              tone={v.workflowMode === 'auto' ? 'auto' : 'manual'}
                              label={v.workflowMode === 'auto' ? 'Auto' : 'Manual'}
                              icon={
                                v.workflowMode === 'auto' ? (
                                  <Zap size={12} strokeWidth={2.5} aria-hidden />
                                ) : (
                                  <ClipboardList size={12} strokeWidth={2.5} aria-hidden />
                                )
                              }
                            />
                          </span>
                        </span>
                      </button>
                      <RcListCardActions>
                        <RcListCardToggle
                          className="rc-list-card-toggle--view"
                          onClick={() => setReviewing(v)}
                          title="Review profile"
                          ariaLabel={`Review ${displayName}`}
                        >
                          <Eye size={18} strokeWidth={1.75} />
                        </RcListCardToggle>
                        {pending && (
                          <RcListCardToggle
                            className="rc-list-card-toggle--approve"
                            onClick={() => void handleApprove(v)}
                            title="Approve technician"
                            ariaLabel={`Approve ${displayName}`}
                          >
                            <CheckCircle2 size={18} strokeWidth={1.75} />
                          </RcListCardToggle>
                        )}
                        <RcListCardToggle
                          className="rc-list-card-toggle--delete"
                          onClick={() => void handleDelete(v.uid, v.username || v.aadhar)}
                          title="Remove technician"
                          ariaLabel={`Remove ${displayName}`}
                        >
                          <Trash2 size={18} strokeWidth={1.85} />
                        </RcListCardToggle>
                      </RcListCardActions>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
