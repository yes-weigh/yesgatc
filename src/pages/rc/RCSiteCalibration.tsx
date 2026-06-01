import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  collection, getDocs, doc, setDoc, deleteDoc, updateDoc, query, where, getDoc,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { InlineFormPanel } from '../../components/InlineFormPanel';
import { VerificationListTable } from '../../components/VerificationListTable';
import { VerificationStatusBadge } from '../../components/VerificationStatusBadge';
import { TablePagination } from '../../components/TablePagination';
import { buildCustomerDevice } from '../../lib/customerProfileFields';
import {
  buildNewSiteCalibrationRecord,
  buildSelfVerificationSession,
  buildSiteCalibrationFromRow,
  createEmptyVerificationDeviceRow,
  EMPTY_VERIFICATION_SESSION,
  verificationSessionFromRecord,
  validateVerificationDraft,
  validateVerificationForSubmit,
  isSiteCalibrationSubmittable,
  siteCalibrationSubmitBlockReason,
  verificationTypeLabel,
  type VerificationDeviceRowValues,
  type VerificationSessionValues,
} from '../../lib/siteCalibrationProfileFields';
import {
  buildVerificationSubmitPatch,
  buildVerificationStatusFilterOptions,
  canDeleteVerification,
  canDownloadVerificationCertificate,
  canSubmitVerification,
  isVerificationEditable,
  isVerificationViewable,
  matchesVerificationStatusFilter,
  normalizeVerificationStatus,
  tallyVerificationStatusFilters,
  verificationFilterLabel,
  verificationStatusDescription,
} from '../../lib/verificationRequest';
import { matchesVerificationSearch } from '../../lib/verificationListSearch';
import { formatVerificationListDate } from '../../lib/verificationListFormat';
import { uploadSiteCalibrationDeviceImage } from '../../lib/siteCalibrationPhotoUpload';
import {
  emptyDeviceImageSlot,
  emptyDeviceVerificationImagesState,
  imageFieldsFromMeta,
  VERIFICATION_IMAGE_KINDS,
  verificationImagesFromRecord,
  type DeviceVerificationImagesState,
  type VerificationImageKind,
} from '../../lib/verificationDeviceImages';
import {
  emptyDeviceRvDocumentsState,
  RV_DOCUMENT_KINDS,
  rvDocumentFieldsFromMeta,
  rvDocumentsFromRecord,
  type DeviceRvDocumentsState,
  type RvDocumentKind,
} from '../../lib/verificationRvDeviceImages';
import {
  RefreshCw, Pencil, X, Plus, Save, ShieldCheck, Send, Download, Eye,
} from 'lucide-react';

import {
  VerificationListFilters,
  type VerificationStatusFilter,
} from '../../components/VerificationListFilters';
import { sortVerificationsByCertificateDesc } from '../../lib/verificationListSort';
import { paginateItems, VERIFICATION_TABLE_PAGE_SIZE } from '../../lib/tablePagination';
import type { Customer, FirestoreUserDoc, SiteCalibration } from '../../types';
import { VerificationSessionFields } from './VerificationSessionFields';
import { useAppContext } from '../../context/AppContext';
import {
  applyLaboratorySealToDeviceRows,
  resolveLaboratorySealIdentification,
} from '../../lib/rcLaboratoryFields';

