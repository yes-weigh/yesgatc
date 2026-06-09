import React, { useState, useEffect, useCallback, useMemo, useRef, startTransition } from 'react';
import { useSearchParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
  collection, getDocs, doc, setDoc, deleteDoc, updateDoc, query, where, getDoc, deleteField,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useConfirm } from '../../context/ConfirmContext';
import { useAuth } from '../../context/AuthContext';
import { useRcScope } from '../../lib/roleScope';
import { InlineFormPanel } from '../../components/InlineFormPanel';
import { VerificationListTable } from '../../components/VerificationListTable';
import { VerificationSerialGroupView } from '../../components/VerificationSerialGroupView';
import { VerificationStatusBadge } from '../../components/VerificationStatusBadge';
import { ListViewBackBar } from '../../components/ListViewBackBar';
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
  buildVerificationDraftMeta,
  buildVerificationStatusFilterOptions,
  buildVerificationTypeFilterOptions,
  canDeleteVerification,
  canShowVerificationCertifiedActions,
  canSubmitVerification,
  isCorruptedVerificationRecord,
  isVerificationEditable,
  isVerificationViewable,
  matchesVerificationTypeFilter,
  normalizeVerificationStatus,
  resolveVerificationDraftActorForSession,
  shouldClearVerificationVctFields,
  tallyVerificationStatusFilters,
  tallyVerificationTypeFilters,
  verificationFilterLabel,
  verificationPerformerCreatedByUid,
  verificationStatusDescription,
  type AssignableVctOption,
} from '../../lib/verificationRequest';
import { fetchRcVctUsers } from '../../lib/rcVctMembers';
import { matchesVerificationSearch } from '../../lib/verificationListSearch';
import { formatVerificationListDate } from '../../lib/verificationListFormat';
import { enrichVerificationListRecords } from '../../lib/verificationListPartyPhoto';
import type { VerificationFormStepContext, VerificationFormStepId } from '../../lib/verificationFormSteps';
import { uploadSiteCalibrationDeviceImage } from '../../lib/siteCalibrationPhotoUpload';
import {
  emptyDeviceImageSlot,
  emptyDeviceVerificationImagesState,
  imageFieldsFromMeta,
  ALL_STORED_VERIFICATION_IMAGE_KINDS,
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
  type VerificationTypeFilter,
} from '../../components/VerificationListFilters';
import {
  buildDuplicatePrimaryIdSet,
  buildVerificationListDisplay,
  countVerificationDuplicates,
  matchesVerificationListStatusFilter,
  verificationListRecordsForFilterCounts,
} from '../../lib/verificationListGrouping';
import {
  submitVerificationRecord,
  submitVerificationRecords,
  type VerificationSubmitOptions,
} from '../../lib/verificationSubmit';
import { paginateItems, VERIFICATION_TABLE_PAGE_SIZE } from '../../lib/tablePagination';
import type {
  Customer,
  FirestoreUserDoc,
  JobType,
  Product,
  RcFeesStructure,
  SiteCalibration,
  VerificationLocation,
} from '../../types';
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
import { RvOutstandingWalletPaymentBanner } from '../../components/RvOutstandingWalletPaymentBanner';
import { RvZohoSubmitGateBanner } from '../../components/RvZohoSubmitGateBanner';
import { formatZohoInvoiceGateError, isZohoInvoiceGateError } from '../../lib/zohoRvInvoice';
import { RvSubmitTestRevertSection } from '../../components/RvSubmitTestRevertSection';
import { RvLegacyZohoInvoiceSection } from '../../components/RvLegacyZohoInvoiceSection';
import { RvLegacyZohoSettlementSection } from '../../components/RvLegacyZohoSettlementSection';
import { RvWalletPaymentPanel } from '../../components/RvWalletPaymentPanel';
import { useAppSettings } from '../../hooks/useAppSettings';
import { isRvPaymentRequired } from '../../lib/appSettings';
import {
  buildRvPaymentFirestorePatch,
  computeRvPaymentAmount,
  isRvPaymentSatisfied,
  isRvSessionPaymentSatisfied,
  isRvWalletPaymentOutstanding,
} from '../../lib/rvPaymentAmount';
import {
  isWalletPaymentId,
  linkWalletPaymentToRecords,
  refundRvWalletPayment,
} from '../../lib/rcWallet';
import {
  isRvZohoSubmitGateRetry,
  isZohoRvInvoicingEnabled,
  rcZohoIdReady,
  RV_ZOHO_SUBMIT_BLOCK_MESSAGE,
  verificationZohoInvoiceNumber,
} from '../../lib/zohoRvSubmit';
import { unlockVerificationSuccessAudio } from '../../lib/playVerificationSuccessSound';
import { allocateVerificationApplicationNumbers } from '../../lib/verificationApplicationNumber';
import {
  computeVerificationDocaCharges,
  shouldPersistVerificationDocaCharges,
} from '../../lib/verificationDocaCharges';
import { resolveRcFeesStructure } from '../../lib/rcProfileFields';
import { verificationRecordsQuery } from '../../lib/verificationRecordsQuery';
import { buildCustomerVerificationSession } from '../../lib/verificationCustomerEntry';
import { useHistoryOverlay } from '../../hooks/useHistoryOverlay';
import { useVerificationMobileLayout } from '../../hooks/useVerificationMobileLayout';

