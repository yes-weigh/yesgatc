import React, { useState, useEffect, useCallback } from 'react';
import {
  doc, deleteDoc, updateDoc, writeBatch, deleteField,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { InlineFormPanel } from '../../components/InlineFormPanel';
import {
  RcListCardToggle,
  RcListEditHint,
  RcListPhoneChip,
  RcListPhoto,
  RcListStatusBadge,
} from '../../components/RcListCard';
import {
  buildRcVctMemberDoc,
  fetchRcVctUsers,
  rcVctMemberRef,
} from '../../lib/rcVctMembers';
import {
  assertAadharAvailable,
  authErrorMessage,
  createAuthUserForAadhar,
  isValidAadhar,
  normalizeAadhar,
  syncAuthPassword,
} from '../../lib/aadharAuth';
import { releaseAadharIndex } from '../../lib/aadharIndex';
import { deleteAuthUserAccount, rollbackCreatedAuthUser } from '../../lib/authUserAdmin';
import { isVctApproved, isVctActive, vctActiveLabel, vctApprovalLabel } from '../../lib/vctApproval';
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
  UserPlus,
  Trash2,
  RefreshCw,
  Users,
  Pencil,
  X,
  Plus,
  Save,
  Zap,
  ClipboardList,
  UserCircle,
  UserX,
  UserCheck,
  ShieldCheck,
  Check,
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

function vctDisplayName(record: VCTRecord): string {
  return (record.username || '—').trim().toUpperCase();
}

function vctFormFromUser(doc: FirestoreUserDoc): VctFormValues {
  return {
    username: doc.username || '',
    aadhar: doc.aadhar || '',
    phone: doc.phone || '',
    address: doc.address || '',
    pincode: doc.pincode || '',
    bloodGroup: doc.bloodGroup || '',
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
  const [listError, setListError] = useState('');

  const fetchVCTs = useCallback(async () => {
    if (!user?.uid) return;
    setLoading(true);
    setListError('');
    try {
      const records = await fetchRcVctUsers(user.uid);
      setVcts(records);
    } catch (err: unknown) {
      console.error('Failed to load technicians', err);
      setVcts([]);
      setListError(
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
    let createdAuthUid: string | undefined;
    try {
      await assertAadharAvailable(cleanAadhar);
      const cred = await createAuthUserForAadhar(cleanAadhar, formValues.password);
      const uid = cred.user.uid;
      createdAuthUid = uid;
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
        active: true,
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
      createdAuthUid = undefined;

      handleCloseModal();
      await fetchVCTs();
    } catch (err: unknown) {
      await rollbackCreatedAuthUser(createdAuthUid);
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
    const record = vcts.find(v => v.uid === uid);
    if (record && isVctApproved(record)) return;

    const ok = await confirm({
      title: 'Remove technician?',
      message: `Remove technician "${identifier}" from your centre?`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'users', uid));
      if (user?.uid) await deleteDoc(rcVctMemberRef(user.uid, uid));
      if (record?.aadhar) await releaseAadharIndex(record.aadhar);
      await deleteAuthUserAccount(uid).catch(() => undefined);
      await fetchVCTs();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to remove technician.');
    }
  };

  const handleToggleActive = async (v: VCTRecord) => {
    if (!isVctApproved(v)) return;

    const enabling = !isVctActive(v);
    const label = v.username || v.aadhar || 'technician';
    const ok = await confirm({
      title: enabling ? 'Enable technician?' : 'Disable technician?',
      message: enabling
        ? `Enable "${label}"? They will be able to sign in and receive jobs again.`
        : `Disable "${label}"? They will not be able to sign in or be assigned new jobs.`,
      confirmLabel: enabling ? 'Enable' : 'Disable',
      destructive: !enabling,
    });
    if (!ok || !user?.uid) return;

    const updates: Record<string, unknown> = enabling
      ? { active: true, deactivatedAt: deleteField(), deactivatedByUid: deleteField() }
      : {
          active: false,
          deactivatedAt: new Date().toISOString(),
          deactivatedByUid: user.uid,
        };

    await updateDoc(doc(db, 'users', v.uid), updates);
    await updateDoc(rcVctMemberRef(user.uid, v.uid), { active: enabling });
    await fetchVCTs();
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
        <div className="rc-vct-page">
          <section className="rc-vehicles-summary-card">
            <div className="rc-vehicles-summary-leading">
              <span className="rc-vct-summary-icon" aria-hidden>
                <Users size={20} strokeWidth={1.85} />
              </span>
              <h2 className="rc-vehicles-summary-title">Technicians</h2>
              <p className="rc-vehicles-summary-sub">
                {vcts.length} verification and calibration technician{vcts.length !== 1 ? 's' : ''}
              </p>
            </div>
            <div className="rc-vehicles-summary-actions">
              <button
                type="button"
                className="rc-vehicles-add-btn"
                onClick={handleStartAdd}
                aria-label="Add Technician"
              >
                <Plus size={16} strokeWidth={2.5} aria-hidden />
                <span className="rc-vehicles-add-btn-label">Add Technician</span>
              </button>
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
          {listError && (
            <p className="rc-vehicles-summary-error" role="alert">
              {listError}
            </p>
          )}

          {loading ? (
            <div className="rc-vehicles-loading">
              <span className="spinner-inline large" />
            </div>
          ) : vcts.length === 0 ? (
            <div className="rc-vehicles-empty">
              <span className="rc-vct-summary-icon rc-vct-summary-icon--lg" aria-hidden>
                <Users size={24} strokeWidth={1.85} />
              </span>
              <p>No technicians yet.</p>
              <button
                type="button"
                className="rc-vehicles-add-btn"
                onClick={handleStartAdd}
                aria-label="Add Technician"
              >
                <Plus size={16} strokeWidth={2.5} aria-hidden />
                <span className="rc-vehicles-add-btn-label">Add Technician</span>
              </button>
            </div>
          ) : (
            <div className="rc-list-cards">
              {vcts.map(v => {
                const approved = isVctApproved(v);
                const active = isVctActive(v);
                const photo = vctProfilePhotoFromUser(v);
                const displayName = vctDisplayName(v);
                const phones = [v.phone, v.secondaryContactPhone].filter(
                  (value): value is string => Boolean(value?.trim()),
                );

                return (
                  <article key={v.uid} className="rc-list-card">
                    <div className="rc-list-card-top">
                      <button
                        type="button"
                        className="rc-list-card-main"
                        onClick={() => startEdit(v)}
                        aria-label={`Edit ${displayName}`}
                      >
                        <RcListPhoto
                          url={photo?.url}
                          path={photo?.path}
                          placeholder={<UserCircle size={28} strokeWidth={1.5} />}
                          badge={
                            approved ? (
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
                          {phones.length > 0 && (
                            <span className="rc-list-meta-chips">
                              {phones.map(phone => (
                                <RcListPhoneChip key={`${v.uid}-${phone}`} phone={phone} />
                              ))}
                            </span>
                          )}
                          <span className="rc-list-card-badges">
                            <RcListStatusBadge
                              tone={approved ? 'approved' : 'pending'}
                              label={vctApprovalLabel(v.approvalStatus)}
                              icon={<ShieldCheck size={12} strokeWidth={2.5} aria-hidden />}
                            />
                            {approved && (
                              <RcListStatusBadge
                                tone={active ? 'active' : 'inactive'}
                                label={vctActiveLabel(v.active)}
                                icon={<Check size={12} strokeWidth={2.75} aria-hidden />}
                              />
                            )}
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
                      {approved ? (
                        <RcListCardToggle
                          className={active ? '' : 'rc-list-card-toggle--enable'}
                          onClick={() => void handleToggleActive(v)}
                          title={active ? 'Disable technician' : 'Enable technician'}
                          ariaLabel={
                            active ? `Disable ${displayName}` : `Enable ${displayName}`
                          }
                        >
                          {active ? (
                            <UserX size={20} strokeWidth={1.75} />
                          ) : (
                            <UserCheck size={20} strokeWidth={1.75} />
                          )}
                        </RcListCardToggle>
                      ) : (
                        <RcListCardToggle
                          className="rc-list-card-toggle--delete"
                          onClick={() => void handleDelete(v.uid, v.username || v.aadhar)}
                          title="Remove technician"
                          ariaLabel={`Remove ${displayName}`}
                        >
                          <Trash2 size={18} strokeWidth={1.85} />
                        </RcListCardToggle>
                      )}
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