export const RCSiteCalibration: React.FC = () => {
  const { user } = useAuth();
  const { products } = useAppContext();
  const confirm = useConfirm();
  const [records, setRecords] = useState<SiteCalibration[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sessionValues, setSessionValues] = useState<VerificationSessionValues>(EMPTY_VERIFICATION_SESSION);
  const [deviceImages, setDeviceImages] = useState<Record<string, DeviceVerificationImagesState>>({});
  const [deviceRvImages, setDeviceRvImages] = useState<Record<string, DeviceRvDocumentsState>>({});

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');
  const [statusFilter, setStatusFilter] = useState<VerificationStatusFilter>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(() => new Set());
  const selectAllDraftsRef = useRef<HTMLInputElement>(null);
  const [laboratorySealId, setLaboratorySealId] = useState('');
  const [rcProfile, setRcProfile] = useState<FirestoreUserDoc | null>(null);

  const fetchLaboratorySeal = useCallback(async () => {
    if (!user?.uid) return;
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      const docData = snap.exists() ? (snap.data() as FirestoreUserDoc) : null;
      setRcProfile(docData);
      setLaboratorySealId(resolveLaboratorySealIdentification(docData));
    } catch {
      setRcProfile(null);
      setLaboratorySealId(resolveLaboratorySealIdentification(null));
    }
  }, [user?.uid]);

  const fetchRecords = useCallback(async () => {
    if (!user?.uid) return;
    setLoading(true);
    setListError('');
    try {
      const q = query(collection(db, 'siteCalibrations'), where('rcId', '==', user.uid));
      const snap = await getDocs(q);
      const rows = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as Omit<SiteCalibration, 'id'>) }))
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      setRecords(rows);
    } catch (err: unknown) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code: string }).code)
          : '';
      if (code === 'permission-denied') {
        setListError(
          'Could not load verification records. Deploy Firestore rules: firebase deploy --only firestore:rules',
        );
      } else {
        setListError(err instanceof Error ? err.message : 'Failed to load verification records.');
      }
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  const fetchCustomers = useCallback(async () => {
    if (!user?.uid) return;
    try {
      const q = query(collection(db, 'customers'), where('rcId', '==', user.uid));
      const snap = await getDocs(q);
      const rows = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as Omit<Customer, 'id'>) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setCustomers(rows);
    } catch {
      setCustomers([]);
    }
  }, [user?.uid]);

  useEffect(() => {
    Promise.resolve().then(() => {
      fetchRecords();
      fetchCustomers();
      fetchLaboratorySeal();
    });
  }, [fetchRecords, fetchCustomers, fetchLaboratorySeal]);

  const showForm = showAddForm || editingId !== null;
  const formBusy = submitting;
  const isEditMode = editingId !== null;

  useEffect(() => {
    if (!showForm || !user?.uid) return;
    void fetchLaboratorySeal();
  }, [showForm, user?.uid, fetchLaboratorySeal]);

  useEffect(() => {
    if (!showForm || !laboratorySealId) return;
    const editingRecord = editingId ? records.find(r => r.id === editingId) : null;
    if (editingRecord && !isVerificationEditable(editingRecord)) return;
    setSessionValues(prev => ({
      ...prev,
      devices: applyLaboratorySealToDeviceRows(prev.devices, laboratorySealId),
    }));
  }, [laboratorySealId, showForm, editingId, records]);

  useEffect(() => {
    if (sessionValues.verificationType !== 'RV') {
      setDeviceRvImages({});
      return;
    }
    setDeviceRvImages(prev => {
      const next = { ...prev };
      let changed = false;
      for (const row of sessionValues.devices) {
        if (!next[row.localId]) {
          next[row.localId] = emptyDeviceRvDocumentsState();
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [sessionValues.verificationType, sessionValues.devices]);

  const resetForm = () => {
    setSessionValues(EMPTY_VERIFICATION_SESSION);
    setDeviceImages({});
    setDeviceRvImages({});
    setError('');
  };

  const handleCloseForm = () => {
    if (formBusy) return;
    setShowAddForm(false);
    setEditingId(null);
    resetForm();
  };

  useEffect(() => {
    if (!showForm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !formBusy) handleCloseForm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showForm, formBusy]);

  const patchSession = (patch: Partial<VerificationSessionValues>) => {
    setSessionValues(prev => ({ ...prev, ...patch }));
  };

  const handleCustomerChange = (
    _customerId: string,
    _customerName: string,
    devices: VerificationDeviceRowValues[],
    options?: { preserveDeviceImages?: boolean },
  ) => {
    setDeviceImages(prev => {
      const next: Record<string, DeviceVerificationImagesState> = {};
      for (const row of devices) {
        next[row.localId] =
          options?.preserveDeviceImages && prev[row.localId]
            ? prev[row.localId]
            : emptyDeviceVerificationImagesState();
      }
      return next;
    });
    setDeviceRvImages(prev => {
      const next: Record<string, DeviceRvDocumentsState> = {};
      for (const row of devices) {
        next[row.localId] =
          options?.preserveDeviceImages && prev[row.localId]
            ? prev[row.localId]
            : emptyDeviceRvDocumentsState();
      }
      return next;
    });
  };

  const handleCustomerUpdated = (updated: Customer) => {
    setCustomers(prev =>
      prev
        .map(c => (c.id === updated.id ? updated : c))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  };

  const handleDeviceChange = (localId: string, patch: Partial<VerificationDeviceRowValues>) => {
    const { sealIdentificationNumber: _seal, ...rest } = patch;
    setSessionValues(prev => ({
      ...prev,
      devices: prev.devices.map(row =>
        row.localId === localId ? { ...row, ...rest, sealIdentificationNumber: laboratorySealId || row.sealIdentificationNumber } : row,
      ),
    }));
  };

  const handleDeviceAdd = () => {
    const row = {
      ...createEmptyVerificationDeviceRow(),
      sealIdentificationNumber: laboratorySealId,
    };
    setSessionValues(prev => ({ ...prev, devices: [...prev.devices, row] }));
    setDeviceImages(prev => ({ ...prev, [row.localId]: emptyDeviceVerificationImagesState() }));
    setDeviceRvImages(prev => ({ ...prev, [row.localId]: emptyDeviceRvDocumentsState() }));
  };

  const handleDeviceRemove = (localId: string) => {
    setSessionValues(prev => ({
      ...prev,
      devices: prev.devices.filter(row => row.localId !== localId),
    }));
    setDeviceImages(prev => {
      const next = { ...prev };
      delete next[localId];
      return next;
    });
    setDeviceRvImages(prev => {
      const next = { ...prev };
      delete next[localId];
      return next;
    });
  };

  const handleDeviceImageSelect = (localId: string, kind: VerificationImageKind, file: File) => {
    const previewUrl = URL.createObjectURL(file);
    setDeviceImages(prev => ({
      ...prev,
      [localId]: {
        ...(prev[localId] ?? emptyDeviceVerificationImagesState()),
        [kind]: {
          ...(prev[localId]?.[kind] ?? emptyDeviceImageSlot()),
          pendingFile: file,
          removed: false,
          file: { url: previewUrl, path: '', name: file.name, contentType: file.type },
          uploading: false,
          progress: 0,
        },
      },
    }));
  };

  const handleDeviceImageRemove = (localId: string, kind: VerificationImageKind) => {
    setDeviceImages(prev => ({
      ...prev,
      [localId]: {
        ...(prev[localId] ?? emptyDeviceVerificationImagesState()),
        [kind]: emptyDeviceImageSlot(),
      },
    }));
  };

  const handleDeviceRvDocumentSelect = (localId: string, kind: RvDocumentKind, file: File) => {
    const previewUrl = URL.createObjectURL(file);
    setDeviceRvImages(prev => ({
      ...prev,
      [localId]: {
        ...(prev[localId] ?? emptyDeviceRvDocumentsState()),
        [kind]: {
          ...(prev[localId]?.[kind] ?? emptyDeviceImageSlot()),
          pendingFile: file,
          removed: false,
          file: { url: previewUrl, path: '', name: file.name, contentType: file.type },
          uploading: false,
          progress: 0,
        },
      },
    }));
  };

  const handleDeviceRvDocumentRemove = (localId: string, kind: RvDocumentKind) => {
    setDeviceRvImages(prev => ({
      ...prev,
      [localId]: {
        ...(prev[localId] ?? emptyDeviceRvDocumentsState()),
        [kind]: emptyDeviceImageSlot(),
      },
    }));
  };

  const uploadDeviceImageSlot = async (
    recordId: string,
    localId: string,
    kind: VerificationImageKind,
  ): Promise<Partial<SiteCalibration>> => {
    const slot = deviceImages[localId]?.[kind] ?? emptyDeviceImageSlot();
    if (slot.removed && !slot.pendingFile) return imageFieldsFromMeta(kind, null);
    if (!slot.pendingFile) {
      if (slot.file?.url && !slot.file.url.startsWith('blob:')) {
        return imageFieldsFromMeta(kind, slot.file);
      }
      return {};
    }

    setDeviceImages(prev => ({
      ...prev,
      [localId]: {
        ...(prev[localId] ?? emptyDeviceVerificationImagesState()),
        [kind]: { ...(prev[localId]?.[kind] ?? emptyDeviceImageSlot()), uploading: true, progress: 0 },
      },
    }));

    try {
      const meta = await uploadSiteCalibrationDeviceImage(recordId, kind, slot.pendingFile, pct => {
        setDeviceImages(prev => ({
          ...prev,
          [localId]: {
            ...(prev[localId] ?? emptyDeviceVerificationImagesState()),
            [kind]: { ...(prev[localId]?.[kind] ?? emptyDeviceImageSlot()), progress: pct },
          },
        }));
      });
      setDeviceImages(prev => ({
        ...prev,
        [localId]: {
          ...(prev[localId] ?? emptyDeviceVerificationImagesState()),
          [kind]: {
            ...(prev[localId]?.[kind] ?? emptyDeviceImageSlot()),
            file: meta,
            uploading: false,
            progress: 100,
            pendingFile: null,
            removed: false,
          },
        },
      }));
      return imageFieldsFromMeta(kind, meta);
    } catch (err) {
      setDeviceImages(prev => ({
        ...prev,
        [localId]: {
          ...(prev[localId] ?? emptyDeviceVerificationImagesState()),
          [kind]: {
            ...(prev[localId]?.[kind] ?? emptyDeviceImageSlot()),
            uploading: false,
            progress: 0,
          },
        },
      }));
      throw err;
    }
  };

  const uploadDeviceRvDocumentSlot = async (
    recordId: string,
    localId: string,
    kind: RvDocumentKind,
  ): Promise<Partial<SiteCalibration>> => {
    const slot = deviceRvImages[localId]?.[kind] ?? emptyDeviceImageSlot();
    if (slot.removed && !slot.pendingFile) return rvDocumentFieldsFromMeta(kind, null);
    if (!slot.pendingFile) {
      if (slot.file?.url && !slot.file.url.startsWith('blob:')) {
        return rvDocumentFieldsFromMeta(kind, slot.file);
      }
      return {};
    }

    setDeviceRvImages(prev => ({
      ...prev,
      [localId]: {
        ...(prev[localId] ?? emptyDeviceRvDocumentsState()),
        [kind]: { ...(prev[localId]?.[kind] ?? emptyDeviceImageSlot()), uploading: true, progress: 0 },
      },
    }));

    try {
      const meta = await uploadSiteCalibrationDeviceImage(recordId, kind, slot.pendingFile, pct => {
        setDeviceRvImages(prev => ({
          ...prev,
          [localId]: {
            ...(prev[localId] ?? emptyDeviceRvDocumentsState()),
            [kind]: { ...(prev[localId]?.[kind] ?? emptyDeviceImageSlot()), progress: pct },
          },
        }));
      });
      setDeviceRvImages(prev => ({
        ...prev,
        [localId]: {
          ...(prev[localId] ?? emptyDeviceRvDocumentsState()),
          [kind]: {
            ...(prev[localId]?.[kind] ?? emptyDeviceImageSlot()),
            file: meta,
            uploading: false,
            progress: 100,
            pendingFile: null,
            removed: false,
          },
        },
      }));
      return rvDocumentFieldsFromMeta(kind, meta);
    } catch (err) {
      setDeviceRvImages(prev => ({
        ...prev,
        [localId]: {
          ...(prev[localId] ?? emptyDeviceRvDocumentsState()),
          [kind]: {
            ...(prev[localId]?.[kind] ?? emptyDeviceImageSlot()),
            uploading: false,
            progress: 0,
          },
        },
      }));
      throw err;
    }
  };

  const uploadRowImages = async (
    recordId: string,
    localId: string,
    includeRvDocuments: boolean,
  ): Promise<Partial<SiteCalibration>> => {
    let fields: Partial<SiteCalibration> = {};
    for (const kind of VERIFICATION_IMAGE_KINDS) {
      fields = { ...fields, ...(await uploadDeviceImageSlot(recordId, localId, kind)) };
    }
    if (includeRvDocuments) {
      for (const kind of RV_DOCUMENT_KINDS) {
        fields = { ...fields, ...(await uploadDeviceRvDocumentSlot(recordId, localId, kind)) };
      }
    }
    return fields;
  };

  const syncCustomerDevices = async (rows: VerificationDeviceRowValues[]) => {
    if (sessionValues.verificationSubject === 'self') return;
    const customer = customers.find(c => c.id === sessionValues.customerId);
    if (!customer) return;

    let devices = [...(customer.devices || [])];
    let changed = false;

    for (const row of rows) {
      if (row.isNewDevice) {
        if (devices.some(d => d.id === row.localId)) continue;
        devices.push(
          buildCustomerDevice({
            localId: row.localId,
            productId: row.productId,
            productName: row.productName,
            serialNumber: row.serialNumber,
          }),
        );
        changed = true;
        continue;
      }

      if (!row.deviceId) continue;
      const index = devices.findIndex(d => d.id === row.deviceId);
      if (index < 0) continue;

      const current = devices[index];
      const productId = row.productId.trim();
      const productName = row.productName.trim();
      const serialNumber = row.serialNumber.trim();

      if (
        (current.productId || '') !== productId ||
        current.productName !== productName ||
        current.serialNumber !== serialNumber
      ) {
        devices[index] = {
          ...current,
          productName,
          serialNumber,
          ...(productId ? { productId } : {}),
        };
        changed = true;
      }
    }

    if (!changed) return;

    const updatedAt = new Date().toISOString();
    await updateDoc(doc(db, 'customers', sessionValues.customerId), {
      devices,
      updatedAt,
    });

    setCustomers(prev =>
      prev.map(c =>
        c.id === sessionValues.customerId ? { ...c, devices, updatedAt } : c,
      ),
    );
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isViewMode) return;
    if (showAddForm) await handleCreate();
    else if (editingId) await handleSaveEdit(editingId);
  };

  const formatSaveError = (err: unknown, fallback: string): string => {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code: string }).code)
        : '';
    if (code === 'permission-denied') {
      return 'Missing or insufficient permissions. Deploy Firestore rules: firebase deploy --only firestore:rules';
    }
    return err instanceof Error ? err.message : fallback;
  };

  const handleCreate = async (submitAfterSave = false) => {
    setError('');
    const validationError = validateVerificationDraft(sessionValues, deviceImages, deviceRvImages);
    if (validationError) {
      setError(validationError);
      return;
    }

    if (submitAfterSave) {
      const submitError = validateVerificationForSubmit(sessionValues, deviceImages, deviceRvImages);
      if (submitError) {
        setError(submitError);
        return;
      }
    }

    const includedRows = sessionValues.devices.filter(row => row.included);
    setSubmitting(true);
    try {
      const rowsToSync = includedRows.filter(
        row => row.productId.trim() && row.serialNumber.trim(),
      );
      await syncCustomerDevices(rowsToSync);

      for (const row of includedRows) {
        const ref = doc(collection(db, 'siteCalibrations'));
        const recordId = ref.id;
        const imageFields = await uploadRowImages(recordId, row.localId, sessionValues.verificationType === 'RV');
        const deviceId = row.isNewDevice ? row.localId : row.deviceId;
        const product = products.find(p => p.id === row.productId) ?? null;

        const record: Omit<SiteCalibration, 'id'> = {
          rcId: user!.uid,
          createdAt: new Date().toISOString(),
          createdByUid: user?.uid,
          ...buildNewSiteCalibrationRecord(sessionValues, { ...row, deviceId }, product),
          ...imageFields,
        };
        await setDoc(ref, record);
        if (submitAfterSave) {
          await updateDoc(ref, buildVerificationSubmitPatch());
        }
      }

      handleCloseForm();
      await fetchRecords();
    } catch (err: unknown) {
      setError(formatSaveError(err, 'Failed to save verification records.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveEdit = async (recordId: string) => {
    const existing = records.find(r => r.id === recordId);
    if (!existing || !isVerificationEditable(existing)) {
      setError('Only draft verifications can be edited.');
      return;
    }

    const validationError = validateVerificationDraft(sessionValues, deviceImages, deviceRvImages);
    if (validationError) {
      setError(validationError);
      return;
    }

    const row = sessionValues.devices[0];
    if (!row) {
      setError('Device data is missing.');
      return;
    }

    setSubmitting(true);
    try {
      if (row.productId.trim() && row.serialNumber.trim()) {
        await syncCustomerDevices([row]);
      }
      const product = products.find(p => p.id === row.productId) ?? null;
      const imageFields = await uploadRowImages(recordId, row.localId, sessionValues.verificationType === 'RV');
      await updateDoc(doc(db, 'siteCalibrations', recordId), {
        ...buildSiteCalibrationFromRow(sessionValues, row, { product }),
        ...imageFields,
        updatedAt: new Date().toISOString(),
      });
      handleCloseForm();
      await fetchRecords();
    } catch (err: unknown) {
      setError(formatSaveError(err, 'Failed to update verification record.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitRecord = async (record: SiteCalibration) => {
    if (!canSubmitVerification(record)) return;

    const validationError = siteCalibrationSubmitBlockReason(record);
    if (validationError) {
      setListError(validationError);
      return;
    }

    const ok = await confirm({
      title: 'Submit for certification?',
      message:
        `Submit verification for ${record.customerName} · ${record.serialNumber || 'device'}?\n\nAfter submission you cannot edit this record. Approved status is set only by the certificate server.`,
      confirmLabel: 'Submit',
    });
    if (!ok) return;

    setSubmitting(true);
    setListError('');
    try {
      await updateDoc(doc(db, 'siteCalibrations', record.id), buildVerificationSubmitPatch());
      if (editingId === record.id) handleCloseForm();
      await fetchRecords();
    } catch (err: unknown) {
      setListError(err instanceof Error ? err.message : 'Failed to submit verification.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleBulkSubmitRecords = async () => {
    const selectedRecords = filteredRecords.filter(
      r => selectedDraftIds.has(r.id) && isSiteCalibrationSubmittable(r),
    );

    if (selectedRecords.length === 0) {
      setListError('None of the selected drafts are ready to submit. Complete required fields and images first.');
      return;
    }

    const skippedCount = selectedDraftIds.size - selectedRecords.length;
    const ok = await confirm({
      title: 'Submit selected verifications?',
      message:
        `Submit ${selectedRecords.length} verification${selectedRecords.length !== 1 ? 's' : ''} for certification?\n\n` +
        'After submission they cannot be edited. Approved status is set only by the certificate server.' +
        (skippedCount > 0
          ? `\n\n${skippedCount} incomplete draft${skippedCount !== 1 ? 's were' : ' was'} not included.`
          : ''),
      confirmLabel: 'Submit',
    });
    if (!ok) return;

    setSubmitting(true);
    setListError('');
    try {
      await Promise.all(
        selectedRecords.map(record =>
          updateDoc(doc(db, 'siteCalibrations', record.id), buildVerificationSubmitPatch()),
        ),
      );
      setSelectedDraftIds(new Set());
      if (editingId && selectedRecords.some(r => r.id === editingId)) handleCloseForm();
      await fetchRecords();
    } catch (err: unknown) {
      setListError(formatSaveError(err, 'Failed to submit selected verifications.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitFromForm = async () => {
    const validationError = validateVerificationForSubmit(sessionValues, deviceImages, deviceRvImages);
    if (validationError) {
      setError(validationError);
      return;
    }

    if (showAddForm) {
      const ok = await confirm({
        title: 'Save and submit for certification?',
        message:
          includedDeviceCount > 1
            ? `Save and submit ${includedDeviceCount} verifications? They will be locked and queued for certification.`
            : 'Save and submit this verification? It will be locked and queued for certification.',
        confirmLabel: 'Save & submit',
      });
      if (!ok) return;
      await handleCreate(true);
      return;
    }

    if (!editingId) return;
    const existing = records.find(r => r.id === editingId);
    if (!existing) return;

    const row = sessionValues.devices[0];
    if (!row) {
      setError('Device data is missing.');
      return;
    }

    const ok = await confirm({
      title: 'Save and submit for certification?',
      message:
        'Your latest changes will be saved, then this verification will be locked and queued for certification.',
      confirmLabel: 'Save & submit',
    });
    if (!ok) return;

    setSubmitting(true);
    setError('');
    try {
      if (row.productId.trim() && row.serialNumber.trim()) {
        await syncCustomerDevices([row]);
      }
      const product = products.find(p => p.id === row.productId) ?? null;
      const imageFields = await uploadRowImages(editingId, row.localId, sessionValues.verificationType === 'RV');
      await updateDoc(doc(db, 'siteCalibrations', editingId), {
        ...buildSiteCalibrationFromRow(sessionValues, row, { product }),
        ...imageFields,
        ...buildVerificationSubmitPatch(),
      });
      handleCloseForm();
      await fetchRecords();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to submit verification.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartAdd = () => {
    setEditingId(null);
    setError('');
    if (user?.uid && rcProfile) {
      const session = buildSelfVerificationSession(rcProfile, user.uid, laboratorySealId);
      setSessionValues(session);
      setDeviceImages({
        [session.devices[0]?.localId]: emptyDeviceVerificationImagesState(),
      });
      setDeviceRvImages({
        [session.devices[0]?.localId]: emptyDeviceRvDocumentsState(),
      });
    } else {
      resetForm();
    }
    setShowAddForm(true);
  };

  const openRecord = (record: SiteCalibration) => {
    if (!isVerificationViewable(record)) return;
    setShowAddForm(false);
    setEditingId(record.id);
    const session = verificationSessionFromRecord(record);
    const devices = isVerificationEditable(record)
      ? applyLaboratorySealToDeviceRows(session.devices, laboratorySealId)
      : session.devices;
    setSessionValues({ ...session, devices });
    setDeviceImages({
      [session.devices[0]?.localId || record.id]: verificationImagesFromRecord(record),
    });
    setDeviceRvImages({
      [session.devices[0]?.localId || record.id]:
        record.verificationType === 'RV' ? rvDocumentsFromRecord(record) : emptyDeviceRvDocumentsState(),
    });
    setError('');
  };

  const startEdit = (record: SiteCalibration) => {
    openRecord(record);
  };

  const handleDelete = async (record: SiteCalibration) => {
    if (!canDeleteVerification(record)) return;
    const label = `${verificationTypeLabel(record.verificationType)} · ${record.customerName}`;
    const ok = await confirm({
      title: 'Remove verification record?',
      message: `Remove "${label}"?\nThis cannot be undone.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    await deleteDoc(doc(db, 'siteCalibrations', record.id));
    await fetchRecords();
  };

  const formatDate = formatVerificationListDate;

  const includedDeviceCount = sessionValues.devices.filter(d => d.included).length;
  const editingRecord = editingId ? records.find(r => r.id === editingId) ?? null : null;
  const editingDraft = editingRecord ? isVerificationEditable(editingRecord) : showAddForm;
  const isViewMode = Boolean(editingRecord && !editingDraft);
  const viewingStatus = editingRecord ? normalizeVerificationStatus(editingRecord) : null;

  const draftBlockReason = useMemo(
    () => (showForm ? validateVerificationDraft(sessionValues, deviceImages, deviceRvImages) : null),
    [showForm, sessionValues, deviceImages, deviceRvImages],
  );

  const submitBlockReason = useMemo(
    () => (showForm ? validateVerificationForSubmit(sessionValues, deviceImages, deviceRvImages) : null),
    [showForm, sessionValues, deviceImages, deviceRvImages],
  );

  const canSubmitFromForm = !submitBlockReason;

  const filteredRecords = useMemo(() => {
    const filtered = records.filter(record => {
      if (!matchesVerificationSearch(record, searchTerm)) return false;
      return matchesVerificationStatusFilter(record, statusFilter);
    });
    return sortVerificationsByCertificateDesc(filtered);
  }, [records, statusFilter, searchTerm]);

  const paginatedRecords = useMemo(
    () => paginateItems(filteredRecords, page, VERIFICATION_TABLE_PAGE_SIZE),
    [filteredRecords, page],
  );

  const statusCounts = useMemo(() => tallyVerificationStatusFilters(records), [records]);

  const statusFilterOptions = buildVerificationStatusFilterOptions(statusCounts);

  const draftSubmitMeta = useMemo(() => {
    const meta = new Map<string, { submittable: boolean; blockReason: string | null }>();
    for (const record of filteredRecords) {
      if (normalizeVerificationStatus(record) !== 'draft') continue;
      const blockReason = siteCalibrationSubmitBlockReason(record);
      meta.set(record.id, { submittable: !blockReason, blockReason });
    }
    return meta;
  }, [filteredRecords]);

  const selectableDraftIds = useMemo(
    () => [...draftSubmitMeta.entries()].filter(([, value]) => value.submittable).map(([id]) => id),
    [draftSubmitMeta],
  );

  const allSelectableDraftsSelected =
    selectableDraftIds.length > 0 && selectableDraftIds.every(id => selectedDraftIds.has(id));

  const someSelectableDraftsSelected =
    selectableDraftIds.some(id => selectedDraftIds.has(id)) && !allSelectableDraftsSelected;

  const rowOffset = (page - 1) * VERIFICATION_TABLE_PAGE_SIZE;

  useEffect(() => {
    setPage(1);
  }, [statusFilter, searchTerm]);

  useEffect(() => {
    setSelectedDraftIds(new Set());
  }, [statusFilter, searchTerm]);

  useEffect(() => {
    if (selectAllDraftsRef.current) {
      selectAllDraftsRef.current.indeterminate = someSelectableDraftsSelected;
    }
  }, [someSelectableDraftsSelected, selectableDraftIds.length]);

  const toggleDraftSelection = (id: string, submittable: boolean) => {
    if (!submittable) return;
    setSelectedDraftIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllDrafts = () => {
    setSelectedDraftIds(prev => {
      if (allSelectableDraftsSelected) {
        const next = new Set(prev);
        selectableDraftIds.forEach(id => next.delete(id));
        return next;
      }
      return new Set([...prev, ...selectableDraftIds]);
    });
  };

  return (
    <div className="fade-in page-content">
      {showForm && (
        <InlineFormPanel
          id="site-calibration-form"
          className="mb-6 inline-form-panel--wide inline-form-panel--calibration"
        >
          <div className="product-form-panel">
            <div className="product-form-topbar">
              <div className="product-form-topbar-text">
                <h2 id="site-calibration-form-title">
                  {showAddForm ? (
                    <>
                      <Plus className="inline-icon" /> New Verification
                    </>
                  ) : isViewMode ? (
                    <>
                      <Eye className="inline-icon" /> View Verification
                    </>
                  ) : (
                    <>
                      <Pencil className="inline-icon" /> Edit Verification
                    </>
                  )}
                </h2>
                <p className="text-muted text-sm mt-1 mb-0">
                  {showAddForm
                    ? sessionValues.customerId
                      ? includedDeviceCount === 0
                        ? 'Select at least one device to verify'
                        : includedDeviceCount === 1
                          ? '1 device selected — creates 1 draft row'
                          : `${includedDeviceCount} devices selected — creates ${includedDeviceCount} draft rows (one per device)`
                      : 'Select a customer to load registered devices'
                    : isViewMode && viewingStatus
                      ? verificationStatusDescription(viewingStatus)
                      : 'Update draft verification for this device'}
                </p>
                {isViewMode && editingRecord && (
                  <div className="verification-view-banner mt-2">
                    <VerificationStatusBadge record={editingRecord} />
                    {editingRecord.submittedAt && (
                      <span className="text-muted text-xs">
                        Submitted {formatDate(editingRecord.submittedAt)}
                      </span>
                    )}
                    {editingRecord.certificateNumber?.trim() && (
                      <span className="text-mono text-xs">
                        Cert {editingRecord.certificateNumber.trim()}
                      </span>
                    )}
                    {canDownloadVerificationCertificate(editingRecord) && (
                      <a
                        href={editingRecord.certificatePdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-secondary btn-sm flex items-center gap-1"
                      >
                        <Download size={14} /> Download certificate
                      </a>
                    )}
                  </div>
                )}
                <p className="rc-form-topbar-error" role={error ? 'alert' : undefined}>
                  {error || '\u00a0'}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary text-sm py-1.5 px-3 flex items-center gap-1 shrink-0"
                onClick={handleCloseForm}
                disabled={formBusy}
                aria-label="Close"
              >
                <X size={15} /> Close
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="product-form" autoComplete="off" noValidate>
              <div className="product-form-body">
                <VerificationSessionFields
                  values={sessionValues}
                  onChange={patchSession}
                  onCustomerChange={handleCustomerChange}
                  deviceImages={deviceImages}
                  deviceRvImages={deviceRvImages}
                  onDeviceChange={handleDeviceChange}
                  onDeviceAdd={handleDeviceAdd}
                  onDeviceRemove={handleDeviceRemove}
                  onDeviceImageSelect={handleDeviceImageSelect}
                  onDeviceImageRemove={handleDeviceImageRemove}
                  onDeviceRvDocumentSelect={handleDeviceRvDocumentSelect}
                  onDeviceRvDocumentRemove={handleDeviceRvDocumentRemove}
                  customers={customers}
                  rcProfile={rcProfile}
                  rcUid={user?.uid}
                  submitting={formBusy}
                  lockCustomer={isEditMode}
                  readOnly={isViewMode}
                  laboratorySealIdentification={laboratorySealId}
                  onCustomerUpdated={handleCustomerUpdated}
                />
              </div>
              <div className="product-form-footer verification-form-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleCloseForm}
                  disabled={formBusy}
                >
                  {isViewMode ? 'Close' : 'Cancel'}
                </button>
                {!isViewMode && (
                  <>
                    <button
                      type="submit"
                      className="btn btn-primary flex items-center gap-2"
                      disabled={formBusy || Boolean(draftBlockReason)}
                      title={draftBlockReason ?? undefined}
                    >
                      {formBusy ? (
                        <span className="spinner-inline"></span>
                      ) : showAddForm ? (
                        <>
                          <Save size={16} />{' '}
                          {includedDeviceCount > 1
                            ? `Save ${includedDeviceCount} drafts`
                            : 'Save draft'}
                        </>
                      ) : (
                        <>
                          <Save size={18} /> Save draft
                        </>
                      )}
                    </button>
                    {editingDraft && (
                      <div className="verification-form-submit-group">
                        <button
                          type="button"
                          className="btn btn-success flex items-center gap-2"
                          onClick={() => void handleSubmitFromForm()}
                          disabled={formBusy || !canSubmitFromForm}
                          title={submitBlockReason ?? undefined}
                        >
                          {formBusy ? (
                            <span className="spinner-inline"></span>
                          ) : (
                            <>
                              <Send size={16} />{' '}
                              {showAddForm && includedDeviceCount > 1
                                ? `Submit ${includedDeviceCount} for certification`
                                : 'Submit for certification'}
                            </>
                          )}
                        </button>
                        {submitBlockReason && (
                          <p className="verification-form-submit-reason text-muted text-xs mb-0">
                            {submitBlockReason}
                          </p>
                        )}
                      </div>
                    )}
                  </>
                )}
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
                <ShieldCheck className="inline-icon" /> Verification
              </h2>
              <p className="text-muted text-sm mt-1">
                {records.length} verification{records.length !== 1 ? 's' : ''} · one row per device · draft → submit → approved
              </p>
              {listError && (
                <p className="rc-form-topbar-error text-sm mt-1" role="alert">
                  {listError}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn btn-primary flex items-center gap-1.5 text-sm py-1.5 px-3"
                onClick={handleStartAdd}
              >
                <Plus size={16} /> New
              </button>
              <button className="btn-icon" onClick={fetchRecords} title="Refresh" type="button">
                <RefreshCw size={18} />
              </button>
            </div>
          </div>
          <div className="panel-body p-0">
            <VerificationListFilters
              searchTerm={searchTerm}
              onSearchTermChange={setSearchTerm}
              searchPlaceholder="Search customer, serial, certificate…"
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              statusOptions={statusFilterOptions}
            />
            {selectedDraftIds.size > 0 && (
              <div className="verification-bulk-bar">
                <span className="verification-bulk-bar-count">
                  {selectedDraftIds.size} draft{selectedDraftIds.size !== 1 ? 's' : ''} selected
                </span>
                <button
                  type="button"
                  className="btn btn-primary text-sm py-1.5 px-3 flex items-center gap-1.5"
                  onClick={() => void handleBulkSubmitRecords()}
                  disabled={submitting}
                >
                  {submitting ? (
                    <span className="spinner-inline"></span>
                  ) : (
                    <>
                      <Send size={16} /> Submit for certification
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary text-sm py-1.5 px-3"
                  onClick={() => setSelectedDraftIds(new Set())}
                  disabled={submitting}
                >
                  Clear selection
                </button>
              </div>
            )}
            {loading ? (
              <div className="flex justify-center py-16">
                <span className="spinner-inline large"></span>
              </div>
            ) : (
              <>
                <TablePagination
                  page={page}
                  totalItems={filteredRecords.length}
                  pageSize={VERIFICATION_TABLE_PAGE_SIZE}
                  onPageChange={setPage}
                  placement="top"
                />
                <VerificationListTable
                  mode="rc"
                  records={paginatedRecords}
                  rowOffset={rowOffset}
                  formatDate={formatDate}
                  emptyMessage={
                    records.length === 0
                      ? 'No verification records yet. Click "New" to add a draft.'
                      : `No ${statusFilter === 'all' ? '' : `${verificationFilterLabel(statusFilter).toLowerCase()} `}verifications.`
                  }
                  onView={openRecord}
                  onEdit={startEdit}
                  onSubmit={handleSubmitRecord}
                  onDelete={handleDelete}
                  submitting={submitting}
                  bulkSelect={{
                    selectedDraftIds,
                    draftSubmitMeta,
                    selectAllDraftsRef,
                    selectableDraftIds,
                    allSelectableDraftsSelected,
                    onToggleDraftSelection: toggleDraftSelection,
                    onToggleSelectAllDrafts: toggleSelectAllDrafts,
                  }}
                />
                <TablePagination
                  page={page}
                  totalItems={filteredRecords.length}
                  pageSize={VERIFICATION_TABLE_PAGE_SIZE}
                  onPageChange={setPage}
                />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