function verificationDocaFirestorePatch(
  fees: RcFeesStructure,
  verificationType: JobType | '',
  verificationLocation: VerificationLocation | '',
  verificationSubject: 'self' | 'customer' | '',
  product: Pick<Product, 'maximumCapacity' | 'unitOfMeasurement'> | null | undefined,
): Record<string, unknown> {
  if (!shouldPersistVerificationDocaCharges(verificationType)) {
    return {
      verificationFeeBase: deleteField(),
      verificationFeeGst: deleteField(),
      verificationFeeTotal: deleteField(),
      serviceFee: deleteField(),
      additionalFee: deleteField(),
      carriageConveyanceFee: deleteField(),
      totalDeposited: deleteField(),
    };
  }

  const charges = computeVerificationDocaCharges(
    fees,
    verificationType,
    verificationLocation,
    verificationSubject,
    product,
  );
  return charges ?? {};
}

export const RCSiteCalibration: React.FC = () => {
  const { rcUid, actorUid, isVct } = useRcScope();
  const { user } = useAuth();
  const { products } = useAppContext();
  const { appSettings } = useAppSettings();
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
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
  const [rvPaymentOpen, setRvPaymentOpen] = useState(false);
  const [rvSessionPayment, setRvSessionPayment] = useState<{ paymentId: string; amountInr: number } | null>(null);
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');
  const [statusFilter, setStatusFilter] = useState<VerificationStatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState<VerificationTypeFilter>('all');
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
  const [assignableVcts, setAssignableVcts] = useState<AssignableVctOption[]>([]);

  const validationOptions = useMemo(
    () => ({
      customerForm: partyContext.customerForm,
      rcZohoId: rcProfile?.zohoId,
      zohoRvInvoicingEnabled: isZohoRvInvoicingEnabled(appSettings),
    }),
    [partyContext.customerForm, rcProfile?.zohoId, appSettings],
  );

  const submitOptions = useMemo<VerificationSubmitOptions>(
    () => ({ zohoRvInvoicingEnabled: isZohoRvInvoicingEnabled(appSettings) }),
    [appSettings],
  );

  const rvZohoSubmitBlocked =
    sessionValues.verificationType === 'RV'
    && isZohoRvInvoicingEnabled(appSettings)
    && !rcZohoIdReady(rcProfile?.zohoId);

  const verificationDraftActor = useMemo(
    () =>
      resolveVerificationDraftActorForSession(sessionValues.assignedVctId, {
        isVct,
        actorUid,
        actorUsername: actorProfile?.username ?? user?.username,
        actorWorkflowMode: actorProfile?.workflowMode,
        assignableVcts,
      }),
    [
      sessionValues.assignedVctId,
      isVct,
      actorUid,
      actorProfile?.username,
      actorProfile?.workflowMode,
      user?.username,
      assignableVcts,
    ],
  );

  const buildPerformerPatch = useCallback(
    (session: VerificationSessionValues, previousRecord?: SiteCalibration | null) => {
      const actor = resolveVerificationDraftActorForSession(session.assignedVctId, {
        isVct,
        actorUid,
        actorUsername: actorProfile?.username ?? user?.username,
        actorWorkflowMode: actorProfile?.workflowMode,
        assignableVcts,
      });
      const patch: Record<string, unknown> = {
        ...buildVerificationDraftMeta(actor),
        createdByUid: verificationPerformerCreatedByUid(actor, actorUid),
      };
      if (shouldClearVerificationVctFields(actor, previousRecord)) {
        patch.vctId = deleteField();
        patch.vctName = deleteField();
      }
      return patch;
    },
    [
      isVct,
      actorUid,
      actorProfile?.username,
      actorProfile?.workflowMode,
      user?.username,
      assignableVcts,
    ],
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
    if (!rcUid || isVct) {
      setAssignableVcts([]);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const members = await fetchRcVctUsers(rcUid);
        if (cancelled) return;
        setAssignableVcts(
          members
            .filter(
              member =>
                (member.approvalStatus ?? 'approved') === 'approved' && member.active !== false,
            )
            .map(member => ({
              uid: member.uid,
              username: member.username?.trim() || member.companyName?.trim() || 'VCT',
              workflowMode: member.workflowMode,
            }))
            .sort((a, b) => a.username.localeCompare(b.username)),
        );
      } catch {
        if (!cancelled) setAssignableVcts([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [rcUid, isVct]);

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
    setRvPaymentOpen(false);
    setRvSessionPayment(null);
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
    for (const kind of ALL_STORED_VERIFICATION_IMAGE_KINDS) {
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

  const formatSaveError = (err: unknown, fallback: string, record?: SiteCalibration): string => {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code: string }).code)
        : '';
    if (code === 'permission-denied') {
      if (record && isCorruptedVerificationRecord(record) && normalizeVerificationStatus(record) !== 'draft') {
        return 'This verification was already submitted but its status was damaged by a server bug. It cannot be resubmitted from the app — contact super admin to repair it from Automation Worker → Pipeline recovery.';
      }
      if (isVct) {
        return 'Permission denied. Ensure your technician account is approved and linked to your RC centre, then try again.';
      }
      return 'Missing or insufficient permissions. Deploy Firestore rules: firebase deploy --only firestore:rules';
    }
    return err instanceof Error ? err.message : fallback;
  };

  const rvPaymentBreakdown = useMemo(
    () =>
      computeRvPaymentAmount(
        sessionValues.devices,
        products,
        resolveRcFeesStructure(rcProfile),
        sessionValues.verificationLocation,
        sessionValues.verificationSubject,
        sessionValues.verificationType,
      ),
    [sessionValues, products, rcProfile],
  );

  const handleCreate = async (
    submitAfterSave = false,
    rvPayment?: { paymentId: string; amountInr: number },
  ) => {
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
    const walletPaymentId =
      submitAfterSave && rvPayment && isWalletPaymentId(rvPayment.paymentId)
        ? rvPayment.paymentId
        : null;

    const refundWalletPaymentIfNeeded = async (reason: string) => {
      if (!walletPaymentId) return true;
      try {
        await refundRvWalletPayment({ paymentId: walletPaymentId, reason });
        setRvSessionPayment(null);
        return true;
      } catch {
        return false;
      }
    };

    const draftRecordIds: string[] = [];
    setSubmitting(true);
    try {
      const applied = await persistPartyBeforeSave(sessionValues);
      if (!applied.ok) {
        if (walletPaymentId) {
          const refunded = await refundWalletPaymentIfNeeded(
            'Verification submit failed after wallet payment',
          );
          if (!refunded) {
            setError(
              `Could not save customer details. Wallet refund failed — contact support with payment id ${walletPaymentId}.`,
            );
          }
        }
        return;
      }

      const sessionForSave = { ...sessionValues, ...applied.sessionPatch };
      const rowsToSync = includedRows.filter(
        row => row.productId.trim() && row.serialNumber.trim(),
      );
      await syncCustomerDevices(rowsToSync, sessionForSave.customerId, applied.customer);
      const applicationNumbers = await allocateVerificationApplicationNumbers(db, includedRows.length);

      const rvPaymentPatch =
        sessionForSave.verificationType === 'RV' && rvPayment
          ? buildRvPaymentFirestorePatch(rvPayment.paymentId, rvPayment.amountInr)
          : sessionForSave.verificationType === 'RV'
            ? { rvPaymentStatus: 'pending' as const }
            : { rvPaymentStatus: 'not_required' as const };

      for (let rowIndex = 0; rowIndex < includedRows.length; rowIndex += 1) {
        const row = includedRows[rowIndex];
        const ref = doc(collection(db, 'siteCalibrations'));
        const recordId = ref.id;
        const imageFields = await uploadRowImages(recordId, row.localId, sessionForSave.verificationType === 'RV');
        const deviceId = row.isNewDevice ? row.localId : row.deviceId;
        const product = products.find(p => p.id === row.productId) ?? null;
        const docaCharges = computeVerificationDocaCharges(
          resolveRcFeesStructure(rcProfile),
          sessionForSave.verificationType,
          sessionForSave.verificationLocation,
          sessionForSave.verificationSubject,
          product,
        );

        const record: Omit<SiteCalibration, 'id'> = {
          rcId: rcUid!,
          createdAt: new Date().toISOString(),
          createdByUid: verificationPerformerCreatedByUid(verificationDraftActor, actorUid),
          applicationNumber: applicationNumbers[rowIndex],
          ...buildNewSiteCalibrationRecord(
            sessionForSave,
            { ...row, deviceId },
            product,
            verificationDraftActor,
            docaCharges,
          ),
          ...imageFields,
          ...rvPaymentPatch,
        };
        await setDoc(ref, record);
        draftRecordIds.push(recordId);
      }

      if (walletPaymentId && draftRecordIds.length > 0) {
        await linkWalletPaymentToRecords({
          paymentId: walletPaymentId,
          recordIds: draftRecordIds,
        });
      }

      if (submitAfterSave) {
        await submitVerificationRecords(
          draftRecordIds.map(recordId => ({
            id: recordId,
            verificationType: sessionForSave.verificationType,
          })),
          db,
          submitOptions,
        );
      }

      const submittedRecordIds = submitAfterSave ? draftRecordIds : [];

      handleCloseForm();
      await fetchRecords();
      if (submitAfterSave) {
        beginSubmitProgress(submittedRecordIds);
      }
    } catch (err: unknown) {
      if (isZohoInvoiceGateError(err)) {
        await fetchRecords();
        setError(formatZohoInvoiceGateError(err));
        return;
      }
      if (walletPaymentId) {
        const refunded = await refundWalletPaymentIfNeeded(
          'Verification submit failed after wallet payment',
        );
        if (!refunded) {
          setError(
            `${formatSaveError(err, 'Failed to save verification records.')} Wallet refund could not be completed automatically — contact support with payment id ${walletPaymentId}.`,
          );
          return;
        }
      }
      if (draftRecordIds.length > 0) {
        await Promise.all(
          draftRecordIds.map(async recordId => {
            try {
              await deleteDoc(doc(db, 'siteCalibrations', recordId));
            } catch {
              /* best effort */
            }
          }),
        );
      }
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
      const docaPatch = verificationDocaFirestorePatch(
        resolveRcFeesStructure(rcProfile),
        sessionForSave.verificationType,
        sessionForSave.verificationLocation,
        sessionForSave.verificationSubject,
        product,
      );
      const imageFields = await uploadRowImages(recordId, row.localId, sessionForSave.verificationType === 'RV');
      await updateDoc(doc(db, 'siteCalibrations', recordId), {
        ...buildSiteCalibrationFromRow(sessionForSave, row, { product }),
        ...docaPatch,
        ...imageFields,
        ...buildPerformerPatch(sessionForSave, existing),
        updatedAt: new Date().toISOString(),
      });
      handleCloseForm();
      await fetchRecords();
    } catch (err: unknown) {
      setError(formatSaveError(err, 'Failed to update verification record.', existing));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitRecord = async (record: SiteCalibration) => {
    if (!canSubmitVerification(record)) return;

    const validationError = siteCalibrationSubmitBlockReason(record, validationOptions);
    if (validationError) {
      setListError(validationError);
      return;
    }

    unlockVerificationSuccessAudio();
    setSubmitting(true);
    setListError('');
    try {
      await submitVerificationRecord(
        {
          id: record.id,
          verificationType: record.verificationType,
        },
        db,
        submitOptions,
      );
      if (editingId === record.id) handleCloseForm();
      await fetchRecords();
      beginSubmitProgress([record.id]);
    } catch (err: unknown) {
      setListError(
        isZohoInvoiceGateError(err)
          ? formatZohoInvoiceGateError(err)
          : formatSaveError(err, 'Failed to submit verification.', record),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleBulkSubmitRecords = async () => {
    const selectedRecords = filteredRecords.filter(
      r => selectedDraftIds.has(r.id) && isSiteCalibrationSubmittable(r, validationOptions),
    );

    if (selectedRecords.length === 0) {
      setListError('None of the selected drafts are ready to submit. Complete required fields and images first.');
      return;
    }

    unlockVerificationSuccessAudio();
    setSubmitting(true);
    setListError('');
    try {
      await submitVerificationRecords(
        selectedRecords.map(record => ({
          id: record.id,
          verificationType: record.verificationType,
        })),
        db,
        submitOptions,
      );
      setSelectedDraftIds(new Set());
      if (editingId && selectedRecords.some(r => r.id === editingId)) handleCloseForm();
      await fetchRecords();
      beginSubmitProgress(selectedRecords.map(record => record.id));
    } catch (err: unknown) {
      setListError(
        isZohoInvoiceGateError(err)
          ? formatZohoInvoiceGateError(err)
          : formatSaveError(err, 'Failed to submit selected verifications.'),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const executeSubmitFromForm = async (
    rvPayment?: { paymentId: string; amountInr: number },
    options?: { partyPersisted?: boolean },
  ) => {
    if (showAddForm) {
      unlockVerificationSuccessAudio();
      await handleCreate(true, rvPayment);
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

    const walletPaymentId =
      rvPayment && isWalletPaymentId(rvPayment.paymentId) ? rvPayment.paymentId : null;

    const refundWalletPaymentIfNeeded = async (reason: string) => {
      if (!walletPaymentId) return true;
      try {
        await refundRvWalletPayment({ paymentId: walletPaymentId, reason });
        setRvSessionPayment(null);
        return true;
      } catch {
        return false;
      }
    };

    unlockVerificationSuccessAudio();
    setSubmitting(true);
    setError('');
    try {
      let sessionForSave = sessionValues;
      let appliedCustomer: Customer | undefined;

      if (!options?.partyPersisted) {
        const applied = await persistPartyBeforeSave(sessionValues);
        if (!applied.ok) {
          if (walletPaymentId) {
            const refunded = await refundWalletPaymentIfNeeded(
              'Verification submit failed after wallet payment',
            );
            if (!refunded) {
              setError(
                `Could not save customer details. Wallet refund failed — contact support with payment id ${walletPaymentId}.`,
              );
            }
          }
          return;
        }
        sessionForSave = { ...sessionValues, ...applied.sessionPatch };
        appliedCustomer = applied.customer;
      }

      if (row.productId.trim() && row.serialNumber.trim()) {
        await syncCustomerDevices([row], sessionForSave.customerId, appliedCustomer);
      }
      const product = products.find(p => p.id === row.productId) ?? null;
      const docaPatch = verificationDocaFirestorePatch(
        resolveRcFeesStructure(rcProfile),
        sessionForSave.verificationType,
        sessionForSave.verificationLocation,
        sessionForSave.verificationSubject,
        product,
      );
      const imageFields = await uploadRowImages(editingId, row.localId, sessionForSave.verificationType === 'RV');
      const rvPaymentPatch =
        sessionForSave.verificationType === 'RV' && rvPayment
          ? buildRvPaymentFirestorePatch(rvPayment.paymentId, rvPayment.amountInr)
          : {};
      await updateDoc(doc(db, 'siteCalibrations', editingId), {
        ...buildSiteCalibrationFromRow(sessionForSave, row, { product }),
        ...docaPatch,
        ...imageFields,
        ...rvPaymentPatch,
        ...buildPerformerPatch(sessionForSave, existing),
      });

      if (walletPaymentId) {
        await linkWalletPaymentToRecords({
          paymentId: walletPaymentId,
          recordIds: [editingId],
        });
      }

      await submitVerificationRecord(
        {
          id: editingId,
          verificationType: sessionForSave.verificationType,
        },
        db,
        submitOptions,
      );

      handleCloseForm();
      await fetchRecords();
      beginSubmitProgress([editingId]);
    } catch (err: unknown) {
      if (isZohoInvoiceGateError(err)) {
        await fetchRecords();
        setError(formatZohoInvoiceGateError(err));
        return;
      }
      if (walletPaymentId) {
        const refunded = await refundWalletPaymentIfNeeded(
          'Verification submit failed after wallet payment',
        );
        if (!refunded) {
          setError(
            `${formatSaveError(err, 'Failed to submit verification.')} Wallet refund could not be completed automatically — contact support with payment id ${walletPaymentId}.`,
          );
          return;
        }
        try {
          await updateDoc(doc(db, 'siteCalibrations', editingId), {
            rvPaymentStatus: 'pending',
            rvPaymentId: deleteField(),
            rvPaymentAmount: deleteField(),
            rvPaidAt: deleteField(),
          });
        } catch {
          /* best effort */
        }
      }
      setError(formatSaveError(err, 'Failed to submit verification.', editingRecord ?? undefined));
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

    if (showAddForm && wizardOnLastStep && !verificationDeclarationAccepted) {
      setError('Accept the declaration before submitting for certification.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const applied = await persistPartyBeforeSave(sessionValues);
      if (!applied.ok) return;

      const isRv = sessionValues.verificationType === 'RV';
      const rvPaymentRequired = isRvPaymentRequired(sessionValues.verificationType);

      if (isRv && rvPaymentRequired) {
        if (!rvPaymentBreakdown || rvPaymentBreakdown.total <= 0) {
          setError('Could not calculate RV payment amount. Check device fees and try again.');
          return;
        }
        if (!rcUid) {
          setError('RC scope is missing.');
          return;
        }

        const existing = editingId ? records.find(r => r.id === editingId) ?? null : null;

        if (isRvSessionPaymentSatisfied(rvSessionPayment, rvPaymentBreakdown.total)) {
          await executeSubmitFromForm(rvSessionPayment!, { partyPersisted: true });
          return;
        }

        if (isRvPaymentSatisfied(existing, rvPaymentBreakdown.total)) {
          await executeSubmitFromForm(
            existing?.rvPaymentId && existing.rvPaymentAmount != null
              ? { paymentId: existing.rvPaymentId, amountInr: existing.rvPaymentAmount }
              : undefined,
            { partyPersisted: true },
          );
          return;
        }

        setRvPaymentOpen(true);
        return;
      }

      await executeSubmitFromForm(undefined, { partyPersisted: true });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRvPaymentComplete = async (paymentId: string) => {
    if (!rvPaymentBreakdown) return;
    setRvPaymentOpen(false);

    const payment = { paymentId, amountInr: rvPaymentBreakdown.total };
    setRvSessionPayment(payment);
    setError('');
    await executeSubmitFromForm(payment, { partyPersisted: true });
  };

  const openNewVerificationSession = useCallback(
    (session: VerificationSessionValues) => {
      setEditingId(null);
      setError('');
      setRvPaymentOpen(false);
      setRvSessionPayment(null);
      setSessionValues(session);
      const firstDeviceId = session.devices[0]?.localId;
      setDeviceImages(
        firstDeviceId ? { [firstDeviceId]: emptyDeviceVerificationImagesState() } : {},
      );
      setDeviceRvImages(
        firstDeviceId ? { [firstDeviceId]: emptyDeviceRvDocumentsState() } : {},
      );
      setWizardOnLastStep(false);
      setVerificationDeclarationAccepted(false);
      setShowAddForm(true);
    },
    [],
  );

  const handleStartAdd = () => {
    if (rcUid && rcProfile) {
      openNewVerificationSession(
        buildSelfVerificationSession(rcProfile, rcUid, laboratorySealId),
      );
      return;
    }
    setEditingId(null);
    setError('');
    resetForm();
    setShowAddForm(true);
  };

  const pendingCustomerId = searchParams.get('customerId');

  useEffect(() => {
    if (!pendingCustomerId || loading) return;
    const customer = customers.find(c => c.id === pendingCustomerId);
    if (!customer) return;

    const session = buildCustomerVerificationSession(customer, products, laboratorySealId);
    openNewVerificationSession(session);
    setSearchParams({}, { replace: true });
  }, [
    pendingCustomerId,
    loading,
    customers,
    products,
    laboratorySealId,
    openNewVerificationSession,
    setSearchParams,
  ]);

  const openRecord = (record: SiteCalibration) => {
    if (!isVerificationViewable(record)) return;
    setLastViewedVerificationId(record.id);
    setShowAddForm(false);
    setRvPaymentOpen(false);
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
  const rvPaymentRequired = isRvPaymentRequired(sessionValues.verificationType);
  const editingRecord = editingId ? records.find(r => r.id === editingId) ?? null : null;
  const zohoGateRetry = isRvZohoSubmitGateRetry(editingRecord);
  const submitLabel = zohoGateRetry
    ? 'Retry Zoho & submit for certification'
    : rvPaymentRequired
      ? showAddForm && includedDeviceCount > 1
        ? `Pay & submit ${includedDeviceCount} for certification`
        : 'Pay & submit for certification'
      : showAddForm && includedDeviceCount > 1
        ? `Submit ${includedDeviceCount} for certification`
        : 'Submit for certification';
  const editingDraft = editingRecord ? isVerificationEditable(editingRecord) : showAddForm;
  const isViewMode = Boolean(editingRecord && !editingDraft);
  const showRetroactiveRvPayment =
    isViewMode
    && editingRecord
    && isRvWalletPaymentOutstanding(editingRecord)
    && rvPaymentBreakdown != null
    && rvPaymentBreakdown.total > 0;
  const walletPaymentDueRecordIds = useMemo(
    () =>
      new Set(
        records
          .filter(record => isRvWalletPaymentOutstanding(record))
          .map(record => record.id),
      ),
    [records],
  );
  const isCertifiedActionsView =
    isViewMode && editingRecord !== null && canShowVerificationCertifiedActions(editingRecord);
  const viewingStatus = editingRecord ? normalizeVerificationStatus(editingRecord) : null;
  const canSaveDraftFromFooter =
    !isViewMode && !isCertifiedActionsView && (!showAddForm || wizardOnLastStep);
  const showVerificationBackBar = isCertifiedActionsView || isViewMode;
  const showFormFooter =
    !showVerificationBackBar && (!showAddForm || wizardOnLastStep);
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

  const duplicatePrimaryIds = useMemo(() => buildDuplicatePrimaryIdSet(records), [records]);

  const filteredRecords = useMemo(() => {
    const filtered = records.filter(record => {
      if (!matchesVerificationSearch(record, searchTerm)) return false;
      if (!matchesVerificationListStatusFilter(record, statusFilter, duplicatePrimaryIds)) {
        return false;
      }
      return matchesVerificationTypeFilter(record, typeFilter);
    });
    return buildVerificationListDisplay(filtered, records, statusFilter);
  }, [records, statusFilter, typeFilter, searchTerm, duplicatePrimaryIds]);

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

  const listFilters = useMemo(
    () => ({ statusFilter, typeFilter, searchTerm }),
    [statusFilter, typeFilter, searchTerm],
  );
  const recordsForStatusCounts = useMemo(
    () => verificationListRecordsForFilterCounts(records, listFilters, 'status'),
    [records, listFilters],
  );
  const recordsForTypeCounts = useMemo(
    () => verificationListRecordsForFilterCounts(records, listFilters, 'type'),
    [records, listFilters],
  );

  const statusCounts = useMemo(() => {
    const base = tallyVerificationStatusFilters(recordsForStatusCounts);
    return {
      ...base,
      duplicates: countVerificationDuplicates(recordsForStatusCounts, records),
    };
  }, [recordsForStatusCounts, records]);
  const typeCounts = useMemo(
    () => tallyVerificationTypeFilters(recordsForTypeCounts),
    [recordsForTypeCounts],
  );

  const statusFilterOptions = buildVerificationStatusFilterOptions(statusCounts);
  const typeFilterOptions = buildVerificationTypeFilterOptions(typeCounts);

  const draftSubmitMeta = useMemo(() => {
    const meta = new Map<string, { submittable: boolean; blockReason: string | null }>();
    for (const record of filteredRecords) {
      if (normalizeVerificationStatus(record) !== 'draft') continue;
      const blockReason = siteCalibrationSubmitBlockReason(record, validationOptions);
      meta.set(record.id, { submittable: !blockReason, blockReason });
    }
    return meta;
  }, [filteredRecords, validationOptions]);

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
  }, [statusFilter, typeFilter, searchTerm]);

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
                onClose={handleCloseForm}
                closeDisabled={formBusy}
                onResubmitted={async () => {
                  await fetchRecords();
                }}
              />
            ) : (
              <>
                <ListViewBackBar onBack={handleCloseForm} disabled={formBusy} />
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
                        {verificationZohoInvoiceNumber(editingRecord) && (
                          <span className="text-mono text-xs">
                            Zoho {verificationZohoInvoiceNumber(editingRecord)}
                          </span>
                        )}
                        {editingRecord.certificateNumber?.trim() && (
                          <span className="text-mono text-xs">
                            Cert {editingRecord.certificateNumber.trim()}
                          </span>
                        )}
                      </div>
                    )}
                    {showRetroactiveRvPayment && rvPaymentBreakdown && (
                      <RvOutstandingWalletPaymentBanner breakdown={rvPaymentBreakdown} />
                    )}
                    {!isViewMode && editingRecord && isRvZohoSubmitGateRetry(editingRecord) && (
                      <RvZohoSubmitGateBanner record={editingRecord} />
                    )}
                    {isViewMode && editingRecord && (
                      <>
                        <RvLegacyZohoInvoiceSection
                          record={editingRecord}
                          rcCenterName={rcProfile?.companyName || rcProfile?.username}
                          onInvoicePushed={() => void fetchRecords()}
                        />
                        <RvLegacyZohoSettlementSection
                          record={editingRecord}
                          onSettled={() => void fetchRecords()}
                        />
                        <RvSubmitTestRevertSection
                          record={editingRecord}
                          allRecords={records}
                          rcCenterName={rcProfile?.companyName || rcProfile?.username}
                          onReverted={async () => {
                            handleCloseForm();
                            await fetchRecords();
                          }}
                          className="mt-3"
                        />
                      </>
                    )}
                    {rvZohoSubmitBlocked && (
                      <p className="verification-zoho-block-banner text-sm mt-2 mb-0" role="status">
                        {RV_ZOHO_SUBMIT_BLOCK_MESSAGE}
                      </p>
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
                      allowPerformerAssignment={!isVct && !isViewMode}
                      assignableVcts={assignableVcts}
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
            typeFilter={typeFilter}
            onTypeFilterChange={setTypeFilter}
            typeOptions={typeFilterOptions}
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
                walletPaymentDueRecordIds={walletPaymentDueRecordIds}
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

      {rvPaymentRequired && rvPaymentOpen && rvPaymentBreakdown && rcUid && (
        <RvWalletPaymentPanel
          breakdown={rvPaymentBreakdown}
          rcId={rcUid}
          recordIds={editingId ? [editingId] : undefined}
          onPaid={handleRvPaymentComplete}
          onClose={() => setRvPaymentOpen(false)}
          walletOwnerLabel="your"
          paymentContext="submit"
        />
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
