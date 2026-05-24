import React, { useState, useEffect, useCallback } from 'react';
import { collection, getDocs, doc, deleteDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAppContext } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { InlineFormPanel } from '../../components/InlineFormPanel';
import {
  assertAadharAvailable,
  authErrorMessage,
  createAuthUserForAadhar,
  isValidAadhar,
  normalizeAadhar,
  syncAuthPassword,
} from '../../lib/aadharAuth';
import { releaseAadharIndex } from '../../lib/aadharIndex';
import { isValidPhone, requireValidEmail } from '../../lib/contactFields';
import {
  EMPTY_RC_FORM,
  buildRcFirestoreFields,
  rcFormFromUser,
  standardWeightsCertExpiryFromDate,
  type RcFormValues,
} from '../../lib/rcProfileFields';
import {
  deleteRcStorageFile,
  uploadRcSeal,
  uploadRcStandardWeightsCert,
} from '../../lib/rcCertificateUpload';
import { isRcActive, rcActivationLabel } from '../../lib/rcActivation';
import type { ProductFileMeta } from '../../lib/productApprovalUpload';
import {
  Building2, Users, Briefcase, RefreshCw,
  Plus, Pencil, Trash2, Save, X,
} from 'lucide-react';
import type { FirestoreUserDoc } from '../../types';
import { RCFormFields } from './RCFormFields';

interface RCRecord extends FirestoreUserDoc {
  uid: string;
  vctCount: number;
  totalJobs: number;
  completedJobs: number;
}

function certMetaFromUser(rc: FirestoreUserDoc): ProductFileMeta | null {
  if (!rc.standardWeightsCertUrl) return null;
  return {
    url: rc.standardWeightsCertUrl,
    path: rc.standardWeightsCertPath || '',
    name: rc.standardWeightsCertName || 'Certificate',
    contentType: rc.standardWeightsCertContentType || '',
  };
}

function sealMetaFromUser(rc: FirestoreUserDoc): ProductFileMeta | null {
  if (!rc.sealUrl) return null;
  return {
    url: rc.sealUrl,
    path: rc.sealPath || '',
    name: rc.sealName || 'Seal',
    contentType: rc.sealContentType || 'image/png',
  };
}

