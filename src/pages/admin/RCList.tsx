import React, { useState, useEffect, useCallback } from 'react';
import { collection, getDocs, doc, updateDoc, writeBatch, deleteField } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useSetRcListAppBar } from '../../context/RcListAppBarContext';
import { InlineFormPanel } from '../../components/InlineFormPanel';
import { ListViewBackBar } from '../../components/ListViewBackBar';
import { tableEditCellProps } from '../../lib/tableEditCell';
import {
  assertAadharAvailable,
  authErrorMessage,
  createAuthUserForAadhar,
  isValidAadhar,
  normalizeAadhar,
  syncAuthPassword,
} from '../../lib/aadharAuth';
import { rollbackCreatedAuthUser } from '../../lib/authUserAdmin';
import { isValidPhone, requireValidEmail } from '../../lib/contactFields';
import {
  migrateRcZohoExpenseAccountFieldsForUsers,
  rcZohoExpenseAccountLegacyCleanupFields,
} from '../../lib/rcZohoExpenseAccountMigration';
import {
  EMPTY_RC_FORM,
  buildRcFirestoreFields,
  rcFormFromUser,
  standardWeightsCertExpiryFromDate,
  validateRcPincodeInput,
  validateRcCodeInput,
  validateZohoIdInput,
  validateZohoExpenseAccountIdInput,
  validateZohoExpenseAccountNameInput,
  validatePanCardInput,
  normalizeRcCode,
  type RcFormValues,
} from '../../lib/rcProfileFields';
import {
  deleteRcStorageFile,
  uploadRcLogo,
  uploadRcPanCard,
  uploadRcPdfSignerSign,
  uploadRcStandardWeightsCert,
} from '../../lib/rcCertificateUpload';
import { isRcAccountActive, isRcActive, rcActivationLabel } from '../../lib/rcActivation';
import { canEditRcCertificationSettings, rcCertificationMethodLabel } from '../../lib/rcCertificationMethod';
import { certifiedTypeCountsByRcId, type RcCertifiedTypeCounts } from '../../lib/rcCertificationRank';
import { LAST_CERTIFICATE_SEQUENCE_FLOOR, lifetimeCertifiedFromLatestSequence } from '../../lib/certificateSequence';
import type { FirestoreUserDoc, SiteCalibration } from '../../types';
import { StorageImage } from '../../components/StorageImage';
import { RcListDeactivateToggle } from '../../components/RcListCard';
import type { ProductFileMeta } from '../../lib/productApprovalUpload';
import {
  Building2, Users, Award,
  Plus, Save,
} from 'lucide-react';
import { RCFormFields } from './RCFormFields';

