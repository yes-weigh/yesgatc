import React, { useCallback, useEffect, useState } from 'react';
import {
  deleteField,
  doc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { InlineFormPanel } from '../../components/InlineFormPanel';
import { ListViewBackBar } from '../../components/ListViewBackBar';
import {
  RcListDeactivateToggle,
  RcListEditHint,
  RcListPhoneChip,
  RcListPhoto,
  RcListStatusBadge,
} from '../../components/RcListCard';
import {
  buildRcVerifierMemberDoc,
  fetchRcVerifierUsers,
  rcVerifierMemberRef,
} from '../../lib/rcVerifierMembers';
import {
  assertAadharAvailable,
  authErrorMessage,
  createAuthUserForAadhar,
  isValidAadhar,
  normalizeAadhar,
  syncAuthPassword,
} from '../../lib/aadharAuth';
import { rollbackCreatedAuthUser } from '../../lib/authUserAdmin';
import { isVerifierActive, verifierActiveLabel } from '../../lib/verifierAccount';
import { uploadVctProfilePhoto } from '../../lib/vctDocumentUpload';
import { vctProfilePhotoFieldsFromMeta, vctProfilePhotoFromUser } from '../../lib/vctProfileFields';
import { isValidEmail, isValidPhone, normalizePhone } from '../../lib/contactFields';
import {
  Check,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  UserCircle,
  UserPlus,
  Users,
} from 'lucide-react';
import type { FirestoreUserDoc } from '../../types';
import {
  EMPTY_IMAGE_UPLOAD_STATE,
  type ImageUploadState,
} from './CustomerFormFields';
import {
  EMPTY_VERIFIER_FORM,
  VerifierFormFields,
  type VerifierFormValues,
} from './VerifierFormFields';

interface VerifierRecord extends FirestoreUserDoc {
  uid: string;
}

function verifierDisplayName(record: VerifierRecord): string {
  return (record.username || '—').trim().toUpperCase();
}

function verifierFormFromUser(doc: FirestoreUserDoc): VerifierFormValues {
  return {
    username: doc.username || '',
    aadhar: doc.aadhar || '',
    phone: doc.phone || '',
    email: doc.email || '',
    password: '',
  };
}

function validateVerifierForm(values: VerifierFormValues, mode: 'create' | 'edit'): string | null {
  if (!values.username.trim()) return 'Enter full name.';
  if (mode === 'create' && !isValidAadhar(normalizeAadhar(values.aadhar))) {
    return 'Aadhar must be 12 digits.';
  }
  if (!isValidPhone(values.phone)) return 'Phone must be 10 digits.';
  if (!isValidEmail(values.email)) return 'Enter a valid email or leave it blank.';
  if (mode === 'create' && values.password.trim().length < 6) {
    return 'Password must be at least 6 characters.';
  }
  if (mode === 'edit' && values.password.trim() && values.password.trim().length < 6) {
    return 'Password must be at least 6 characters.';
  }
  return null;
}

export const VerifierManagement: React.FC = () => {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [verifiers, setVerifiers] = useState<VerifierRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<VerifierFormValues>(EMPTY_VERIFIER_FORM);
  const [profilePhoto, setProfilePhoto] = useState<ImageUploadState>({ ...EMPTY_IMAGE_UPLOAD_STATE });
  const [pendingProfilePhoto, setPendingProfilePhoto] = useState<File | null>(null);
  const [profilePhotoRemoved, setProfilePhotoRemoved] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');

  const showForm = showAddForm || editingUid !== null;
  const formBusy = submitting;
  const editingVerifier = editingUid ? verifiers.find(v => v.uid === editingUid) : null;

  const fetchVerifiers = useCallback(async () => {
    if (!user?.uid) return;
    setLoading(true);
    setListError('');
    try {
      setVerifiers(await fetchRcVerifierUsers(user.uid));
    } catch (err: unknown) {
      console.error('Failed to load verifiers', err);
      setVerifiers([]);
      setListError(
        err instanceof Error && err.message.includes('permission')
          ? 'Could not load verifiers. Deploy Firestore rules: firebase deploy --only firestore:rules'
          : 'Could not load verifiers.',
      );
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  useEffect(() => {
    void fetchVerifiers();
  }, [fetchVerifiers]);

  const resetForm = () => {
    setFormValues(EMPTY_VERIFIER_FORM);
    setProfilePhoto({ ...EMPTY_IMAGE_UPLOAD_STATE });
    setPendingProfilePhoto(null);
    setProfilePhotoRemoved(false);
    setShowPw(false);
    setError('');
  };

  const handleCloseModal = () => {
    setShowAddForm(false);
    setEditingUid(null);
    resetForm();
  };

  const patchForm = (patch: Partial<VerifierFormValues>) => {
    setFormValues(prev => ({ ...prev, ...patch }));
  };

  const handleProfilePhotoSelect = (file: File) => {
    setPendingProfilePhoto(file);
    setProfilePhotoRemoved(false);
    setProfilePhoto({
      file: { url: URL.createObjectURL(file), path: '', name: file.name, contentType: file.type },
      uploading: false,
      progress: 0,
    });
  };

  const handleProfilePhotoRemove = () => {
    setPendingProfilePhoto(null);
    setProfilePhotoRemoved(true);
    setProfilePhoto({ ...EMPTY_IMAGE_UPLOAD_STATE });
  };

  const uploadProfilePhoto = async (uid: string): Promise<Partial<FirestoreUserDoc>> => {
    if (profilePhotoRemoved && !pendingProfilePhoto) {
      return vctProfilePhotoFieldsFromMeta(null);
    }
    if (!pendingProfilePhoto) return {};
    const meta = await uploadVctProfilePhoto(uid, pendingProfilePhoto, pct => {
      setProfilePhoto(prev => ({ ...prev, uploading: true, progress: pct }));
    });
    setProfilePhoto(prev => ({ ...prev, uploading: false, progress: 100, file: meta }));
    return vctProfilePhotoFieldsFromMeta(meta);
  };

  const handleCreate = async () => {
    setError('');
    const validationError = validateVerifierForm(formValues, 'create');
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!user?.uid) return;

    const cleanAadhar = normalizeAadhar(formValues.aadhar);
    setSubmitting(true);
    let createdAuthUid: string | undefined;
    try {
      await assertAadharAvailable(cleanAadhar);
      const cred = await createAuthUserForAadhar(cleanAadhar, formValues.password);
      const uid = cred.user.uid;
      createdAuthUid = uid;
      const photoFields = await uploadProfilePhoto(uid);
      const createdAt = new Date().toISOString();
      const profile: FirestoreUserDoc = {
        aadhar: cleanAadhar,
        role: 'verifier',
        username: formValues.username.trim(),
        phone: normalizePhone(formValues.phone),
        email: formValues.email.trim(),
        clearTextPassword: formValues.password,
        createdAt,
        createdByUid: user.uid,
        rcId: user.uid,
        active: true,
        ...photoFields,
      };
      const batch = writeBatch(db);
      batch.set(doc(db, 'users', uid), profile);
      batch.set(doc(db, 'aadharIndex', cleanAadhar), {
        uid,
        role: 'verifier',
        createdAt,
      });
      batch.set(rcVerifierMemberRef(user.uid, uid), buildRcVerifierMemberDoc(profile, uid));
      await batch.commit();
      createdAuthUid = undefined;
      handleCloseModal();
      await fetchVerifiers();
    } catch (err: unknown) {
      await rollbackCreatedAuthUser(createdAuthUid);
      setError(authErrorMessage(err, 'Failed to add verifier.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveEdit = async (uid: string) => {
    const validationError = validateVerifierForm(formValues, 'edit');
    if (validationError) {
      setError(validationError);
      return;
    }
    const record = verifiers.find(v => v.uid === uid);
    if (!record || !user?.uid) return;

    setSubmitting(true);
    setError('');
    try {
      const photoFields = await uploadProfilePhoto(uid);
      const updates: Partial<FirestoreUserDoc> = {
        username: formValues.username.trim(),
        phone: normalizePhone(formValues.phone),
        email: formValues.email.trim(),
        ...photoFields,
      };
      if (formValues.password.trim().length >= 6) {
        const current = record.clearTextPassword;
        if (!current) {
          setError('Cannot reset password: stored credential missing.');
          return;
        }
        await syncAuthPassword(record.aadhar, current, formValues.password.trim());
        updates.clearTextPassword = formValues.password.trim();
      }
      await updateDoc(doc(db, 'users', uid), updates);
      await updateDoc(rcVerifierMemberRef(user.uid, uid), {
        username: formValues.username.trim(),
      });
      handleCloseModal();
      await fetchVerifiers();
    } catch (err: unknown) {
      setError(authErrorMessage(err, 'Failed to update verifier.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (showAddForm) await handleCreate();
    else if (editingUid) await handleSaveEdit(editingUid);
  };

  const handleStartAdd = () => {
    setEditingUid(null);
    resetForm();
    setShowAddForm(true);
  };

  const startEdit = (record: VerifierRecord) => {
    setShowAddForm(false);
    setEditingUid(record.uid);
    setFormValues(verifierFormFromUser(record));
    setProfilePhoto({
      ...EMPTY_IMAGE_UPLOAD_STATE,
      file: vctProfilePhotoFromUser(record),
    });
    setPendingProfilePhoto(null);
    setProfilePhotoRemoved(false);
    setShowPw(false);
    setError('');
  };

  const handleToggleActive = async (record: VerifierRecord) => {
    const enabling = !isVerifierActive(record);
    const label = record.username || record.aadhar || 'verifier';
    const ok = await confirm({
      title: enabling ? 'Activate verifier?' : 'Deactivate verifier?',
      message: enabling
        ? `Activate "${label}"? They can sign in and enter verifications again.`
        : `Deactivate "${label}"? They cannot sign in until you activate them.`,
      confirmLabel: enabling ? 'Activate' : 'Deactivate',
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

    await updateDoc(doc(db, 'users', record.uid), updates);
    await updateDoc(rcVerifierMemberRef(user.uid, record.uid), { active: enabling });
    await fetchVerifiers();
  };

  return (
    <div className="fade-in page-content">
      {showForm && (
        <InlineFormPanel id="verifier-form" className="mb-6 inline-form-panel--wide">
          <div className="product-form-panel">
            <ListViewBackBar onBack={handleCloseModal} disabled={formBusy} />
            <div className="product-form-topbar">
              <div className="product-form-topbar-text">
                <h2 id="verifier-form-title">
                  {showAddForm ? (
                    <>
                      <UserPlus className="inline-icon" /> Add Verifier
                    </>
                  ) : (
                    <>
                      <Pencil className="inline-icon" /> Edit Verifier
                    </>
                  )}
                </h2>
                <p className="rc-form-topbar-error" role={error ? 'alert' : undefined}>
                  {error || (showAddForm ? 'Temporary staff. Can enter verifications; you approve before certificates.' : '\u00a0')}
                </p>
              </div>
            </div>
            <form onSubmit={handleFormSubmit} className="product-form" autoComplete="off" noValidate>
              <div className="product-form-body">
                <VerifierFormFields
                  mode={showAddForm ? 'create' : 'edit'}
                  values={formValues}
                  onChange={patchForm}
                  showPassword={showPw}
                  onTogglePassword={() => setShowPw(p => !p)}
                  loginAadhar={editingVerifier?.aadhar}
                  profilePhoto={profilePhoto}
                  onProfilePhotoSelect={handleProfilePhotoSelect}
                  onProfilePhotoRemove={handleProfilePhotoRemove}
                  submitting={formBusy}
                />
              </div>
              <div className="product-form-footer">
                <button type="button" className="btn btn-secondary" onClick={handleCloseModal} disabled={formBusy}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary flex items-center gap-2" disabled={formBusy}>
                  {formBusy ? (
                    <span className="spinner-inline" />
                  ) : showAddForm ? (
                    <>
                      <Plus size={16} /> Add Verifier
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
              <h2 className="rc-vehicles-summary-title">Verifiers</h2>
              <p className="rc-vehicles-summary-sub">
                {verifiers.length} temporary verifier{verifiers.length !== 1 ? 's' : ''}
              </p>
            </div>
            <div className="rc-vehicles-summary-actions">
              <button type="button" className="rc-vehicles-add-btn" onClick={handleStartAdd} aria-label="Add Verifier">
                <Plus size={16} strokeWidth={2.5} aria-hidden />
                <span className="rc-vehicles-add-btn-label">Add Verifier</span>
              </button>
              <button
                type="button"
                className="rc-vehicles-refresh-btn"
                onClick={() => void fetchVerifiers()}
                title="Refresh"
                aria-label="Refresh verifiers"
                disabled={loading}
              >
                <RefreshCw size={18} className={loading ? 'spinner-inline' : undefined} />
              </button>
            </div>
          </section>
          {listError ? (
            <p className="rc-vehicles-summary-error" role="alert">
              {listError}
            </p>
          ) : null}

          {loading ? (
            <div className="rc-vehicles-loading">
              <span className="spinner-inline large" />
            </div>
          ) : verifiers.length === 0 ? (
            <div className="rc-vehicles-empty">
              <span className="rc-vct-summary-icon rc-vct-summary-icon--lg" aria-hidden>
                <Users size={24} strokeWidth={1.85} />
              </span>
              <p>No verifiers yet.</p>
              <button type="button" className="rc-vehicles-add-btn" onClick={handleStartAdd} aria-label="Add Verifier">
                <Plus size={16} strokeWidth={2.5} aria-hidden />
                <span className="rc-vehicles-add-btn-label">Add Verifier</span>
              </button>
            </div>
          ) : (
            <div className="rc-list-cards">
              {verifiers.map(record => {
                const active = isVerifierActive(record);
                const photo = vctProfilePhotoFromUser(record);
                const displayName = verifierDisplayName(record);
                return (
                  <article key={record.uid} className="rc-list-card">
                    <div className="rc-list-card-top">
                      <button
                        type="button"
                        className="rc-list-card-main"
                        onClick={() => startEdit(record)}
                        aria-label={`Edit ${displayName}`}
                      >
                        <RcListPhoto
                          url={photo?.url}
                          path={photo?.path}
                          placeholder={<UserCircle size={28} strokeWidth={1.5} />}
                        />
                        <span className="rc-list-card-info">
                          <span className="rc-list-card-name-row">
                            <span className="rc-list-card-name">{displayName}</span>
                            <RcListEditHint />
                          </span>
                          {record.phone ? (
                            <span className="rc-list-meta-chips">
                              <RcListPhoneChip phone={record.phone} />
                            </span>
                          ) : null}
                          <span className="rc-list-card-badges">
                            <RcListStatusBadge
                              tone={active ? 'active' : 'inactive'}
                              label={verifierActiveLabel(record.active)}
                              icon={<Check size={12} strokeWidth={2.75} aria-hidden />}
                            />
                          </span>
                        </span>
                      </button>
                      <RcListDeactivateToggle
                        active={active}
                        noun="verifier"
                        name={displayName}
                        iconSize={20}
                        onClick={() => void handleToggleActive(record)}
                      />
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
