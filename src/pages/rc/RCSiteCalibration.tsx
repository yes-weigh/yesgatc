import React, { useState, useEffect, useCallback, useMemo, useRef, startTransition } from 'react';
import { createPortal } from 'react-dom';
import {
  collection, getDocs, doc, setDoc, deleteDoc, updateDoc, query, where, getDoc,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useConfirm } from '../../context/ConfirmContext';
import { useAuth } from '../../context/AuthContext';
import { useRcScope } from '../../lib/roleScope';
import { resolveVerificationDraftActorMeta } from '../../lib/verificationRequest';
import { InlineFormPanel } from '../../components/InlineFormPanel';
import { VerificationListTable } from '../../components/VerificationListTable';
import { VerificationSerialGroupView } from '../../components/VerificationSerialGroupView';
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
  canShowVerificationCertifiedActions,
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
import { enrichVerificationListRecords } from '../../lib/verificationListPartyPhoto';
import type { VerificationFormStepContext, VerificationFormStepId } from '../../lib/verificationFormSteps';
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
  Pencil, Plus, Save, Send, Eye, X,
} from 'lucide-react';

import {
  VerificationListFilters,
  type VerificationStatusFilter,
} from '../../components/VerificationListFilters';
import { collapseVerificationsForListDisplay } from '../../lib/verificationListGrouping';
import { paginateItems, VERIFICATION_TABLE_PAGE_SIZE } from '../../lib/tablePagination';
import type { Customer, FirestoreUserDoc, SiteCalibration } from '../../types';
import {
  VerificationSessionFields,
  type VerificationSessionFieldsHandle,
} from './VerificationSessionFields';
import { EMPTY_CUSTOMER_FORM } from './CustomerFormFields';
import type { PersistVerificationPartyResult } from '../../lib/verificationPartyPersist';
import { useAppContext } from '../../context/AppContext';
import {
  applyLaboratorySealToDeviceRows,
  resolveLaboratorySealIdentification,
} from '../../lib/rcLaboratoryFields';
import { VerificationSubmitProgressOverlay } from '../../components/VerificationSubmitProgressOverlay';
import { unlockVerificationSuccessAudio } from '../../lib/playVerificationSuccessSound';
import { allocateVerificationApplicationNumbers } from '../../lib/verificationApplicationNumber';
import { verificationRecordsQuery } from '../../lib/verificationRecordsQuery';
import { useHistoryOverlay } from '../../hooks/useHistoryOverlay';
import { useVerificationMobileLayout } from '../../hooks/useVerificationMobileLayout';