interface RCRecord extends FirestoreUserDoc {
  uid: string;
  vctCount: number;
  certifiedCount: number;
  ovCount: number;
  rvCount: number;
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

function logoMetaFromUser(rc: FirestoreUserDoc): ProductFileMeta | null {
  if (!rc.logoUrl && !rc.logoPath) return null;
  return {
    url: rc.logoUrl || '',
    path: rc.logoPath || '',
    name: rc.logoName || 'Logo',
    contentType: rc.logoContentType || 'image/jpeg',
  };
}

function pdfSignerSignMetaFromUser(rc: FirestoreUserDoc): ProductFileMeta | null {
  if (!rc.pdfSignerSignUrl && !rc.pdfSignerSignPath) return null;
  return {
    url: rc.pdfSignerSignUrl || '',
    path: rc.pdfSignerSignPath || '',
    name: rc.pdfSignerSignName || 'Signature',
    contentType: rc.pdfSignerSignContentType || 'image/png',
  };
}

function RcListAvatar({ rc }: { rc: RCRecord }) {
  const [failed, setFailed] = useState(false);
  if (failed || (!rc.logoUrl?.trim() && !rc.logoPath?.trim())) {
    return <Building2 size={16} strokeWidth={2} aria-hidden />;
  }
  return (
    <StorageImage
      url={rc.logoUrl}
      path={rc.logoPath}
      alt=""
      className="rc-table-avatar__img"
      onError={() => setFailed(true)}
    />
  );
}

function panCardMetaFromUser(rc: FirestoreUserDoc): ProductFileMeta | null {
  if (!rc.panCardUrl) return null;
  return {
    url: rc.panCardUrl,
    path: rc.panCardPath || '',
    name: rc.panCardName || 'PAN card',
    contentType: rc.panCardContentType || '',
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

function compareRcByCertifiedCount(a: RCRecord, b: RCRecord): number {
  const byCert = b.certifiedCount - a.certifiedCount;
  if (byCert !== 0) return byCert;
  const nameA = (a.companyName || a.username || '').trim();
  const nameB = (b.companyName || b.username || '').trim();
  return nameA.localeCompare(nameB, 'en', { sensitivity: 'base' });
}

function buildRcRecords(
  allUsers: Array<FirestoreUserDoc & { uid: string }>,
  certifiedByRc: Map<string, RcCertifiedTypeCounts>,
): RCRecord[] {
  const records: RCRecord[] = allUsers
    .filter(u => u.role === 'rc_admin')
    .map(rc => {
      const counts = certifiedByRc.get(rc.uid) ?? { ov: 0, rv: 0, total: 0 };
      return {
        ...rc,
        vctCount: allUsers.filter(u => u.role === 'vct' && u.rcId === rc.uid).length,
        ovCount: counts.ov,
        rvCount: counts.rv,
        certifiedCount: counts.total,
      };
    });
  records.sort(compareRcByCertifiedCount);
  return records;
}

export const RCList: React.FC = () => {
  const { user } = useAuth();
  const confirm = useConfirm();
  const setRcListAppBar = useSetRcListAppBar();
  const [rcList, setRcList] = useState<RCRecord[]>([]);
  const [lifetimeCertified, setLifetimeCertified] = useState(LAST_CERTIFICATE_SEQUENCE_FLOOR);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');

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
  const [panCardImage, setPanCardImage] = useState<ProductFileMeta | null>(null);
  const [panCardRemoved, setPanCardRemoved] = useState(false);
  const [panCardUploading, setPanCardUploading] = useState(false);
  const [panCardProgress, setPanCardProgress] = useState(0);
  const [pendingPanCardFile, setPendingPanCardFile] = useState<File | null>(null);
  const [logo, setLogo] = useState<ProductFileMeta | null>(null);
  const [logoRemoved, setLogoRemoved] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [pendingLogoFile, setPendingLogoFile] = useState<File | null>(null);
  const [signerSign, setSignerSign] = useState<ProductFileMeta | null>(null);
  const [signerRemoved, setSignerRemoved] = useState(false);
  const [signerUploading, setSignerUploading] = useState(false);
  const [pendingSignerFile, setPendingSignerFile] = useState<File | null>(null);
  const [formEditing, setFormEditing] = useState(false);

  const fetchRCs = useCallback(async () => {
    setLoading(true);
    setListError('');
    try {
      const userSnap = await getDocs(collection(db, 'users'));
      const allUsers = userSnap.docs.map(d => ({ uid: d.id, ...(d.data() as FirestoreUserDoc) }));
      const rcAdmins = allUsers.filter(u => u.role === 'rc_admin');
      setRcList(buildRcRecords(allUsers, new Map()));

      try {
        const calibrationSnap = await getDocs(collection(db, 'siteCalibrations'));
        const calibrations = calibrationSnap.docs.map(d => ({
          id: d.id,
          ...(d.data() as Omit<SiteCalibration, 'id'>),
        }));
        const certifiedByRc = certifiedTypeCountsByRcId(
          calibrations,
          rcAdmins.map(rc => rc.uid),
        );
        setLifetimeCertified(lifetimeCertifiedFromLatestSequence(calibrations));
        setRcList(buildRcRecords(allUsers, certifiedByRc));
      } catch (calibErr) {
        console.error('Failed to load certifications', calibErr);
        setLifetimeCertified(LAST_CERTIFICATE_SEQUENCE_FLOOR);
      }

      try {
        const migratedCount = await migrateRcZohoExpenseAccountFieldsForUsers(rcAdmins, db);
        if (migratedCount > 0) {
          const refreshed = await getDocs(collection(db, 'users'));
          const refreshedUsers = refreshed.docs.map(d => ({ uid: d.id, ...(d.data() as FirestoreUserDoc) }));
          setRcList(prev => {
            const certifiedByRc = new Map(
              prev.map(r => [r.uid, { ov: r.ovCount, rv: r.rvCount, total: r.certifiedCount }]),
            );
            return buildRcRecords(refreshedUsers, certifiedByRc);
          });
        }
      } catch (migrationErr) {
        console.error('RC Zoho expense account migration failed', migrationErr);
      }
    } catch (err) {
      console.error('Failed to load regional centers', err);
      setListError(err instanceof Error ? err.message : 'Failed to load regional centers.');
      setRcList([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    Promise.resolve().then(() => fetchRCs());
  }, [fetchRCs]);

  const showForm = showAddForm || editingUid !== null;
  const formBusy = submitting || certUploading || panCardUploading || logoUploading || signerUploading;
  const editingRc = editingUid ? rcList.find(r => r.uid === editingUid) : null;
  const formMode = showAddForm ? 'create' : 'edit';
  const fieldsEditing = showAddForm || formEditing;

  const resetUploadState = () => {
    setCert(null);
    setCertRemoved(false);
    setPendingCertFile(null);
    setCertProgress(0);
    setPanCardImage(null);
    setPanCardRemoved(false);
    setPendingPanCardFile(null);
    setPanCardProgress(0);
    setLogo(null);
    setLogoRemoved(false);
    setPendingLogoFile(null);
    setSignerSign(null);
    setSignerRemoved(false);
    setPendingSignerFile(null);
  };

  const handleCloseModal = () => {
    if (formBusy) return;
    setShowAddForm(false);
    setEditingUid(null);
    setFormEditing(false);
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

  useEffect(() => {
    if (!setRcListAppBar) return;
    if (showForm) {
      setRcListAppBar(null);
      return () => setRcListAppBar(null);
    }
    setRcListAppBar({
      onRegister: () => {
        setEditingUid(null);
        setFormValues(EMPTY_RC_FORM);
        resetUploadState();
        setError('');
        setFormEditing(true);
        setShowAddForm(true);
      },
    });
    return () => setRcListAppBar(null);
  }, [setRcListAppBar, showForm]);

  const patchForm = (patch: Partial<RcFormValues>) => {
    setFormValues(prev => ({ ...prev, ...patch }));
  };

  const validateForm = (mode: 'create' | 'edit'): string | null => {
    if (!formValues.companyName.trim()) return 'Company / Center Name is required.';
    if (!formValues.contactPerson.trim()) return 'Contact Person is required.';
    if (!formValues.place.trim()) return 'Place is required.';
    const rcCodeError = validateRcCodeInput(formValues.rcCode);
    if (rcCodeError) return rcCodeError;
    const zohoIdError = validateZohoIdInput(formValues.zohoId);
    if (zohoIdError) return zohoIdError;
    const zohoExpenseAccountIdError = validateZohoExpenseAccountIdInput(formValues.zohoExpenseAccountId);
    if (zohoExpenseAccountIdError) return zohoExpenseAccountIdError;
    const zohoExpenseAccountNameError = validateZohoExpenseAccountNameInput(formValues.zohoExpenseAccountName);
    if (zohoExpenseAccountNameError) return zohoExpenseAccountNameError;
    const panCardError = validatePanCardInput(formValues.panCard);
    if (panCardError) return panCardError;
    if (!formValues.address.trim()) return 'Address is required.';
    const pincodeError = validateRcPincodeInput(formValues.pincode);
    if (pincodeError) return pincodeError;
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
    if (formValues.certificationMethod === 'pdf_signer') {
      const hasSign = Boolean(signerSign?.url) && !signerRemoved;
      if (!hasSign) {
        return 'PDF signer needs signature and name image (JPG or PNG).';
      }
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

  const handleCertRemove = () => {
    setCert(null);
    setCertRemoved(true);
    setPendingCertFile(null);
  };

  const handlePanCardSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const uid = editingUid;
    if (!uid && formMode === 'create') {
      setPendingPanCardFile(file);
      setPanCardRemoved(false);
      return;
    }
    if (!uid) return;

    setPanCardUploading(true);
    setPanCardProgress(0);
    setError('');
    try {
      const meta = await uploadRcPanCard(uid, file, setPanCardProgress);
      const prevPath = panCardImage?.path || editingRc?.panCardPath;
      if (prevPath && prevPath !== meta.path) {
        await deleteRcStorageFile(prevPath).catch(() => undefined);
      }
      setPanCardImage(meta);
      setPanCardRemoved(false);
      setPendingPanCardFile(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'PAN card upload failed.');
    } finally {
      setPanCardUploading(false);
    }
  };

  const handlePanCardRemove = () => {
    setPanCardImage(null);
    setPanCardRemoved(true);
    setPendingPanCardFile(null);
  };

  const handleLogoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const uid = editingUid;
    if (!uid && formMode === 'create') {
      setPendingLogoFile(file);
      setLogoRemoved(false);
      setLogo({
        url: URL.createObjectURL(file),
        path: '',
        name: file.name,
        contentType: file.type,
      });
      return;
    }
    if (!uid) return;

    setLogoUploading(true);
    setError('');
    try {
      const meta = await uploadRcLogo(uid, file);
      const prevPath = logo?.path || editingRc?.logoPath || editingRc?.sealPath;
      if (prevPath && prevPath !== meta.path) {
        await deleteRcStorageFile(prevPath).catch(() => undefined);
      }
      setLogo(meta);
      setLogoRemoved(false);
      setPendingLogoFile(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Logo upload failed.');
    } finally {
      setLogoUploading(false);
    }
  };

  const handleSignerSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const uid = editingUid;
    if (!uid && formMode === 'create') {
      setPendingSignerFile(file);
      setSignerRemoved(false);
      setSignerSign({
        url: URL.createObjectURL(file),
        path: '',
        name: file.name,
        contentType: file.type,
      });
      return;
    }
    if (!uid) return;

    setSignerUploading(true);
    setError('');
    try {
      const meta = await uploadRcPdfSignerSign(uid, file);
      const prevPath = signerSign?.path || editingRc?.pdfSignerSignPath;
      if (prevPath && prevPath !== meta.path) {
        await deleteRcStorageFile(prevPath).catch(() => undefined);
      }
      setSignerSign(meta);
      setSignerRemoved(false);
      setPendingSignerFile(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Signature upload failed.');
    } finally {
      setSignerUploading(false);
    }
  };

  const handleSignerRemove = () => {
    setSignerSign(null);
    setSignerRemoved(true);
    setPendingSignerFile(null);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showAddForm && !formEditing) return;
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
    let createdAuthUid: string | undefined;
    try {
      await assertAadharAvailable(cleanAadhar);
      const cred = await createAuthUserForAadhar(cleanAadhar, formValues.password);
      const uid = cred.user.uid;
      createdAuthUid = uid;

      let certMeta: ProductFileMeta | null = null;
      let panMeta: ProductFileMeta | null = null;
      let logoMeta: ProductFileMeta | null = null;
      let signerMeta: ProductFileMeta | null = null;
      if (pendingCertFile) {
        setCertUploading(true);
        try {
          certMeta = await uploadRcStandardWeightsCert(uid, pendingCertFile, setCertProgress);
        } finally {
          setCertUploading(false);
        }
      }
      if (pendingPanCardFile) {
        setPanCardUploading(true);
        try {
          panMeta = await uploadRcPanCard(uid, pendingPanCardFile, setPanCardProgress);
        } finally {
          setPanCardUploading(false);
        }
      }
      if (pendingLogoFile) {
        setLogoUploading(true);
        try {
          logoMeta = await uploadRcLogo(uid, pendingLogoFile);
        } finally {
          setLogoUploading(false);
        }
      }
      if (pendingSignerFile) {
        setSignerUploading(true);
        try {
          signerMeta = await uploadRcPdfSignerSign(uid, pendingSignerFile);
        } finally {
          setSignerUploading(false);
        }
      }

      const profile: FirestoreUserDoc = {
        aadhar: cleanAadhar,
        role: 'rc_admin',
        createdAt: new Date().toISOString(),
        createdByUid: user?.uid,
        rcId: uid,
        ...buildRcFirestoreFields(
          formValues,
          { cert: certMeta, seal: null, panCard: panMeta, logo: logoMeta, pdfSignerSign: signerMeta },
          {
            includePassword: formValues.password,
            isCreate: true,
          },
        ),
      } as FirestoreUserDoc;

      const batch = writeBatch(db);
      batch.set(doc(db, 'users', uid), profile);
      batch.set(doc(db, 'aadharIndex', cleanAadhar), {
        uid,
        role: 'rc_admin',
        createdAt: profile.createdAt,
      });
      await batch.commit();
      createdAuthUid = undefined;

      handleCloseModal();
      await fetchRCs();
    } catch (err: unknown) {
      await rollbackCreatedAuthUser(createdAuthUid);
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
    setPanCardImage(panCardMetaFromUser(rc));
    setPanCardRemoved(false);
    setPendingPanCardFile(null);
    setLogo(logoMetaFromUser(rc));
    setLogoRemoved(false);
    setPendingLogoFile(null);
    setSignerSign(pdfSignerSignMetaFromUser(rc));
    setSignerRemoved(false);
    setPendingSignerFile(null);
    setFormEditing(false);
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
      const updates = buildRcFirestoreFields(
        formValues,
        { cert, seal: null, panCard: panCardImage, logo, pdfSignerSign: signerSign },
        { isCreate: false },
      );
      if (!canEditRcCertificationSettings(user)) {
        delete updates.certificationMethod;
        delete updates.pdfSignerSignUrl;
        delete updates.pdfSignerSignPath;
        delete updates.pdfSignerSignName;
        delete updates.pdfSignerSignContentType;
      }

      if (certRemoved && !cert) {
        updates.standardWeightsCertUrl = '';
        updates.standardWeightsCertPath = '';
        updates.standardWeightsCertName = '';
        updates.standardWeightsCertContentType = '';
        const oldPath = rc.standardWeightsCertPath;
        if (oldPath) await deleteRcStorageFile(oldPath).catch(() => undefined);
      }

      if (logoRemoved && !logo) {
        updates.logoUrl = '';
        updates.logoPath = '';
        updates.logoName = '';
        updates.logoContentType = '';
        const oldPath = rc.logoPath;
        if (oldPath) await deleteRcStorageFile(oldPath).catch(() => undefined);
      }

      if (signerRemoved && !signerSign && canEditRcCertificationSettings(user)) {
        updates.pdfSignerSignUrl = '';
        updates.pdfSignerSignPath = '';
        updates.pdfSignerSignName = '';
        updates.pdfSignerSignContentType = '';
        const oldPath = rc.pdfSignerSignPath;
        if (oldPath) await deleteRcStorageFile(oldPath).catch(() => undefined);
      }

      if (panCardRemoved && !panCardImage) {
        updates.panCardUrl = '';
        updates.panCardPath = '';
        updates.panCardName = '';
        updates.panCardContentType = '';
        const oldPath = rc.panCardPath;
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

      await updateDoc(doc(db, 'users', uid), {
        ...updates,
        ...rcZohoExpenseAccountLegacyCleanupFields(),
      });
      handleCloseModal();
      await fetchRCs();
    } catch (err: unknown) {
      setError(authErrorMessage(err, 'Failed to update regional center.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (rc: RCRecord) => {
    if (rc.uid === user?.uid) {
      alert("You can't deactivate your own account.");
      return;
    }

    const activating = !isRcAccountActive(rc);
    const name = rc.companyName || rc.username || 'this center';
    const ok = await confirm({
      title: activating ? 'Activate regional center?' : 'Deactivate regional center?',
      message: activating
        ? `Activate "${name}"? They will be able to sign in again.`
        : `Deactivate "${name}"? They will not be able to sign in until Super Admin activates them again.`,
      confirmLabel: activating ? 'Activate' : 'Deactivate',
      destructive: !activating,
    });
    if (!ok || !user?.uid) return;

    try {
      const updates: Record<string, unknown> = activating
        ? { active: true, deactivatedAt: deleteField(), deactivatedByUid: deleteField() }
        : {
            active: false,
            deactivatedAt: new Date().toISOString(),
            deactivatedByUid: user.uid,
          };
      await updateDoc(doc(db, 'users', rc.uid), updates);
      await fetchRCs();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to update regional center.');
    }
  };

  return (
    <div className="fade-in page-content page-content--rc-list">
      <div className="rc-summary-row">
        <article className="rc-summary-tile rc-summary-tile--blue">
          <p className="rc-summary-tile__label">
            <Building2 size={16} strokeWidth={2.2} aria-hidden />
            Centers
          </p>
          <p className="rc-summary-tile__value">{rcList.length}</p>
        </article>
        <article className="rc-summary-tile rc-summary-tile--pink">
          <p className="rc-summary-tile__label">
            <Users size={16} strokeWidth={2.2} aria-hidden />
            VCTs
          </p>
          <p className="rc-summary-tile__value">{rcList.reduce((s, r) => s + r.vctCount, 0)}</p>
        </article>
        <article className="rc-summary-tile rc-summary-tile--green">
          <p className="rc-summary-tile__label">
            <Award size={16} strokeWidth={2.2} aria-hidden />
            Certification
          </p>
          <p className="rc-summary-tile__value">{lifetimeCertified}</p>
        </article>
      </div>

      {showForm && (
        <InlineFormPanel id="rc-form" className="mb-6 inline-form-panel--wide inline-form-panel--rc">
          <div className="product-form-panel">
            <ListViewBackBar onBack={handleCloseModal} disabled={formBusy} />
            <div className="product-form-topbar rc-form-topbar">
              <div className="product-form-topbar-text">
                <h2 id="rc-form-title">
                  {showAddForm ? 'Register Regional Center' : 'Regional Center'}
                </h2>
                <p className="rc-form-topbar-error" role={error ? 'alert' : undefined}>
                  {error || '\u00a0'}
                </p>
              </div>
            </div>

            <form onSubmit={handleFormSubmit} className="product-form" autoComplete="off" noValidate>
              <div className="product-form-body">
                <RCFormFields
                  mode={showAddForm ? 'create' : 'edit'}
                  editing={fieldsEditing}
                  values={formValues}
                  onChange={patchForm}
                  logo={logo}
                  logoUploading={logoUploading}
                  onLogoSelect={handleLogoSelect}
                  cert={cert}
                  certUploading={certUploading}
                  certProgress={certProgress}
                  onCertSelect={handleCertSelect}
                  onCertRemove={handleCertRemove}
                  panCardImage={panCardImage}
                  panCardUploading={panCardUploading}
                  panCardProgress={panCardProgress}
                  onPanCardSelect={handlePanCardSelect}
                  onPanCardRemove={handlePanCardRemove}
                  signerSign={signerSign}
                  signerUploading={signerUploading}
                  onSignerSelect={handleSignerSelect}
                  onSignerRemove={handleSignerRemove}
                  submitting={submitting}
                  showPassword={showPw}
                  onTogglePassword={() => setShowPw(p => !p)}
                  loginAadhar={editingRc?.aadhar}
                  canEditCertification={canEditRcCertificationSettings(user)}
                  onStartEdit={showAddForm ? undefined : () => setFormEditing(true)}
                  editArmed={formEditing}
                  editBusy={formBusy}
                />
              </div>
              <div className="product-form-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleCloseModal}
                  disabled={formBusy}
                >
                  {showAddForm || formEditing ? 'Cancel' : 'Close'}
                </button>
                {showAddForm || formEditing ? (
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
                ) : null}
              </div>
            </form>
          </div>
        </InlineFormPanel>
      )}

      {!showForm && (
      <div className="panel glass panel--table mb-6">
        <div className="panel-body p-0">
          {loading ? (
            <div className="flex justify-center py-16">
              <span className="spinner-inline large"></span>
            </div>
          ) : (
            <div className="table-scroll-wrap">
            <table className="data-table data-table--rc data-table--mobile-cards">
              <colgroup>
                <col className="rc-col-serial" />
                <col className="rc-col-company" />
                <col className="rc-col-code" />
                <col className="rc-col-opted" />
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
                  <th className="rc-col-code">RC code</th>
                  <th className="rc-col-opted">Opted</th>
                  <th className="rc-col-place">Place</th>
                  <th className="rc-col-vcts">VCTs</th>
                  <th className="rc-col-jobs">Certification</th>
                  <th className="rc-col-due">Cert. due</th>
                  <th className="rc-col-status">Status</th>
                  <th className="rc-col-actions text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rcList.map((rc, index) => {
                  const company = rc.companyName || rc.username || '—';
                  const rcCode = normalizeRcCode(rc.rcCode || '');
                  const rcCodeLabel = rcCode || '—';
                  const certOpted = rcCertificationMethodLabel(rc);
                  const phone = rc.phone?.trim() || '—';
                  const cityDistrict = rc.place?.trim() || '—';
                  const accountActive = isRcAccountActive(rc);
                  const isActive = accountActive && isRcActive(rc);
                  const certDue = formatRcCertDueDate(rc);
                  const openEdit = () => startEdit(rc);
                  const editCell = tableEditCellProps(openEdit, 'Edit regional center');

                  return (
                    <tr key={rc.uid} className="table-mobile-row table-mobile-row--media-actions">
                      <td className="rc-col-avatar table-mobile-col-media">
                        <span className="rc-table-avatar">
                          <RcListAvatar rc={rc} />
                        </span>
                      </td>
                      <td className="rc-col-serial text-muted text-sm table-mobile-col-hide">{index + 1}</td>
                      <td {...editCell} className="rc-col-company font-medium table-mobile-col-primary table-col-editable">
                        <span className="table-mobile-primary-text rc-cell-ellipsis" title={company}>
                          {company}
                        </span>
                        <div className="table-mobile-summary rc-card-meta">
                          <div className="rc-card-line">
                            <span className="rc-card-stats">
                              <span className="rc-card-stat rc-card-stat--ov">
                                {rc.ovCount.toLocaleString('en-IN')} OV
                              </span>
                              {rc.rvCount > 0 ? (
                                <>
                                  <span className="rc-card-sep"> · </span>
                                  <span className="rc-card-stat rc-card-stat--rv">
                                    {rc.rvCount.toLocaleString('en-IN')} RV
                                  </span>
                                  <span className="rc-card-sep"> · </span>
                                  <span className="rc-card-stat rc-card-stat--total">
                                    {rc.certifiedCount.toLocaleString('en-IN')}
                                  </span>
                                </>
                              ) : null}
                            </span>
                            <span className="rc-card-line__end rc-card-line__opted" title={`Certification: ${certOpted}`}>
                              {certOpted}
                            </span>
                          </div>
                          <div className="rc-card-line">
                            <span className="rc-card-line__loc">
                              {rcCodeLabel !== '—' ? (
                                <>
                                  <span className="rc-card-code">{rcCodeLabel}</span>
                                  <span className="rc-card-sep"> · </span>
                                  {cityDistrict}
                                </>
                              ) : (
                                cityDistrict
                              )}
                            </span>
                            <span className="rc-card-line__end">{phone}</span>
                          </div>
                        </div>
                      </td>
                      <td
                        {...editCell}
                        className="rc-col-code text-sm table-mobile-col-hide table-col-editable text-mono font-semibold"
                        title={rcCodeLabel !== '—' ? `RC code ${rcCodeLabel}` : 'RC code not set'}
                      >
                        {rcCodeLabel}
                      </td>
                      <td
                        {...editCell}
                        className="rc-col-opted text-sm table-mobile-col-hide table-col-editable"
                        title={`Certification: ${certOpted}`}
                      >
                        <span className="rc-cell-ellipsis">{certOpted}</span>
                      </td>
                      <td {...editCell} className="rc-col-place text-sm table-mobile-col-hide table-col-editable">
                        <span className="rc-cell-ellipsis" title={rc.place || undefined}>
                          {rc.place || '—'}
                        </span>
                      </td>
                      <td {...editCell} className="rc-col-vcts table-mobile-col-hide table-col-editable">{rc.vctCount}</td>
                      <td {...editCell} className="rc-col-jobs table-mobile-col-hide table-col-editable">
                        <span className="rc-jobs-summary" title={`${rc.ovCount} OV + ${rc.rvCount} RV`}>
                          {rc.rvCount > 0 ? (
                            <>
                              <span className="rc-card-stat rc-card-stat--ov">{rc.ovCount.toLocaleString('en-IN')}</span>
                              <span className="rc-card-sep">+</span>
                              <span className="rc-card-stat rc-card-stat--rv">{rc.rvCount.toLocaleString('en-IN')}</span>
                            </>
                          ) : (
                            <span className="rc-card-stat rc-card-stat--ov">{rc.ovCount.toLocaleString('en-IN')}</span>
                          )}
                        </span>
                      </td>
                      <td
                        {...editCell}
                        className="rc-col-due text-sm table-mobile-col-hide table-col-editable"
                        title={certDue !== '—' ? certDue : undefined}
                      >
                        {certDue}
                      </td>
                      <td {...editCell} className="rc-col-status table-mobile-col-hide table-col-editable">
                        <span
                          className={`rc-status-badge ${isActive ? 'rc-status-badge--active' : 'rc-status-badge--inactive'}`}
                          title={
                            !accountActive
                              ? 'Account deactivated'
                              : isActive
                                ? 'Standard weights certificate uploaded'
                                : 'Standard weights certificate not uploaded'
                          }
                        >
                          {rcActivationLabel(rc)}
                        </span>
                      </td>
                      <td className="rc-col-actions text-right table-mobile-col-actions">
                        <RcListDeactivateToggle
                          active={accountActive}
                          noun="regional center"
                          name={company}
                          onClick={() => void handleToggleActive(rc)}
                        />
                      </td>
                    </tr>
                  );
                })}
                {listError ? (
                  <tr>
                    <td colSpan={10} className="text-center py-10 form-error">
                      {listError}
                    </td>
                  </tr>
                ) : rcList.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="text-center py-10 text-muted">
                      No regional centers yet. Click &quot;Register Center&quot; to add one.
                    </td>
                  </tr>
                ) : null}
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