function formatRcCertDueDate(rc: FirestoreUserDoc): string {
  const iso = rc.standardWeightsCertDate?.trim()
    ? standardWeightsCertExpiryFromDate(rc.standardWeightsCertDate)
    : rc.standardWeightsCertExpiry?.trim() || '';
  if (!iso) return '—';
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export const RCList: React.FC = () => {
  const { user } = useAuth();
  const confirm = useConfirm();
  const { jobs } = useAppContext();
  const [rcList, setRcList] = useState<RCRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [showAddForm, setShowAddForm] = useState(false);
  const [formValues, setFormValues] = useState<RcFormValues>(EMPTY_RC_FORM);
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [cert, setCert] = useState<ProductFileMeta | null>(null);
  const [certRemoved, setCertRemoved] = useState(false);
  const [certUploading, setCertUploading] = useState(false);
  const [certProgress, setCertProgress] = useState(0);
  const [pendingCertFile, setPendingCertFile] = useState<File | null>(null);
  const [seal, setSeal] = useState<ProductFileMeta | null>(null);
  const [sealRemoved, setSealRemoved] = useState(false);
  const [sealUploading, setSealUploading] = useState(false);
  const [sealProgress, setSealProgress] = useState(0);
  const [pendingSealFile, setPendingSealFile] = useState<File | null>(null);

  const fetchRCs = useCallback(async () => {
    setLoading(true);
    const snap = await getDocs(collection(db, 'users'));
    const allUsers = snap.docs.map(d => ({ uid: d.id, ...(d.data() as FirestoreUserDoc) }));
    const rcAdmins = allUsers.filter(u => u.role === 'rc_admin');

    const records: RCRecord[] = rcAdmins.map(rc => {
      const vctCount = allUsers.filter(u => u.role === 'vct' && u.rcId === rc.uid).length;
      const rcJobs = jobs.filter(j => j.createdByUid === rc.uid);
      const completedJobs = rcJobs.filter(j => j.status === 'completed').length;
      return { ...rc, vctCount, totalJobs: rcJobs.length, completedJobs };
    });

    records.sort((a, b) => b.totalJobs - a.totalJobs);
    setRcList(records);
    setLoading(false);
  }, [jobs]);

  useEffect(() => {
    Promise.resolve().then(() => fetchRCs());
  }, [fetchRCs]);

  const showForm = showAddForm || editingUid !== null;
  const formBusy = submitting || certUploading || sealUploading;
  const editingRc = editingUid ? rcList.find(r => r.uid === editingUid) : null;
  const formMode = showAddForm ? 'create' : 'edit';

  const resetUploadState = () => {
    setCert(null);
    setCertRemoved(false);
    setPendingCertFile(null);
    setCertProgress(0);
    setSeal(null);
    setSealRemoved(false);
    setPendingSealFile(null);
    setSealProgress(0);
  };

  const handleCloseModal = () => {
    if (formBusy) return;
    setShowAddForm(false);
    setEditingUid(null);
    setFormValues(EMPTY_RC_FORM);
    resetUploadState();
    setError('');
  };

  useEffect(() => {
    if (!showForm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !formBusy) handleCloseModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showForm, formBusy]);

  const patchForm = (patch: Partial<RcFormValues>) => {
    setFormValues(prev => ({ ...prev, ...patch }));
  };

  const validateForm = (mode: 'create' | 'edit'): string | null => {
    if (!formValues.companyName.trim()) return 'Company / Center Name is required.';
    if (!formValues.contactPerson.trim()) return 'Contact Person is required.';
    if (!formValues.place.trim()) return 'Place is required.';
    if (!formValues.address.trim()) return 'Address is required.';
    if (mode === 'create' && !isValidAadhar(normalizeAadhar(formValues.aadhar))) {
      return 'Aadhar number must be exactly 12 digits.';
    }
    if (!requireValidEmail(formValues.email)) return 'A valid email is required.';
    if (!isValidPhone(formValues.phone)) return 'Phone number must be exactly 10 digits.';
    if (!formValues.gstNumber.trim()) return 'GST Number is required.';
    if (mode === 'create' && formValues.password.length < 6) {
      return 'Password must be at least 6 characters.';
    }
    if (mode === 'edit' && formValues.password.trim().length > 0 && formValues.password.trim().length < 6) {
      return 'New password must be at least 6 characters.';
    }
    return null;
  };

  const handleCertSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const uid = editingUid;
    if (!uid && formMode === 'create') {
      setPendingCertFile(file);
      setCertRemoved(false);
      return;
    }
    if (!uid) return;

    setCertUploading(true);
    setCertProgress(0);
    setError('');
    try {
      const meta = await uploadRcStandardWeightsCert(uid, file, setCertProgress);
      const prevPath = cert?.path || editingRc?.standardWeightsCertPath;
      if (prevPath && prevPath !== meta.path) {
        await deleteRcStorageFile(prevPath).catch(() => undefined);
      }
      setCert(meta);
      setCertRemoved(false);
      setPendingCertFile(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Certificate upload failed.');
    } finally {
      setCertUploading(false);
    }
  };

  const handleSealSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const uid = editingUid;
    if (!uid && formMode === 'create') {
      setPendingSealFile(file);
      setSealRemoved(false);
      return;
    }
    if (!uid) return;

    setSealUploading(true);
    setSealProgress(0);
    setError('');
    try {
      const meta = await uploadRcSeal(uid, file, setSealProgress);
      const prevPath = seal?.path || editingRc?.sealPath;
      if (prevPath && prevPath !== meta.path) {
        await deleteRcStorageFile(prevPath).catch(() => undefined);
      }
      setSeal(meta);
      setSealRemoved(false);
      setPendingSealFile(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Seal upload failed.');
    } finally {
      setSealUploading(false);
    }
  };

  const handleCertRemove = () => {
    setCert(null);
    setCertRemoved(true);
    setPendingCertFile(null);
  };

  const handleSealRemove = () => {
    setSeal(null);
    setSealRemoved(true);
    setPendingSealFile(null);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (showAddForm) {
      await handleCreate();
    } else if (editingUid) {
      await handleSaveEdit(editingUid);
    }
  };

  const handleCreate = async () => {
    setError('');

    const validationError = validateForm('create');
    if (validationError) {
      setError(validationError);
      return;
    }

    const cleanAadhar = normalizeAadhar(formValues.aadhar);
    setSubmitting(true);
    try {
      await assertAadharAvailable(cleanAadhar);
      const cred = await createAuthUserForAadhar(cleanAadhar, formValues.password);
      const uid = cred.user.uid;

      let certMeta: ProductFileMeta | null = null;
      let sealMeta: ProductFileMeta | null = null;
      if (pendingCertFile) {
        setCertUploading(true);
        try {
          certMeta = await uploadRcStandardWeightsCert(uid, pendingCertFile, setCertProgress);
        } finally {
          setCertUploading(false);
        }
      }
      if (pendingSealFile) {
        setSealUploading(true);
        try {
          sealMeta = await uploadRcSeal(uid, pendingSealFile, setSealProgress);
        } finally {
          setSealUploading(false);
        }
      }

      const profile: FirestoreUserDoc = {
        aadhar: cleanAadhar,
        role: 'rc_admin',
        createdAt: new Date().toISOString(),
        createdByUid: user?.uid,
        rcId: uid,
        ...buildRcFirestoreFields(formValues, { cert: certMeta, seal: sealMeta }, {
          includePassword: formValues.password,
          isCreate: true,
        }),
      } as FirestoreUserDoc;

      const batch = writeBatch(db);
      batch.set(doc(db, 'users', uid), profile);
      batch.set(doc(db, 'aadharIndex', cleanAadhar), {
        uid,
        role: 'rc_admin',
        createdAt: profile.createdAt,
      });
      await batch.commit();

      handleCloseModal();
      await fetchRCs();
    } catch (err: unknown) {
      setError(authErrorMessage(err, 'Failed to register regional center.'));
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (rc: RCRecord) => {
    setShowAddForm(false);
    setError('');
    setEditingUid(rc.uid);
    setFormValues(rcFormFromUser(rc));
    setCert(certMetaFromUser(rc));
    setCertRemoved(false);
    setPendingCertFile(null);
    setSeal(sealMetaFromUser(rc));
    setSealRemoved(false);
    setPendingSealFile(null);
  };

  const handleSaveEdit = async (uid: string) => {
    const validationError = validateForm('edit');
    if (validationError) {
      setError(validationError);
      return;
    }

    const rc = rcList.find(r => r.uid === uid);
    if (!rc) return;

    setSubmitting(true);
    setError('');
    try {
      const updates = buildRcFirestoreFields(formValues, { cert, seal }, { isCreate: false });

      if (certRemoved && !cert) {
        updates.standardWeightsCertUrl = '';
        updates.standardWeightsCertPath = '';
        updates.standardWeightsCertName = '';
        updates.standardWeightsCertContentType = '';
        const oldPath = rc.standardWeightsCertPath;
        if (oldPath) await deleteRcStorageFile(oldPath).catch(() => undefined);
      }

      if (sealRemoved && !seal) {
        updates.sealUrl = '';
        updates.sealPath = '';
        updates.sealName = '';
        updates.sealContentType = '';
        const oldPath = rc.sealPath;
        if (oldPath) await deleteRcStorageFile(oldPath).catch(() => undefined);
      }

      if (formValues.password.trim().length >= 6) {
        const current = rc.clearTextPassword;
        if (!current) {
          setError('Cannot reset password: stored credential missing.');
          return;
        }
        await syncAuthPassword(rc.aadhar, current, formValues.password.trim());
        updates.clearTextPassword = formValues.password.trim();
      }

      await updateDoc(doc(db, 'users', uid), updates);
      handleCloseModal();
      await fetchRCs();
    } catch (err: unknown) {
      setError(authErrorMessage(err, 'Failed to update regional center.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (uid: string, name: string) => {
    if (uid === user?.uid) {
      alert("You can't delete your own account.");
      return;
    }
    const rc = rcList.find(r => r.uid === uid);
    const ok = await confirm({
      title: 'Delete regional center?',
      message: `Are you sure you want to delete Regional Center "${name}"?\nThis will remove their administration access. (Technicians are stored separately).`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;

    try {
      if (rc?.standardWeightsCertPath) {
        await deleteRcStorageFile(rc.standardWeightsCertPath).catch(() => undefined);
      }
      if (rc?.sealPath) {
        await deleteRcStorageFile(rc.sealPath).catch(() => undefined);
      }
      await deleteDoc(doc(db, 'users', uid));
      if (rc?.aadhar) await releaseAadharIndex(rc.aadhar);
      await fetchRCs();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to delete regional center.');
    }
  };

  const handleStartRegister = () => {
    setEditingUid(null);
    setFormValues(EMPTY_RC_FORM);
    resetUploadState();
    setError('');
    setShowAddForm(true);
  };

  return (
    <div className="fade-in page-content">
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

      {showForm && (
        <InlineFormPanel id="rc-form" className="mb-6 inline-form-panel--wide inline-form-panel--rc">
          <div className="product-form-panel">
            <div className="product-form-topbar">
              <div className="product-form-topbar-text">
                <h2 id="rc-form-title">
                  {showAddForm ? (
                    <>
                      <Building2 className="inline-icon" /> Register Regional Center
                    </>
                  ) : (
                    <>
                      <Pencil className="inline-icon" /> Edit Regional Center
                    </>
                  )}
                </h2>
                <p className="rc-form-topbar-error" role={error ? 'alert' : undefined}>
                  {error || '\u00a0'}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary text-sm py-1.5 px-3 flex items-center gap-1 shrink-0"
                onClick={handleCloseModal}
                disabled={formBusy}
                aria-label="Close"
              >
                <X size={15} /> Close
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="product-form" autoComplete="off" noValidate>
              <div className="product-form-body">
                <RCFormFields
                  mode={showAddForm ? 'create' : 'edit'}
                  values={formValues}
                  onChange={patchForm}
                  cert={cert}
                  certUploading={certUploading}
                  certProgress={certProgress}
                  onCertSelect={handleCertSelect}
                  onCertRemove={handleCertRemove}
                  seal={seal}
                  sealUploading={sealUploading}
                  sealProgress={sealProgress}
                  onSealSelect={handleSealSelect}
                  onSealRemove={handleSealRemove}
                  submitting={submitting}
                  showPassword={showPw}
                  onTogglePassword={() => setShowPw(p => !p)}
                  loginAadhar={editingRc?.aadhar}
                />
              </div>
              <div className="product-form-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleCloseModal}
                  disabled={formBusy}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary flex items-center gap-2" disabled={formBusy}>
                  {formBusy ? (
                    <span className="spinner-inline"></span>
                  ) : showAddForm ? (
                    <>
                      <Plus size={16} /> Register Center
                    </>
                  ) : (
                    <>
                      <Save size={18} /> Save Changes
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </InlineFormPanel>
      )}

      {!showForm && (
      <div className="panel glass panel--table mb-6">
        <div className="panel-header justify-between">
          <div>
            <h2>
              <Building2 className="inline-icon" /> Regional Centers
            </h2>
            <p className="text-muted text-sm mt-1">
              {rcList.length} registered center{rcList.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-primary flex items-center gap-1.5 text-sm py-1.5 px-3"
              onClick={handleStartRegister}
            >
              <Plus size={16} /> Register Center
            </button>
            <button className="btn-icon" onClick={fetchRCs} title="Refresh" type="button">
              <RefreshCw size={18} />
            </button>
          </div>
        </div>
        <div className="panel-body p-0">
          {loading ? (
            <div className="flex justify-center py-16">
              <span className="spinner-inline large"></span>
            </div>
          ) : (
            <div className="table-scroll-wrap">
            <table className="data-table data-table--rc">
              <colgroup>
                <col className="rc-col-serial" />
                <col className="rc-col-company" />
                <col className="rc-col-place" />
                <col className="rc-col-vcts" />
                <col className="rc-col-jobs" />
                <col className="rc-col-due" />
                <col className="rc-col-status" />
                <col className="rc-col-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th className="rc-col-serial">#</th>
                  <th className="rc-col-company">Company</th>
                  <th className="rc-col-place">Place</th>
                  <th className="rc-col-vcts">VCTs</th>
                  <th className="rc-col-jobs">Jobs</th>
                  <th className="rc-col-due">Cert. due</th>
                  <th className="rc-col-status">Status</th>
                  <th className="rc-col-actions text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rcList.map((rc, index) => {
                  const completionRate =
                    rc.totalJobs > 0 ? Math.round((rc.completedJobs / rc.totalJobs) * 100) : 0;
                  const company = rc.companyName || rc.username || '—';
                  const isActive = isRcActive(rc);
                  const certDue = formatRcCertDueDate(rc);
                  return (
                    <tr key={rc.uid}>
                      <td className="rc-col-serial text-muted text-sm">{index + 1}</td>
                      <td className="rc-col-company font-medium">
                        <span className="rc-cell-ellipsis" title={company}>
                          {company}
                        </span>
                      </td>
                      <td className="rc-col-place text-sm">
                        <span className="rc-cell-ellipsis" title={rc.place || undefined}>
                          {rc.place || '—'}
                        </span>
                      </td>
                      <td className="rc-col-vcts">{rc.vctCount}</td>
                      <td className="rc-col-jobs">
                        <span
                          className="rc-jobs-summary"
                          title={`${rc.completedJobs} completed of ${rc.totalJobs} jobs`}
                        >
                          {rc.totalJobs} · <span className="text-green">{rc.completedJobs} done</span>
                          {rc.totalJobs > 0 && (
                            <span className="text-muted"> ({completionRate}%)</span>
                          )}
                        </span>
                      </td>
                      <td className="rc-col-due text-sm" title={certDue !== '—' ? certDue : undefined}>
                        {certDue}
                      </td>
                      <td className="rc-col-status">
                        <span
                          className={`rc-status-badge ${isActive ? 'rc-status-badge--active' : 'rc-status-badge--inactive'}`}
                          title={
                            isActive
                              ? 'Standard weights certificate uploaded'
                              : 'Standard weights certificate not uploaded'
                          }
                        >
                          {rcActivationLabel(rc)}
                        </span>
                      </td>
                      <td className="rc-col-actions text-right">
                        <button
                          type="button"
                          className="btn-icon text-blue mr-2"
                          onClick={() => startEdit(rc)}
                          title="Edit"
                        >
                          <Pencil size={18} />
                        </button>
                        <button
                          type="button"
                          className="btn-icon text-red"
                          onClick={() => handleDelete(rc.uid, rc.companyName || rc.username || '')}
                          title="Delete"
                        >
                          <Trash2 size={18} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {rcList.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-10 text-muted">
                      No regional centers yet. Click &quot;Register Center&quot; to add one.
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