export const RCSiteCalibration: React.FC = () => {
  const { rcUid, actorUid, isVct } = useRcScope();
  const { user } = useAuth();
  const { products } = useAppContext();
  const confirm = useConfirm();
  const [records, setRecords] = useState<SiteCalibration[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [lastViewedVerificationId, setLastViewedVerificationId] = useState<string | null>(null);
  const [rowHighlightFlashId, setRowHighlightFlashId] = useState<string | null>(null);
  const [sessionValues, setSessionValues] = useState<VerificationSessionValues>(EMPTY_VERIFICATION_SESSION);
  const [deviceImages, setDeviceImages] = useState<Record<string, DeviceVerificationImagesState>>({});
  const [deviceRvImages, setDeviceRvImages] = useState<Record<string, DeviceRvDocumentsState>>({});

  const [submitProgressRecordIds, setSubmitProgressRecordIds] = useState<string[] | null>(null);
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
  const [actorProfile, setActorProfile] = useState<FirestoreUserDoc | null>(null);
  const [wizardOnLastStep, setWizardOnLastStep] = useState(false);
  const [verificationDeclarationAccepted, setVerificationDeclarationAccepted] = useState(false);
  const verificationFieldsRef = useRef<VerificationSessionFieldsHandle>(null);
  const [partyContext, setPartyContext] = useState<VerificationFormStepContext>({
    customerForm: EMPTY_CUSTOMER_FORM,
  });

  const validationOptions = useMemo(
    () => ({ customerForm: partyContext.customerForm }),
    [partyContext.customerForm],
  );

  const verificationDraftActor = useMemo(
    () =>
      resolveVerificationDraftActorMeta({
        isVct,
        actorUid,
        actorUsername: actorProfile?.username ?? user?.username,
        actorWorkflowMode: actorProfile?.workflowMode,
      }),
    [isVct, actorUid, actorProfile?.username, actorProfile?.workflowMode, user?.username],
  );

  const handlePartyContextChange = useCallback((context: VerificationFormStepContext) => {
    startTransition(() => setPartyContext(context));
  }, []);

  const handleWizardStepChange = useCallback((_stepId: VerificationFormStepId, isLastStep: boolean) => {
    startTransition(() => setWizardOnLastStep(isLastStep));
  }, []);

  const beginSubmitProgress = useCallback((recordIds: string[]) => {
    if (!recordIds.length) return;
    unlockVerificationSuccessAudio();
    setSubmitProgressRecordIds(recordIds);
  }, []);

  const fetchLaboratorySeal = useCallback(async () => {
    if (!rcUid) return;
    try {
      const snap = await getDoc(doc(db, 'users', rcUid));
      const docData = snap.exists() ? (snap.data() as FirestoreUserDoc) : null;
      setRcProfile(docData);
      setLaboratorySealId(resolveLaboratorySealIdentification(docData));
    } catch {
      setRcProfile(null);
      setLaboratorySealId(resolveLaboratorySealIdentification(null));
    }
  }, [rcUid]);

  const fetchRecords = useCallback(async () => {
    if (!rcUid) return;
    setLoading(true);
    setListError('');
    try {
      const q = verificationRecordsQuery(db, rcUid, { isVct, actorUid });
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
  }, [rcUid, isVct, actorUid]);

  const fetchCustomers = useCallback(async () => {
    if (!rcUid) return;
    try {
      const q = query(collection(db, 'customers'), where('rcId', '==', rcUid));
      const snap = await getDocs(q);
      const rows = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as Omit<Customer, 'id'>) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setCustomers(rows);
    } catch {
      setCustomers([]);
    }
  }, [rcUid]);

  useEffect(() => {
    if (!isVct || !actorUid) {
      setActorProfile(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', actorUid));
        if (!cancelled) {
          setActorProfile(snap.exists() ? (snap.data() as FirestoreUserDoc) : null);
        }
      } catch {
        if (!cancelled) setActorProfile(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isVct, actorUid]);

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
    if (!showForm || !rcUid) return;
    void fetchLaboratorySeal();
  }, [showForm, rcUid, fetchLaboratorySeal]);

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
    setPartyContext({ customerForm: EMPTY_CUSTOMER_FORM });
    setError('');
  };

  const handleCloseForm = () => {
    if (formBusy) return;
    if (editingId) {
      setLastViewedVerificationId(editingId);
      setRowHighlightFlashId(editingId);
    }
    setVerificationDeclarationAccepted(false);
    setShowAddForm(false);
    setEditingId(null);
    setWizardOnLastStep(false);
    resetForm();
  };

  const formBusyRef = useRef(formBusy);
  formBusyRef.current = formBusy;

  const handleFormHistoryBack = useCallback(() => {
    if (formBusyRef.current) return;
    if (verificationFieldsRef.current?.tryHistoryBack()) return;
    handleCloseForm();
  }, []);

  useHistoryOverlay(showForm, handleFormHistoryBack);

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

  const applyPartyPersistResult = useCallback(
    async (
      result: PersistVerificationPartyResult | undefined,
      currentSession: VerificationSessionValues,
    ): Promise<{
      ok: boolean;
      sessionPatch: Partial<VerificationSessionValues>;
      customer?: Customer;
    }> => {
      if (!result) return { ok: true, sessionPatch: {} };
      if (result.error) {
        setError(result.error);
        return { ok: false, sessionPatch: {} };
      }

      const customer = result.createdCustomer ?? result.updatedCustomer;
      if (result.createdCustomer) {
        setCustomers(prev =>
          [...prev, result.createdCustomer!].sort((a, b) => a.name.localeCompare(b.name)),
        );
      } else if (result.updatedCustomer) {
        handleCustomerUpdated(result.updatedCustomer);
      }

      const sessionPatch: Partial<VerificationSessionValues> = {};
      if (customer) {
        if (customer.id !== currentSession.customerId) {
          sessionPatch.customerId = customer.id;
        }
        sessionPatch.customerName = customer.name;
      }

      if (Object.keys(sessionPatch).length > 0) {
        setSessionValues(prev => ({ ...prev, ...sessionPatch }));
      }

      if (result.rcProfileSaved) {
        await fetchLaboratorySeal();
      }

      return { ok: true, sessionPatch, customer };
    },
    [fetchLaboratorySeal],
  );

  const persistPartyBeforeSave = useCallback(
    async (currentSession: VerificationSessionValues) => {
      const result = await verificationFieldsRef.current?.persistPartyChanges();
      return applyPartyPersistResult(result, currentSession);
    },
    [applyPartyPersistResult],
  );

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
    setDeviceImages(prev => {
      const prevUrl = prev[localId]?.[kind]?.file?.url;
      if (prevUrl?.startsWith('blob:')) URL.revokeObjectURL(prevUrl);
      const previewUrl = URL.createObjectURL(file);
      return {
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
      };
    });
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

  const syncCustomerDevices = async (
    rows: VerificationDeviceRowValues[],
    customerId: string,
    customerOverride?: Customer,
  ) => {
    if (sessionValues.verificationSubject === 'self') return;
    const customer = customerOverride ?? customers.find(c => c.id === customerId);
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
    await updateDoc(doc(db, 'customers', customerId), {
      devices,
      updatedAt,
    });

    setCustomers(prev =>
      prev.map(c =>
        c.id === customerId ? { ...c, devices, updatedAt } : c,
      ),
    );
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isViewMode) return;
    if (showAddForm && !wizardOnLastStep) return;
    if (showAddForm) await handleCreate();
    else if (editingId) await handleSaveEdit(editingId);
  };

  const formatSaveError = (err: unknown, fallback: string): string => {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code: string }).code)
        : '';
    if (code === 'permission-denied') {
      if (isVct) {
        return 'Permission denied. Ensure your technician account is approved and linked to your RC centre, then try again.';
      }
      return 'Missing or insufficient permissions. Deploy Firestore rules: firebase deploy --only firestore:rules';
    }
    return err instanceof Error ? err.message : fallback;
  };

  const handleCreate = async (submitAfterSave = false) => {
    setError('');
    const validationError = validateVerificationDraft(
      sessionValues,
      deviceImages,
      deviceRvImages,
      validationOptions,
    );
    if (validationError) {
      setError(validationError);
      return;
    }

    if (submitAfterSave) {
      const submitError = validateVerificationForSubmit(
        sessionValues,
        deviceImages,
        deviceRvImages,
        validationOptions,
      );
      if (submitError) {
        setError(submitError);
        return;
      }
    }

    const includedRows = sessionValues.devices.filter(row => row.included);
    setSubmitting(true);
    try {
      const applied = await persistPartyBeforeSave(sessionValues);
      if (!applied.ok) return;

      const sessionForSave = { ...sessionValues, ...applied.sessionPatch };
      const rowsToSync = includedRows.filter(
        row => row.productId.trim() && row.serialNumber.trim(),
      );
      await syncCustomerDevices(rowsToSync, sessionForSave.customerId, applied.customer);

      const submittedRecordIds: string[] = [];
      const applicationNumbers = await allocateVerificationApplicationNumbers(db, includedRows.length);

      for (let rowIndex = 0; rowIndex < includedRows.length; rowIndex += 1) {
        const row = includedRows[rowIndex];
        const ref = doc(collection(db, 'siteCalibrations'));
        const recordId = ref.id;
        const imageFields = await uploadRowImages(recordId, row.localId, sessionForSave.verificationType === 'RV');
        const deviceId = row.isNewDevice ? row.localId : row.deviceId;
        const product = products.find(p => p.id === row.productId) ?? null;

        const record: Omit<SiteCalibration, 'id'> = {
          rcId: rcUid!,
          createdAt: new Date().toISOString(),
          createdByUid: actorUid ?? undefined,
          applicationNumber: applicationNumbers[rowIndex],
          ...buildNewSiteCalibrationRecord(
            sessionForSave,
            { ...row, deviceId },
            product,
            verificationDraftActor,
          ),
          ...imageFields,
        };
        await setDoc(ref, record);
        if (submitAfterSave) {
          await updateDoc(ref, buildVerificationSubmitPatch());
          submittedRecordIds.push(recordId);
        }
      }

      handleCloseForm();
      await fetchRecords();
      if (submitAfterSave) {
        beginSubmitProgress(submittedRecordIds);
      }
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

    const validationError = validateVerificationDraft(
      sessionValues,
      deviceImages,
      deviceRvImages,
      validationOptions,
    );
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
      const applied = await persistPartyBeforeSave(sessionValues);
      if (!applied.ok) return;

      const sessionForSave = { ...sessionValues, ...applied.sessionPatch };

      if (row.productId.trim() && row.serialNumber.trim()) {
        await syncCustomerDevices([row], sessionForSave.customerId, applied.customer);
      }
      const product = products.find(p => p.id === row.productId) ?? null;
      const imageFields = await uploadRowImages(recordId, row.localId, sessionForSave.verificationType === 'RV');
      await updateDoc(doc(db, 'siteCalibrations', recordId), {
        ...buildSiteCalibrationFromRow(sessionForSave, row, { product }),
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

    unlockVerificationSuccessAudio();
    setSubmitting(true);
    setListError('');
    try {
      await updateDoc(doc(db, 'siteCalibrations', record.id), buildVerificationSubmitPatch());
      if (editingId === record.id) handleCloseForm();
      await fetchRecords();
      beginSubmitProgress([record.id]);
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

    unlockVerificationSuccessAudio();
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
      beginSubmitProgress(selectedRecords.map(record => record.id));
    } catch (err: unknown) {
      setListError(formatSaveError(err, 'Failed to submit selected verifications.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitFromForm = async () => {
    const validationError = validateVerificationForSubmit(
      sessionValues,
      deviceImages,
      deviceRvImages,
      validationOptions,
    );
    if (validationError) {
      setError(validationError);
      return;
    }

    if (showAddForm) {
      unlockVerificationSuccessAudio();
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

    unlockVerificationSuccessAudio();
    setSubmitting(true);
    setError('');
    try {
      const applied = await persistPartyBeforeSave(sessionValues);
      if (!applied.ok) return;

      const sessionForSave = { ...sessionValues, ...applied.sessionPatch };

      if (row.productId.trim() && row.serialNumber.trim()) {
        await syncCustomerDevices([row], sessionForSave.customerId, applied.customer);
      }
      const product = products.find(p => p.id === row.productId) ?? null;
      const imageFields = await uploadRowImages(editingId, row.localId, sessionForSave.verificationType === 'RV');
      await updateDoc(doc(db, 'siteCalibrations', editingId), {
        ...buildSiteCalibrationFromRow(sessionForSave, row, { product }),
        ...imageFields,
        ...buildVerificationSubmitPatch(),
      });
      handleCloseForm();
      await fetchRecords();
      beginSubmitProgress([editingId]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to submit verification.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartAdd = () => {
    setEditingId(null);
    setError('');
    if (rcUid && rcProfile) {
      const session = buildSelfVerificationSession(rcProfile, rcUid, laboratorySealId);
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
    setLastViewedVerificationId(record.id);
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
  const saveDraftLabel =
    showAddForm && includedDeviceCount > 1
      ? `Save ${includedDeviceCount} drafts`
      : 'Save draft';
  const submitLabel =
    showAddForm && includedDeviceCount > 1
      ? `Submit ${includedDeviceCount} for certification`
      : 'Submit for certification';
  const editingRecord = editingId ? records.find(r => r.id === editingId) ?? null : null;
  const editingDraft = editingRecord ? isVerificationEditable(editingRecord) : showAddForm;
  const isViewMode = Boolean(editingRecord && !editingDraft);
  const isCertifiedActionsView =
    isViewMode && editingRecord !== null && canShowVerificationCertifiedActions(editingRecord);
  const viewingStatus = editingRecord ? normalizeVerificationStatus(editingRecord) : null;
  const canSaveDraftFromFooter =
    !isViewMode && !isCertifiedActionsView && (!showAddForm || wizardOnLastStep);
  const showFormFooter = isCertifiedActionsView || isViewMode || !showAddForm || wizardOnLastStep;
  const mobileFloatingChrome = useVerificationMobileLayout(showAddForm);

  const draftBlockReason = useMemo(
    () =>
      showForm
        ? validateVerificationDraft(sessionValues, deviceImages, deviceRvImages, validationOptions)
        : null,
    [showForm, sessionValues, deviceImages, deviceRvImages, validationOptions],
  );

  const submitBlockReason = useMemo(() => {
    if (!showForm) return null;
    const validationError = validateVerificationForSubmit(
      sessionValues,
      deviceImages,
      deviceRvImages,
      validationOptions,
    );
    if (validationError) return validationError;
    if (showAddForm && wizardOnLastStep && !verificationDeclarationAccepted) {
      return 'Accept the declaration before submitting for certification.';
    }
    return null;
  }, [
    showForm,
    sessionValues,
    deviceImages,
    deviceRvImages,
    validationOptions,
    showAddForm,
    wizardOnLastStep,
    verificationDeclarationAccepted,
  ]);

  const canSubmitFromForm = !submitBlockReason;

  const filteredRecords = useMemo(() => {
    const filtered = records.filter(record => {
      if (!matchesVerificationSearch(record, searchTerm)) return false;
      return matchesVerificationStatusFilter(record, statusFilter);
    });
    return collapseVerificationsForListDisplay(filtered, records);
  }, [records, statusFilter, searchTerm]);

  const paginatedRecords = useMemo(
    () => paginateItems(filteredRecords, page, VERIFICATION_TABLE_PAGE_SIZE),
    [filteredRecords, page],
  );

  const customersById = useMemo(
    () => new Map(customers.map(customer => [customer.id, customer])),
    [customers],
  );

  const paginatedRecordsWithPhotos = useMemo(
    () =>
      enrichVerificationListRecords(paginatedRecords, {
        rcProfile,
        customersById,
      }),
    [paginatedRecords, rcProfile, customersById],
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
    if (showForm || !rowHighlightFlashId) return;

    const scrollTarget = document.querySelector(
      `[data-verification-row-id="${rowHighlightFlashId}"]`,
    );
    scrollTarget?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    const timer = window.setTimeout(() => setRowHighlightFlashId(null), 1400);
    return () => clearTimeout(timer);
  }, [showForm, rowHighlightFlashId]);

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

  const verificationFormFooter = showFormFooter ? (
    <div
      className={`product-form-footer verification-form-footer${
        isCertifiedActionsView ? ' verification-form-footer--certified-summary' : ''
      }`}
    >
      {!isCertifiedActionsView && !isViewMode && canSaveDraftFromFooter && draftBlockReason && (
        <p className="verification-form-footer-hint mb-0" role="status">
          {draftBlockReason}
        </p>
      )}

      <div className="verification-form-footer-row verification-form-footer-row--actions">
        <button
          type="button"
          className="verification-form-btn verification-form-btn--cancel"
          onClick={handleCloseForm}
          disabled={formBusy}
        >
          {!isViewMode && !isCertifiedActionsView && <X size={16} aria-hidden />}
          {isViewMode || isCertifiedActionsView ? 'Close' : 'Cancel'}
        </button>

        {canSaveDraftFromFooter && (
          <button
            type="submit"
            className="verification-form-btn verification-form-btn--save"
            disabled={formBusy || Boolean(draftBlockReason)}
            title={draftBlockReason ?? undefined}
          >
            {formBusy ? (
              <span className="spinner-inline" aria-hidden />
            ) : (
              <Save size={16} aria-hidden />
            )}
            <span>{saveDraftLabel}</span>
          </button>
        )}
      </div>

      {!isViewMode && wizardOnLastStep && editingDraft && (
        <>
          <div className="verification-form-footer-row verification-form-footer-row--submit">
            <button
              type="button"
              className="verification-form-btn verification-form-btn--submit"
              onClick={() => void handleSubmitFromForm()}
              disabled={formBusy || !canSubmitFromForm}
              title={submitBlockReason ?? undefined}
            >
              {formBusy ? (
                <span className="spinner-inline" aria-hidden />
              ) : (
                <Send size={16} aria-hidden />
              )}
              <span>{submitLabel}</span>
            </button>
          </div>
          {submitBlockReason && (
            <p className="verification-form-submit-reason mb-0" role="status">
              {submitBlockReason}
            </p>
          )}
        </>
      )}
    </div>
  ) : null;

  return (
    <div className="fade-in page-content">
      {showForm && (
        <InlineFormPanel
          id="site-calibration-form"
          plain={showAddForm || isCertifiedActionsView}
          className={`mb-6 inline-form-panel--wide inline-form-panel--calibration${
            isCertifiedActionsView ? ' inline-form-panel--certified-summary' : ''
          }`}
        >
          <div className="product-form-panel">
            {isCertifiedActionsView && editingRecord ? (
              <VerificationSerialGroupView
                record={editingRecord}
                allRecords={records}
                customerPhone={
                  editingRecord.customerId
                    ? customers.find(c => c.id === editingRecord.customerId)?.phone
                    : undefined
                }
                onClose={handleCloseForm}
                closeDisabled={formBusy}
                onResubmitted={async () => {
                  await fetchRecords();
                }}
              />
            ) : (
              <>
                <div className={`product-form-topbar${showAddForm ? ' product-form-topbar--new-mobile' : ''}`}>
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
                    <p className="product-form-topbar-hint text-muted text-sm mt-1 mb-0">
                      {showAddForm
                        ? 'Complete each step — save or submit on the Evidence step.'
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
                        {editingRecord.applicationNumber?.trim() && (
                          <span className="text-mono text-xs">
                            App {editingRecord.applicationNumber.trim()}
                          </span>
                        )}
                        {editingRecord.certificateNumber?.trim() && (
                          <span className="text-mono text-xs">
                            Cert {editingRecord.certificateNumber.trim()}
                          </span>
                        )}
                      </div>
                    )}
                    <p className="rc-form-topbar-error" role={error ? 'alert' : undefined}>
                      {error || '\u00a0'}
                    </p>
                  </div>
                </div>

                <form
                  onSubmit={handleFormSubmit}
                  className={`product-form${showAddForm ? ' product-form--verification-wizard' : ''}${showAddForm && wizardOnLastStep ? ' product-form--verification-final-step' : ''}${mobileFloatingChrome && showFormFooter ? ' product-form--verification-footer-portaled' : ''}`}
                  autoComplete="off"
                  noValidate
                >
                  <div className="product-form-body">
                    <VerificationSessionFields
                      ref={verificationFieldsRef}
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
                      rcUid={rcUid ?? undefined}
                      actorUid={actorUid ?? undefined}
                      submitting={formBusy}
                      lockCustomer={isEditMode}
                      readOnly={isViewMode}
                      laboratorySealIdentification={laboratorySealId}
                      onWizardStepChange={handleWizardStepChange}
                      onDeclarationAcceptedChange={setVerificationDeclarationAccepted}
                      onPartyContextChange={handlePartyContextChange}
                      onCancel={handleCloseForm}
                      wizardNavIncludesCancel={showAddForm}
                      mobileFloatingChrome={mobileFloatingChrome}
                    />
                  </div>
                  {mobileFloatingChrome && verificationFormFooter
                    ? createPortal(
                        <div className="verification-mobile-chrome verification-mobile-chrome--footer">
                          {verificationFormFooter}
                        </div>,
                        document.body,
                      )
                    : verificationFormFooter}
                </form>
              </>
            )}
          </div>
        </InlineFormPanel>
      )}

      {!showForm && (
        <div className="verification-list-page fade-in">
          {listError && (
            <p className="verification-list-error rc-form-topbar-error text-sm" role="alert">
              {listError}
            </p>
          )}
          <VerificationListFilters
            searchTerm={searchTerm}
            onSearchTermChange={setSearchTerm}
            searchPlaceholder="Search verification…"
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            statusOptions={statusFilterOptions}
            onNewClick={handleStartAdd}
            onRefresh={() => void fetchRecords()}
            refreshing={loading}
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
                hideVctColumn={isVct}
                records={paginatedRecordsWithPhotos}
                rowOffset={rowOffset}
                formatDate={formatDate}
                emptyMessage={
                  records.length === 0
                    ? 'No verification records yet. Click "New" to add a draft.'
                    : `No ${statusFilter === 'all' ? '' : `${verificationFilterLabel(statusFilter).toLowerCase()} `}verifications.`
                }
                onView={openRecord}
                lastViewedRecordId={lastViewedVerificationId}
                flashRecordId={rowHighlightFlashId}
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
      )}

      {submitProgressRecordIds && submitProgressRecordIds.length > 0 && (
        <VerificationSubmitProgressOverlay
          recordIds={submitProgressRecordIds}
          onClose={() => setSubmitProgressRecordIds(null)}
        />
      )}
    </div>
  );
};
