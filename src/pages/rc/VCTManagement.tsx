import React, { useState, useEffect, useCallback } from 'react';
import {
  doc, deleteDoc, updateDoc, writeBatch,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { InlineFormPanel } from '../../components/InlineFormPanel';
import {
  buildRcVctMemberDoc,
  fetchRcVctUsers,
  rcVctMemberRef,
} from '../../lib/rcVctMembers';
import {
  assertAadharAvailable,
  authErrorMessage,
  createAuthUserForAadhar,
  formatAadharDisplay,
  isValidAadhar,
  normalizeAadhar,
  syncAuthPassword,
} from '../../lib/aadharAuth';
import { releaseAadharIndex } from '../../lib/aadharIndex';
import { vctApprovalLabel } from '../../lib/vctApproval';
import { uploadVctDocument, uploadVctProfilePhoto, type VctDocKind } from '../../lib/vctDocumentUpload';
import type { ProductFileMeta } from '../../lib/productApprovalUpload';
import {
  buildVctProfileFields,
  requireVctDocuments,
  validateVctProfile,
  vctDocFieldsFromMeta,
  vctDocsFromUser,
  vctProfilePhotoFieldsFromMeta,
  vctProfilePhotoFromUser,
  VCT_DOC_KEYS,
  type VctDocKey,
} from '../../lib/vctProfileFields';
import {
  UserPlus, Trash2, Eye, EyeOff, RefreshCw, Users, Pencil, X, Plus, Save, Zap, ClipboardList, UserCircle,
} from 'lucide-react';
import type { FirestoreUserDoc } from '../../types';
import {
  EMPTY_VCT_DOC_STATE,
  EMPTY_VCT_FORM,
  VCTFormFields,
  type VctDocUploadState,
  type VctFormValues,
} from './VCTFormFields';

interface VCTRecord extends FirestoreUserDoc {
  uid: string;
}

const DOC_KIND_MAP: Record<VctDocKey, VctDocKind> = {
  aadharDoc: 'aadhar',
  biodata: 'biodata',
  educationCert: 'education-cert',
  pcc: 'pcc',
};

const EMPTY_DOC_UPLOADS = (): Record<VctDocKey, VctDocUploadState> => ({
  aadharDoc: { ...EMPTY_VCT_DOC_STATE },
  biodata: { ...EMPTY_VCT_DOC_STATE },
  educationCert: { ...EMPTY_VCT_DOC_STATE },
  pcc: { ...EMPTY_VCT_DOC_STATE },
});

function docUploadsFromUser(doc: FirestoreUserDoc): Record<VctDocKey, VctDocUploadState> {
  const docs = vctDocsFromUser(doc);
  return {
    aadharDoc: { ...EMPTY_VCT_DOC_STATE, file: docs.aadharDoc },
    biodata: { ...EMPTY_VCT_DOC_STATE, file: docs.biodata },
    educationCert: { ...EMPTY_VCT_DOC_STATE, file: docs.educationCert },
    pcc: { ...EMPTY_VCT_DOC_STATE, file: docs.pcc },
  };
}

function vctFormFromUser(doc: FirestoreUserDoc): VctFormValues {
  return {
    username: doc.username || '',
    aadhar: doc.aadhar || '',
    phone: doc.phone || '',
    address: doc.address || '',
    pincode: doc.pincode || '',
    policeStation: doc.policeStation || '',
    secondaryContactName: doc.secondaryContactName || '',
    secondaryContactRelationship: doc.secondaryContactRelationship || '',
    secondaryContactPhone: doc.secondaryContactPhone || '',
    password: '',
    workflowMode: doc.workflowMode ?? 'auto',
  };
}

export const VCTManagement: React.FC = () => {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [vcts, setVcts] = useState<VCTRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<VctFormValues>(EMPTY_VCT_FORM);
  const [docUploads, setDocUploads] = useState<Record<VctDocKey, VctDocUploadState>>(EMPTY_DOC_UPLOADS);
  const [pendingDocs, setPendingDocs] = useState<Partial<Record<VctDocKey, File>>>({});
  const [profilePhoto, setProfilePhoto] = useState<VctDocUploadState>({ ...EMPTY_VCT_DOC_STATE });
  const [pendingProfilePhoto, setPendingProfilePhoto] = useState<File | null>(null);
  const [profilePhotoRemoved, setProfilePhotoRemoved] = useState(false);

  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [revealedUids, setRevealedUids] = useState<Set<string>>(new Set());

  const fetchVCTs = useCallback(async () => {
    if (!user?.uid) return;
    setLoading(true);
    try {
      const records = await fetchRcVctUsers(user.uid);
      setVcts(records);
    } catch (err: unknown) {
      console.error('Failed to load technicians', err);
      setVcts([]);
      setError(
        err instanceof Error && err.message.includes('permission')
          ? 'Could not load technicians. Deploy Firestore rules: firebase deploy --only firestore:rules'
          : 'Could not load technicians.',
      );
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  useEffect(() => {
    Promise.resolve().then(() => fetchVCTs());
  }, [fetchVCTs]);

  const showForm = showAddForm || editingUid !== null;
  const formBusy = submitting;
  const editingVct = editingUid ? vcts.find(v => v.uid === editingUid) : null;

  const resetDocs = () => {
    setDocUploads(EMPTY_DOC_UPLOADS());
    setPendingDocs({});
    setProfilePhoto({ ...EMPTY_VCT_DOC_STATE });
    setPendingProfilePhoto(null);
    setProfilePhotoRemoved(false);
  };

  const resetForm = () => {
    setFormValues(EMPTY_VCT_FORM);
    resetDocs();
    setShowPw(false);
    setError('');
  };

  const handleCloseModal = () => {
    if (formBusy) return;
    setShowAddForm(false);
    setEditingUid(null);
    resetForm();
  };

  useEffect(() => {
    if (!showForm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !formBusy) handleCloseModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showForm, formBusy]);

  const patchForm = (patch: Partial<VctFormValues>) => {
    setFormValues(prev => ({ ...prev, ...patch }));
  };

  const setDocState = (key: VctDocKey, patch: Partial<VctDocUploadState>) => {
    setDocUploads(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  const handleDocSelect = (key: VctDocKey, file: File) => {
    setPendingDocs(prev => ({ ...prev, [key]: file }));
    const previewUrl = URL.createObjectURL(file);
    setDocState(key, {
      file: { url: previewUrl, path: '', name: file.name, contentType: file.type },
      uploading: false,
      progress: 0,
    });
  };

  const handleDocRemove = (key: VctDocKey) => {
    setPendingDocs(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setDocState(key, EMPTY_VCT_DOC_STATE);
  };

  const handleProfilePhotoSelect = (file: File) => {
    setPendingProfilePhoto(file);
    setProfilePhotoRemoved(false);
    const previewUrl = URL.createObjectURL(file);
    setProfilePhoto({
      file: { url: previewUrl, path: '', name: file.name, contentType: file.type },
      uploading: false,
      progress: 0,
    });
  };

  const handleProfilePhotoRemove = () => {
    setPendingProfilePhoto(null);
    setProfilePhotoRemoved(true);
    setProfilePhoto({ ...EMPTY_VCT_DOC_STATE });
  };

  const docForValidation = (key: VctDocKey): ProductFileMeta | null => {
    if (pendingDocs[key]) {
      const file = pendingDocs[key]!;
      return { url: 'pending', path: '', name: file.name, contentType: file.type };
    }
    const state = docUploads[key];
    if (!state.file?.url) return null;
    return state.file;
  };

  const currentDocs = (): Record<VctDocKey, ProductFileMeta | null> =>
    Object.fromEntries(VCT_DOC_KEYS.map(key => [key, docForValidation(key)])) as Record<
      VctDocKey,
      ProductFileMeta | null
    >;

  const validateForm = (mode: 'create' | 'edit'): string | null => {
    const profileError = validateVctProfile(formValues);
    if (profileError) return profileError;
    if (mode === 'create' && !isValidAadhar(normalizeAadhar(formValues.aadhar))) {
      return 'Aadhar number must be exactly 12 digits.';
    }
    const docError = requireVctDocuments(currentDocs());
    if (docError) return docError;
    if (mode === 'create' && formValues.password.length < 6) {
      return 'Password must be at least 6 characters.';
    }
    if (mode === 'edit' && formValues.password.trim().length > 0 && formValues.password.trim().length < 6) {
      return 'New password must be at least 6 characters.';
    }
    return null;
  };

  const uploadPendingDoc = async (vctUid: string, key: VctDocKey): Promise<ProductFileMeta | null> => {
    const pending = pendingDocs[key];
    if (!pending) {
      const state = docUploads[key];
      const existing = state.file;
      if (existing?.url && !existing.url.startsWith('blob:')) return existing;
      return null;
    }
    setDocState(key, { uploading: true, progress: 0 });
    try {
      const meta = await uploadVctDocument(vctUid, DOC_KIND_MAP[key], pending, pct => {
        setDocState(key, { progress: pct });
      });
      setDocState(key, { file: meta, uploading: false, progress: 100 });
      return meta;
    } catch (err) {
      setDocState(key, { uploading: false, progress: 0 });
      throw err;
    }
  };

  const uploadProfilePhoto = async (vctUid: string): Promise<Partial<FirestoreUserDoc>> => {
    if (profilePhotoRemoved && !pendingProfilePhoto) {
      return vctProfilePhotoFieldsFromMeta(null);
    }
    if (!pendingProfilePhoto) {
      const existing = profilePhoto.file;
      if (existing?.url && !existing.url.startsWith('blob:')) {
        return vctProfilePhotoFieldsFromMeta(existing);
      }
      return {};
    }
    setProfilePhoto(prev => ({ ...prev, uploading: true, progress: 0 }));
    try {
      const meta = await uploadVctProfilePhoto(vctUid, pendingProfilePhoto, pct => {
        setProfilePhoto(prev => ({ ...prev, progress: pct }));
      });
      setProfilePhoto({ file: meta, uploading: false, progress: 100 });
      return vctProfilePhotoFieldsFromMeta(meta);
    } catch (err) {
      setProfilePhoto(prev => ({ ...prev, uploading: false, progress: 0 }));
      throw err;
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (showAddForm) await handleCreate();
    else if (editingUid) await handleSaveEdit(editingUid);
  };

  const uploadAllDocs = async (vctUid: string): Promise<Partial<FirestoreUserDoc>> => {
    let fields: Partial<FirestoreUserDoc> = {};
    for (const key of VCT_DOC_KEYS) {
      const meta = await uploadPendingDoc(vctUid, key);
      fields = { ...fields, ...vctDocFieldsFromMeta(key, meta) };
    }
    return fields;
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
      const docFields = await uploadAllDocs(uid);
      const photoFields = await uploadProfilePhoto(uid);

      const profile: FirestoreUserDoc = {
        aadhar: cleanAadhar,
        role: 'vct',
        clearTextPassword: formValues.password,
        workflowMode: formValues.workflowMode,
        createdAt: new Date().toISOString(),
        createdByUid: user?.uid,
        rcId: user?.uid,
        approvalStatus: 'pending',
        ...buildVctProfileFields(formValues),
        ...docFields,
        ...photoFields,
      };
      const batch = writeBatch(db);
      batch.set(doc(db, 'users', uid), profile);
      batch.set(doc(db, 'aadharIndex', cleanAadhar), {
        uid,
        role: 'vct',
        createdAt: profile.createdAt,
      });
      if (user?.uid) {
        batch.set(rcVctMemberRef(user.uid, uid), buildRcVctMemberDoc(profile, uid));
      }
      await batch.commit();

      handleCloseModal();
      await fetchVCTs();
    } catch (err: unknown) {
      setError(authErrorMessage(err, 'Failed to add technician.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveEdit = async (uid: string) => {
    const validationError = validateForm('edit');
    if (validationError) {
      setError(validationError);
      return;
    }

    const record = vcts.find(v => v.uid === uid);
    if (!record) return;

    setSubmitting(true);
    setError('');
    try {
      const docFields = await uploadAllDocs(uid);
      const photoFields = await uploadProfilePhoto(uid);

      const updates: Partial<FirestoreUserDoc> = {
        ...buildVctProfileFields(formValues),
        workflowMode: formValues.workflowMode,
        ...docFields,
        ...photoFields,
      };

      if (formValues.password.trim().length >= 6) {
        const current = record.clearTextPassword;
        if (!current) {
          setError('Cannot reset password: stored credential missing. Contact Super Admin.');
          return;
        }
        await syncAuthPassword(record.aadhar, current, formValues.password.trim());
        updates.clearTextPassword = formValues.password.trim();
      }

      await updateDoc(doc(db, 'users', uid), updates);
      if (user?.uid) {
        await updateDoc(rcVctMemberRef(user.uid, uid), {
          username: formValues.username.trim(),
        });
      }
      handleCloseModal();
      await fetchVCTs();
    } catch (err: unknown) {
      setError(authErrorMessage(err, 'Failed to update technician.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartAdd = () => {
    setEditingUid(null);
    resetForm();
    setShowAddForm(true);
  };

  const startEdit = (v: VCTRecord) => {
    setShowAddForm(false);
    setEditingUid(v.uid);
    setFormValues(vctFormFromUser(v));
    setDocUploads(docUploadsFromUser(v));
    setPendingDocs({});
    setProfilePhoto({
      ...EMPTY_VCT_DOC_STATE,
      file: vctProfilePhotoFromUser(v),
    });
    setPendingProfilePhoto(null);
    setProfilePhotoRemoved(false);
    setShowPw(false);
    setError('');
  };

  const handleDelete = async (uid: string, identifier: string) => {
    const ok = await confirm({
      title: 'Remove technician?',
      message: `Remove technician "${identifier}" from your centre?`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    const record = vcts.find(v => v.uid === uid);
    await deleteDoc(doc(db, 'users', uid));
    if (user?.uid) await deleteDoc(rcVctMemberRef(user.uid, uid));
    if (record?.aadhar) await releaseAadharIndex(record.aadhar);
    await fetchVCTs();
  };

  const toggleReveal = (uid: string) => {
    setRevealedUids(prev => {
      const n = new Set(prev);
      if (n.has(uid)) n.delete(uid);
      else n.add(uid);
      return n;
    });
  };

  return (
    <div className="fade-in page-content">
      {showForm && (
        <InlineFormPanel id="vct-form" className="mb-6 inline-form-panel--wide inline-form-panel--vct">
          <div className="product-form-panel">
            <div className="product-form-topbar">
              <div className="product-form-topbar-text">
                <h2 id="vct-form-title">
                  {showAddForm ? (
                    <>
                      <UserPlus className="inline-icon" /> Add Technician
                    </>
                  ) : (
                    <>
                      <Pencil className="inline-icon" /> Edit Technician
                    </>
                  )}
                </h2>
                <p className="rc-form-topbar-error" role={error ? 'alert' : undefined}>
                  {error || (showAddForm ? 'Super Admin approval required before sign-in.' : '\u00a0')}
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
                <VCTFormFields
                  mode={showAddForm ? 'create' : 'edit'}
                  values={formValues}
                  onChange={patchForm}
                  showPassword={showPw}
                  onTogglePassword={() => setShowPw(p => !p)}
                  loginAadhar={editingVct?.aadhar}
                  profilePhoto={profilePhoto}
                  onProfilePhotoSelect={handleProfilePhotoSelect}
                  onProfilePhotoRemove={handleProfilePhotoRemove}
                  docStates={docUploads}
                  onDocSelect={handleDocSelect}
                  onDocRemove={handleDocRemove}
                  submitting={formBusy}
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
                      <Plus size={16} /> Add Technician
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
              <Users className="inline-icon" /> Technicians
            </h2>
            <p className="text-muted text-sm mt-1">
              {vcts.length} verification and calibration technician{vcts.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-primary flex items-center gap-1.5 text-sm py-1.5 px-3"
              onClick={handleStartAdd}
            >
              <Plus size={16} /> Add Technician
            </button>
            <button className="btn-icon" onClick={fetchVCTs} title="Refresh" type="button">
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
              <table className="data-table data-table--vct-rc">
                <thead>
                  <tr>
                    <th className="vct-rc-col-serial">#</th>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Aadhar</th>
                    <th>Status</th>
                    <th>Job Mode</th>
                    <th>Password</th>
                    <th>Created</th>
                    <th className="text-right vct-rc-col-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {vcts.map((v, index) => (
                    <tr key={v.uid}>
                      <td className="vct-rc-col-serial text-muted text-sm">{index + 1}</td>
                      <td className="font-medium">
                        <div className="flex items-center gap-2">
                          {v.profilePhotoUrl ? (
                            <img
                              src={v.profilePhotoUrl}
                              alt=""
                              className="vct-table-avatar"
                            />
                          ) : (
                            <span className="vct-table-avatar vct-table-avatar--placeholder">
                              <UserCircle size={18} />
                            </span>
                          )}
                          <span>{v.username || '—'}</span>
                        </div>
                      </td>
                      <td className="text-sm">{v.phone || '—'}</td>
                      <td className="text-muted text-sm">{formatAadharDisplay(v.aadhar)}</td>
                      <td>
                        <span
                          className={`status-badge ${
                            v.approvalStatus === 'pending' ? 'vct-status-pending' : 'vct-status-approved'
                          }`}
                        >
                          {vctApprovalLabel(v.approvalStatus)}
                        </span>
                      </td>
                      <td>
                        <span className={`mode-badge ${v.workflowMode === 'auto' ? 'mode-auto' : 'mode-manual'}`}>
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
                      <td>
                        <div className="flex items-center gap-2">
                          <span className="text-mono text-sm">
                            {revealedUids.has(v.uid) ? (v.clearTextPassword ?? '—') : '••••••••'}
                          </span>
                          <button
                            type="button"
                            className="btn-icon"
                            onClick={() => toggleReveal(v.uid)}
                            title={revealedUids.has(v.uid) ? 'Hide password' : 'Show password'}
                          >
                            {revealedUids.has(v.uid) ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                        </div>
                      </td>
                      <td className="text-muted text-xs-soft">
                        {v.createdAt ? new Date(v.createdAt).toLocaleDateString('en-IN') : '—'}
                      </td>
                      <td className="text-right vct-rc-col-actions">
                        <button
                          type="button"
                          className="btn-icon text-blue mr-2"
                          onClick={() => startEdit(v)}
                          title="Edit"
                        >
                          <Pencil size={18} />
                        </button>
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
                  {vcts.length === 0 && (
                    <tr>
                      <td colSpan={9} className="text-center py-10 text-muted">
                        No technicians yet. Click &quot;Add Technician&quot; to create one.
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
