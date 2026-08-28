import React, { useState, useEffect, useCallback, useMemo, useRef, startTransition } from 'react';
import { useSearchParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
  collection, getDocs, doc, setDoc, deleteDoc, updateDoc, query, where, getDoc, deleteField,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useConfirm } from '../../context/ConfirmContext';
import { useAuth } from '../../context/AuthContext';
import { canCreateVerification, useRcScope } from '../../lib/roleScope';
import {
  fetchRcHasStandardWeightsCert,
  rcHasStandardWeightsCert,
  VCT_RC_WEIGHTS_CERT_REQUIRED_MESSAGE,
} from '../../lib/rcActivation';
import { fetchRcVehicles, rcHasRegisteredVehicle, VCT_RC_VEHICLE_REQUIRED_MESSAGE } from '../../lib/rcVehicles';
import { InlineFormPanel } from '../../components/InlineFormPanel';
import { VerificationListStatusDash } from '../../components/VerificationListStatusDash';
import { VerificationListTable } from '../../components/VerificationListTable';
import { VerificationSerialGroupView } from '../../components/VerificationSerialGroupView';
import { VerificationStatusBadge } from '../../components/VerificationStatusBadge';
import { ListViewBackBar } from '../../components/ListViewBackBar';
import { OvSelfSerialMpeBar } from './OvSelfWizardPanels';
import { TablePagination } from '../../components/TablePagination';
import { buildCustomerDevice } from '../../lib/customerProfileFields';
import {
  buildNewSiteCalibrationRecord,
  buildVerificationSessionForKind,
  buildSiteCalibrationFromRow,
  createEmptyVerificationDeviceRow,
  applyLockedSerialToDevices,
  EMPTY_VERIFICATION_SESSION,
  verificationSessionFromRecord,
  validateVerificationDraft,
  validateVerificationForSubmit,
  isSiteCalibrationSubmittable,
  siteCalibrationSubmitBlockReason,
  verificationTypeLabel,
  inferVerificationSubject,
  type VerificationDeviceRowValues,
  type VerificationJobKind,
  type VerificationSessionValues,
} from '../../lib/siteCalibrationProfileFields';
import {
  buildVerificationDraftMeta,
  buildVerificationStatusFilterOptions,
  buildVerificationTypeFilterOptions,
  canDeleteVerification,
  canShowVerificationCertifiedActions,
  canSubmitVerification,
  canRcApproveVerifierVerification,
  buildRcApproveVerifierPatch,
  isCorruptedVerificationRecord,
  isVerificationEditable,
  isVerificationViewable,
  matchesVerificationTypeFilter,
  normalizeVerificationStatus,
  resolveVerificationDraftActorForSession,
  shouldClearVerificationVctFields,
  tallyVerificationTypeFilters,
  tallyVerificationStatusFilters,
  verificationFilterLabel,
  verificationCertificateNumber,
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
  Pencil, Plus, Save, Send, Eye, X, Check,
} from 'lucide-react';

import {
  VerificationListFilters,
  type VerificationStatusFilter,
  type VerificationTypeFilter,
  type VerificationPaymentDueFilter,
} from '../../components/VerificationListFilters';
import {
  matchesSignedPdfFilter,
  tallySignedPdfFilters,
  type VerificationSignedPdfFilter,
} from '../../lib/signedCertificatePdf';
import {
  buildDuplicatePrimaryIdSet,
  buildSerialGroupMap,
  buildVerificationListDisplay,
  matchesVerificationListStatusFilter,
  tallyVerificationStatusFiltersCollapsed,
  verificationListCollapsedForCounts,
} from '../../lib/verificationListGrouping';
import {
  submitVerificationRecord,
  submitVerificationRecords,
  submitVerifierWorkForRcReview,
  type VerificationSubmitOptions,
} from '../../lib/verificationSubmit';
import { paginateItems, VERIFICATION_TABLE_PAGE_SIZE } from '../../lib/tablePagination';
import {
  matchesVerificationDurationFilter,
  parseVerificationDurationParam,
  type VerificationDurationFilter,
} from '../../lib/verificationListDuration';
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
import { VerificationJobKindPicker } from './VerificationJobKindPicker';
import { useRcQuotaSeats } from '../../hooks/useRcQuotaSeats';
import { ovQuotaSeatCap, type OvQuotaGate } from '../../lib/ovQuotaGate';
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
  isRvZohoSubmitGateRetry,
  isZohoRvInvoicingEnabled,
  rcZohoIdReady,
  RV_ZOHO_SUBMIT_BLOCK_MESSAGE,
  validateRvZohoSubmitReady,
  verificationZohoInvoiceNumber,
  type RvWalletFeeSettings,
} from '../../lib/zohoRvSubmit';
import { rcFilingPartyPatch } from '../../lib/keralaRegion';
import {
  buildRvPaymentFirestorePatch,
  computeRvPaymentAmount,
  computeRvPaymentAmountForRow,
  computeRvPaymentBreakdownForRecord,
  isRvPaymentSatisfied,
  isRvSessionPaymentSatisfied,
  isRvWalletPaymentOutstanding,
} from '../../lib/rvPaymentAmount';
import {
  isWalletPaymentId,
  linkWalletPaymentToRecords,
  payRvFromWallet,
  refundRvWalletPayment,
} from '../../lib/rcWallet';
import { ensureRvWalletDebitedForRecords } from '../../lib/rvWalletAdvancePay';
import { unlockVerificationSuccessAudio } from '../../lib/playVerificationSuccessSound';
import { allocateVerificationApplicationNumbers } from '../../lib/verificationApplicationNumber';
import {
  computeVerificationDocaCharges,
  shouldPersistVerificationDocaCharges,
} from '../../lib/verificationDocaCharges';
import { computeStoredGstBill } from '../../lib/rvGstBillRates';
import { resolveRcFeesStructure } from '../../lib/rcProfileFields';
import { verificationRecordsQuery } from '../../lib/verificationRecordsQuery';
import { buildCustomerVerificationSession } from '../../lib/verificationCustomerEntry';
import { useHistoryOverlay } from '../../hooks/useHistoryOverlay';
import { useVerificationMobileLayout } from '../../hooks/useVerificationMobileLayout';
import {
  isVerificationCaptureDevice,
  VERIFICATION_MOBILE_ONLY_NOTICE,
  RC_PROFILE_GPS_REQUIRED_MESSAGE,
  RC_PROFILE_GPS_REQUIRED_RC_HINT,
  RC_PROFILE_GPS_REQUIRED_VCT_HINT,
  verificationRequiresMobileCapture,
  canUseVerificationCapture,
} from '../../lib/verificationDevicePolicy';
import {
  emptyPerformerPhotosState,
  performerPhotoFieldsFromMeta,
  performerPhotosFromRecord,
  PERFORMER_PHOTO_KINDS,
  recordHasPerformerPhotos,
  type PerformerPhotoKind,
  type PerformerPhotosState,
} from '../../lib/verificationPerformerPhotos';

function verificationDocaFirestorePatch(
  fees: RcFeesStructure,
  verificationType: JobType | '',
  verificationLocation: VerificationLocation | '',
  verificationSubject: 'self' | 'customer' | '',
  product: Pick<Product, 'maximumCapacity' | 'unitOfMeasurement'> | null | undefined,
  feeSettings?: RvWalletFeeSettings | null,
  existing?: Pick<
    SiteCalibration,
    | 'maximumCapacity'
    | 'unitOfMeasurement'
    | 'certifiedAt'
    | 'submittedAt'
    | 'approvedAt'
    | 'createdAt'
  > | null,
): Record<string, unknown> {
  if (!shouldPersistVerificationDocaCharges(verificationType)) {
    return {
      verificationFeeBase: deleteField(),
      verificationFeeGst: deleteField(),
      verificationFeeTotal: deleteField(),
      serviceFee: deleteField(),
      additionalFee: deleteField(),
      discountFee: deleteField(),
      carriageConveyanceFee: deleteField(),
      totalDeposited: deleteField(),
      gstBill: deleteField(),
    };
  }

  const charges = computeVerificationDocaCharges(
    fees,
    verificationType,
    verificationLocation,
    verificationSubject,
    product,
    feeSettings,
  );
  const gstBill = computeStoredGstBill({
    maximumCapacity: product?.maximumCapacity ?? existing?.maximumCapacity,
    unitOfMeasurement: product?.unitOfMeasurement ?? existing?.unitOfMeasurement,
    certifiedAt: existing?.certifiedAt,
    submittedAt: existing?.submittedAt,
    approvedAt: existing?.approvedAt,
    createdAt: existing?.createdAt,
  });
  return {
    ...(charges ?? {}),
    ...(gstBill ? { gstBill } : {}),
  };
}

function verificationCreateGateBlockMessage(
  rcHasWeightsCert: boolean | null,
  rcHasVehicle: boolean | null,
  gatesLoading: boolean,
  gatesError: string,
): string | null {
  if (gatesLoading) return 'Checking centre requirements…';
  if (gatesError) return gatesError;
  if (rcHasWeightsCert === false) return VCT_RC_WEIGHTS_CERT_REQUIRED_MESSAGE;
  if (rcHasVehicle === false) return VCT_RC_VEHICLE_REQUIRED_MESSAGE;
  if (rcHasWeightsCert !== true || rcHasVehicle !== true) {
    return 'Could not confirm centre setup. Refresh the page or check Profile and Vehicles.';
  }
  return null;
}

function partyPincodeForFiling(
  session: Pick<VerificationSessionValues, 'verificationSubject' | 'customerId'>,
  customers: Customer[],
  formPincode?: string,
  applied?: Customer,
): string {
  if (session.verificationSubject === 'self') return '';
  return applied?.pincode
    || formPincode
    || customers.find(c => c.id === session.customerId)?.pincode
    || '';
}

function rcFilingPartyFromProfile(
  rcUid?: string | null,
  rcProfile?: FirestoreUserDoc | null,
): { uid: string; name: string } | null {
  const uid = rcUid?.trim() || '';
  const name = rcProfile?.companyName?.trim() || rcProfile?.username?.trim() || '';
  if (!uid || !name) return null;
  return { uid, name };
}

function rcFilingFieldsForSession(
  session: Pick<VerificationSessionValues, 'verificationSubject' | 'customerId' | 'customerName'>,
  pincode: string,
  rcParty: { uid: string; name: string } | null,
) {
  return rcFilingPartyPatch({
    verificationSubject: session.verificationSubject,
    customerId: session.customerId,
    customerName: session.customerName,
    pincode,
    rcUid: rcParty?.uid,
    rcCompanyName: rcParty?.name,
  });
}

function rcFilingFieldsForRecord(
  record: SiteCalibration,
  customers: Customer[],
  rcParty: { uid: string; name: string } | null,
) {
  return rcFilingPartyPatch({
    verificationSubject: inferVerificationSubject(record),
    customerId: record.customerId,
    customerName: record.customerName,
    pincode: customers.find(c => c.id === record.customerId)?.pincode,
    state: customers.find(c => c.id === record.customerId)?.state,
    rcUid: rcParty?.uid || record.rcId,
    rcCompanyName: rcParty?.name,
  });
}

function verificationCreateGateSatisfied(
  role: import('../../types').Role | undefined,
  rcHasWeightsCert: boolean | null,
  rcHasVehicle: boolean | null,
  gatesLoading: boolean,
  gatesError: string,
): boolean {
  if (role !== 'vct' && role !== 'rc_admin' && role !== 'verifier') return false;
  if (gatesLoading || gatesError) return false;
  return rcHasWeightsCert === true && rcHasVehicle === true;
}

export const RCSiteCalibration: React.FC = () => {
  const { rcUid, actorUid, isVct, isVerifier, isFieldStaff, isRcAdmin } = useRcScope();
  const { user } = useAuth();
  const { products } = useAppContext();
  const { appSettings } = useAppSettings();
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const [records, setRecords] = useState<SiteCalibration[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [rcHasVehicle, setRcHasVehicle] = useState<boolean | null>(null);
  const [rcHasWeightsCert, setRcHasWeightsCert] = useState<boolean | null>(null);
  const [gatesLoading, setGatesLoading] = useState(false);
  const [gatesError, setGatesError] = useState('');

  const [showAddForm, setShowAddForm] = useState(false);
  const [showJobKindPicker, setShowJobKindPicker] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [lastViewedVerificationId, setLastViewedVerificationId] = useState<string | null>(null);
  const [rowHighlightFlashId, setRowHighlightFlashId] = useState<string | null>(null);
  const [sessionValues, setSessionValues] = useState<VerificationSessionValues>(EMPTY_VERIFICATION_SESSION);
  const [deviceImages, setDeviceImages] = useState<Record<string, DeviceVerificationImagesState>>({});
  const [deviceRvImages, setDeviceRvImages] = useState<Record<string, DeviceRvDocumentsState>>({});
  const [performerPhotos, setPerformerPhotos] = useState<PerformerPhotosState>(
    () => emptyPerformerPhotosState(),
  );

  const [submitProgressRecordIds, setSubmitProgressRecordIds] = useState<string[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rvPaymentOpen, setRvPaymentOpen] = useState(false);
  const [rvSessionPayment, setRvSessionPayment] = useState<{ paymentId: string; amountInr: number } | null>(null);
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');
  const [statusFilter, setStatusFilter] = useState<VerificationStatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState<VerificationTypeFilter>('all');
  const [durationFilter, setDurationFilter] = useState<VerificationDurationFilter>('all');
  const [paymentDueFilter, setPaymentDueFilter] = useState<VerificationPaymentDueFilter>('all');
  const [signedPdfFilter, setSignedPdfFilter] = useState<VerificationSignedPdfFilter>('all');
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
  const quotaSeats = useRcQuotaSeats(rcUid, records);
  const ovQuotaGate = useMemo<OvQuotaGate>(() => {
    const editingRecord = editingId ? records.find(r => r.id === editingId) : null;
    const held = editingRecord?.serialNumber?.trim()
      ? [editingRecord.serialNumber.trim()]
      : [];
    return {
      remaining: quotaSeats.remaining,
      balanceQty: quotaSeats.balanceQty,
      heldSerials: held,
    };
  }, [quotaSeats.remaining, quotaSeats.balanceQty, editingId, records]);

  const validationOptions = useMemo(() => {
    const editingRecordForValidation = editingId
      ? records.find(r => r.id === editingId) ?? null
      : null;
    const customerId = sessionValues.customerId.trim();
    const listedCustomer = customerId
      ? customers.find(c => c.id === customerId)
      : null;
    return {
      customerForm: partyContext.customerForm,
      rcForm: partyContext.rcForm,
      customerPincode: listedCustomer?.pincode ?? null,
      rcPincode: rcProfile?.pincode ?? null,
      rcZohoId: rcProfile?.zohoId,
      zohoRvInvoicingEnabled: isVerifier ? false : isZohoRvInvoicingEnabled(appSettings),
      performerPhotos,
      skipPerformerPhotos:
        sessionValues.verificationType !== 'RV'
        || Boolean(
          editingRecordForValidation && recordHasPerformerPhotos(editingRecordForValidation),
        ),
      ovQuota: sessionValues.verificationType === 'OV' ? ovQuotaGate : undefined,
      isNewJob: showAddForm,
    };
  }, [
    partyContext.customerForm,
    partyContext.rcForm,
    customers,
    rcProfile?.pincode,
    rcProfile?.zohoId,
    appSettings,
    performerPhotos,
    editingId,
    records,
    sessionValues.verificationType,
    sessionValues.customerId,
    isVerifier,
    ovQuotaGate,
    showAddForm,
  ]);

  const recordSubmitOptions = useCallback(
    (record: SiteCalibration) => {
      const listedCustomer = record.customerId
        ? customers.find(c => c.id === record.customerId)
        : null;
      return {
        ...validationOptions,
        customerForm: undefined,
        rcForm: undefined,
        customerPincode: listedCustomer?.pincode ?? null,
        rcPincode: rcProfile?.pincode ?? null,
        requireUploadedImages: true,
        skipPerformerPhotos: recordHasPerformerPhotos(record),
        ovQuota:
          record.verificationType === 'OV'
            ? {
                remaining: quotaSeats.remaining,
                balanceQty: quotaSeats.balanceQty,
                heldSerials: record.serialNumber?.trim() ? [record.serialNumber.trim()] : [],
              }
            : undefined,
        isNewJob: false,
      };
    },
    [validationOptions, customers, rcProfile?.pincode, quotaSeats.remaining, quotaSeats.balanceQty],
  );

  const submitOptions = useMemo<VerificationSubmitOptions>(
    () => ({ zohoRvInvoicingEnabled: isZohoRvInvoicingEnabled(appSettings) }),
    [appSettings],
  );

  const rvZohoSubmitBlocked =
    !isVerifier
    && sessionValues.verificationType === 'RV'
    && isZohoRvInvoicingEnabled(appSettings)
    && !rcZohoIdReady(rcProfile?.zohoId);

  const verificationDraftActor = useMemo(
    () =>
      resolveVerificationDraftActorForSession(sessionValues.assignedVctId, {
        isVct,
        isVerifier,
        actorUid,
        actorUsername: actorProfile?.username ?? user?.username,
        actorWorkflowMode: actorProfile?.workflowMode,
        assignableVcts,
        rcContactPerson: rcProfile?.contactPerson,
      }),
    [
      sessionValues.assignedVctId,
      isVct,
      isVerifier,
      actorUid,
      actorProfile?.username,
      actorProfile?.workflowMode,
      user?.username,
      assignableVcts,
      rcProfile?.contactPerson,
    ],
  );

  const buildPerformerPatch = useCallback(
    (session: VerificationSessionValues, previousRecord?: SiteCalibration | null) => {
      const actor = resolveVerificationDraftActorForSession(session.assignedVctId, {
        isVct,
        isVerifier,
        actorUid,
        actorUsername: actorProfile?.username ?? user?.username,
        actorWorkflowMode: actorProfile?.workflowMode,
        assignableVcts,
        rcContactPerson: rcProfile?.contactPerson,
      });
      const patch: Record<string, unknown> = {
        ...buildVerificationDraftMeta(actor),
        createdByUid: verificationPerformerCreatedByUid(actor, actorUid),
      };
      if (shouldClearVerificationVctFields(actor, previousRecord)) {
        patch.vctId = deleteField();
        if (actor.actor === 'rc') {
          const contact = actor.contactPerson?.trim();
          if (contact) patch.vctName = contact;
          else patch.vctName = deleteField();
        } else {
          patch.vctName = deleteField();
        }
      }
      return patch;
    },
    [
      isVct,
      isVerifier,
      actorUid,
      actorProfile?.username,
      actorProfile?.workflowMode,
      user?.username,
      assignableVcts,
      rcProfile?.contactPerson,
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
      if (docData) {
        setRcHasWeightsCert(rcHasStandardWeightsCert(docData));
      }
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
      const q = verificationRecordsQuery(db, rcUid, { isFieldStaff, actorUid });
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
  }, [rcUid, isFieldStaff, actorUid]);

  const refreshRcVerificationGates = useCallback(async () => {
    if (!rcUid) {
      setRcHasVehicle(null);
      setRcHasWeightsCert(null);
      setGatesLoading(false);
      setGatesError('');
      return;
    }
    setGatesLoading(true);
    setGatesError('');
    try {
      const [vehicles, hasWeightsCert] = await Promise.all([
        fetchRcVehicles(rcUid),
        fetchRcHasStandardWeightsCert(rcUid),
      ]);
      setRcHasVehicle(rcHasRegisteredVehicle(vehicles));
      setRcHasWeightsCert(hasWeightsCert);
    } catch (err: unknown) {
      setRcHasVehicle(null);
      setRcHasWeightsCert(null);
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code: string }).code)
          : '';
      setGatesError(
        code === 'permission-denied'
          ? 'Could not verify centre setup (permission denied). Deploy Firestore rules or contact Super Admin.'
          : err instanceof Error
            ? err.message
            : 'Could not verify centre setup. Check your connection and refresh.',
      );
    } finally {
      setGatesLoading(false);
    }
  }, [rcUid]);

  const desktopVerification =
    (isRcAdmin || isFieldStaff) && !isVerificationCaptureDevice();
  const rcProfileGeoStampCoords = useMemo(() => {
    const lat = rcProfile?.location?.lat;
    const lng = rcProfile?.location?.lng;
    if (lat == null || lng == null) return null;
    return { lat, lng };
  }, [rcProfile?.location?.lat, rcProfile?.location?.lng]);
  const rcProfileGpsReady = !desktopVerification || rcProfileGeoStampCoords != null;
  const gpsRequiredMessage = RC_PROFILE_GPS_REQUIRED_MESSAGE;
  const showGpsRequiredNotice = desktopVerification && !rcProfileGpsReady;

  useEffect(() => {
    void refreshRcVerificationGates();
  }, [refreshRcVerificationGates]);

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
    if (!rcUid || isFieldStaff) {
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
  }, [rcUid, isFieldStaff]);

  useEffect(() => {
    if (!isFieldStaff || !actorUid) {
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
  }, [isFieldStaff, actorUid]);

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
    if (!showForm) void refreshRcVerificationGates();
  }, [showForm, refreshRcVerificationGates]);

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
      setPerformerPhotos(emptyPerformerPhotosState());
    }
  }, [sessionValues.verificationType]);

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
    setPerformerPhotos(emptyPerformerPhotosState());
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

  const patchSession = useCallback((patch: Partial<VerificationSessionValues>) => {
    setSessionValues(prev => {
      const next = { ...prev, ...patch };
      const devices = applyLockedSerialToDevices(next.devices, next.lockedSerial);
      return devices === next.devices ? next : { ...next, devices };
    });
  }, []);

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
    async (currentSession: VerificationSessionValues, allowIncomplete = false) => {
      const result = await verificationFieldsRef.current?.persistPartyChanges({
        allowIncomplete,
      });
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
    if (sessionValues.verificationType === 'OV') {
      const cap = ovQuotaSeatCap(ovQuotaGate);
      const included = sessionValues.devices.filter(row => row.included).length;
      if (included >= cap) {
        setError(
          cap <= 0
            ? 'OV quota balance is 0. Cannot start more Original Verifications.'
            : `OV quota: ${cap} left. You can start ${cap} more Original Verification(s).`,
        );
        return;
      }
    }
    const row = {
      ...createEmptyVerificationDeviceRow(),
      sealIdentificationNumber: laboratorySealId,
    };
    setSessionValues(prev => ({
      ...prev,
      devices: applyLockedSerialToDevices([...prev.devices, row], prev.lockedSerial),
    }));
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

  const handlePerformerPhotoSelect = (kind: PerformerPhotoKind, file: File) => {
    const previewUrl = URL.createObjectURL(file);
    setPerformerPhotos(prev => ({
      ...prev,
      [kind]: {
        ...(prev[kind] ?? emptyDeviceImageSlot()),
        pendingFile: file,
        removed: false,
        file: { url: previewUrl, path: '', name: file.name, contentType: file.type },
        uploading: false,
        progress: 0,
      },
    }));
  };

  const handlePerformerPhotoRemove = (kind: PerformerPhotoKind) => {
    setPerformerPhotos(prev => ({
      ...prev,
      [kind]: emptyDeviceImageSlot(),
    }));
  };

  const uploadPerformerPhotos = async (recordId: string): Promise<Partial<SiteCalibration>> => {
    let fields: Partial<SiteCalibration> = {};
    for (const kind of PERFORMER_PHOTO_KINDS) {
      const slot = performerPhotos[kind] ?? emptyDeviceImageSlot();
      if (slot.removed && !slot.pendingFile) {
        fields = { ...fields, ...performerPhotoFieldsFromMeta(kind, null) };
        continue;
      }
      if (!slot.pendingFile) {
        if (slot.file?.url && !slot.file.url.startsWith('blob:')) {
          fields = { ...fields, ...performerPhotoFieldsFromMeta(kind, slot.file) };
        }
        continue;
      }

      setPerformerPhotos(prev => ({
        ...prev,
        [kind]: { ...(prev[kind] ?? emptyDeviceImageSlot()), uploading: true, progress: 0 },
      }));

      try {
        const meta = await uploadSiteCalibrationDeviceImage(recordId, kind, slot.pendingFile, pct => {
          setPerformerPhotos(prev => ({
            ...prev,
            [kind]: { ...(prev[kind] ?? emptyDeviceImageSlot()), progress: pct },
          }));
        });
        setPerformerPhotos(prev => ({
          ...prev,
          [kind]: {
            ...(prev[kind] ?? emptyDeviceImageSlot()),
            file: meta,
            uploading: false,
            progress: 100,
            pendingFile: null,
            removed: false,
          },
        }));
        fields = { ...fields, ...performerPhotoFieldsFromMeta(kind, meta) };
      } catch (err) {
        setPerformerPhotos(prev => ({
          ...prev,
          [kind]: { ...(prev[kind] ?? emptyDeviceImageSlot()), uploading: false, progress: 0 },
        }));
        throw err;
      }
    }
    return fields;
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
      if (isFieldStaff) {
        return 'Permission denied. Ensure your account is active and linked to your RC centre, then try again.';
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
        appSettings,
      ),
    [sessionValues, products, rcProfile, appSettings],
  );

  const handleCreate = async (
    submitAfterSave = false,
    rvPayment?: { paymentId: string; amountInr: number },
  ) => {
    if (!canCreateVerification(user?.role)) {
      setError('You do not have permission to start verifications.');
      return;
    }
    const gateMsg = verificationCreateGateBlockMessage(
      rcHasWeightsCert,
      rcHasVehicle,
      gatesLoading,
      gatesError,
    );
    if (gateMsg) {
      setError(gateMsg);
      return;
    }
    // Centre GPS only required for desktop submit. Drafts may save without it.
    if (
      submitAfterSave
      && !rcProfileGpsReady
      && desktopVerification
    ) {
      setError(gpsRequiredMessage);
      return;
    }
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
      const applied = await persistPartyBeforeSave(sessionValues, !submitAfterSave);
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
      const createdByUid = verificationPerformerCreatedByUid(verificationDraftActor, actorUid);
      if (!createdByUid) {
        setError('Signed-in user is required to save verification drafts.');
        return;
      }
      const filingPincode = partyPincodeForFiling(
        sessionForSave,
        customers,
        partyContext.customerForm?.pincode,
        applied.customer,
      );
      const rowsToSync = includedRows.filter(
        row => row.productId.trim() && row.serialNumber.trim(),
      );
      await syncCustomerDevices(rowsToSync, sessionForSave.customerId, applied.customer);
      const applicationNumbers = await allocateVerificationApplicationNumbers(db, includedRows.length);
      const fees = resolveRcFeesStructure(rcProfile);

      if (
        submitAfterSave
        && !isVerifier
        && sessionForSave.verificationType === 'RV'
        && isRvPaymentRequired(sessionForSave.verificationType)
        && !rvPayment
      ) {
        setError('Pay RV fees from wallet before submitting.');
        return;
      }

      const pendingRvPaymentPatch =
        sessionForSave.verificationType === 'RV'
          ? { rvPaymentStatus: 'pending' as const }
          : { rvPaymentStatus: 'not_required' as const };

      let performerImageFields: Partial<SiteCalibration> = {};

      for (let rowIndex = 0; rowIndex < includedRows.length; rowIndex += 1) {
        const row = includedRows[rowIndex];
        const ref = doc(collection(db, 'siteCalibrations'));
        const recordId = ref.id;
        if (rowIndex === 0 && sessionForSave.verificationType === 'RV' && isVerificationCaptureDevice()) {
          performerImageFields = await uploadPerformerPhotos(recordId);
        }
        const imageFields = await uploadRowImages(recordId, row.localId, sessionForSave.verificationType === 'RV');
        const deviceId = row.isNewDevice ? row.localId : row.deviceId;
        const product = products.find(p => p.id === row.productId) ?? null;
        const docaCharges = computeVerificationDocaCharges(
          fees,
          sessionForSave.verificationType,
          sessionForSave.verificationLocation,
          sessionForSave.verificationSubject,
          product,
          appSettings,
        );

        const perDeviceRvPaymentPatch =
          sessionForSave.verificationType === 'RV' && rvPayment
            ? (() => {
                const breakdown = computeRvPaymentAmountForRow(
                  row,
                  products,
                  fees,
                  sessionForSave.verificationLocation,
                  sessionForSave.verificationSubject,
                  sessionForSave.verificationType,
                  appSettings,
                );
                const perDeviceAmount = breakdown?.total;
                return perDeviceAmount != null && perDeviceAmount > 0
                  ? buildRvPaymentFirestorePatch(rvPayment.paymentId, perDeviceAmount)
                  : pendingRvPaymentPatch;
              })()
            : pendingRvPaymentPatch;

        const createdAt = new Date().toISOString();
        const record: Omit<SiteCalibration, 'id'> = {
          rcId: rcUid!,
          createdAt,
          createdByUid,
          applicationNumber: applicationNumbers[rowIndex],
          ...buildNewSiteCalibrationRecord(
            sessionForSave,
            { ...row, deviceId },
            product,
            verificationDraftActor,
            docaCharges,
            filingPincode,
            rcFilingPartyFromProfile(rcUid, rcProfile),
            fees,
          ),
          ...imageFields,
          ...performerImageFields,
          ...perDeviceRvPaymentPatch,
        };
        const gstBill = computeStoredGstBill(record);
        if (gstBill) record.gstBill = gstBill;
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
        if (isVerifier) {
          await submitVerifierWorkForRcReview(draftRecordIds);
        } else {
          await submitVerificationRecords(
            draftRecordIds.map(recordId => ({
              id: recordId,
              verificationType: sessionForSave.verificationType,
              ...rcFilingFieldsForSession(
                sessionForSave,
                filingPincode,
                rcFilingPartyFromProfile(rcUid, rcProfile),
              ),
            })),
            db,
            submitOptions,
          );
        }
      }

      const submittedRecordIds = submitAfterSave && !isVerifier ? draftRecordIds : [];

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
      const applied = await persistPartyBeforeSave(sessionValues, true);
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
        appSettings,
        existing,
      );
      const imageFields = await uploadRowImages(recordId, row.localId, sessionForSave.verificationType === 'RV');
      const performerImageFields =
        sessionForSave.verificationType === 'RV' && isVerificationCaptureDevice()
          ? await uploadPerformerPhotos(recordId)
          : {};
      await updateDoc(doc(db, 'siteCalibrations', recordId), {
        ...buildSiteCalibrationFromRow(sessionForSave, row, {
          product,
          feesStructure: resolveRcFeesStructure(rcProfile),
          partyPincode: partyPincodeForFiling(
            sessionForSave,
            customers,
            partyContext.customerForm?.pincode,
            applied.customer,
          ),
          rcUid,
          rcCompanyName: rcProfile?.companyName || rcProfile?.username,
        }),
        ...docaPatch,
        ...imageFields,
        ...performerImageFields,
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
    if (!canUseVerificationCapture(user?.role)) {
      setListError(VERIFICATION_MOBILE_ONLY_NOTICE);
      return;
    }

    const validationError = siteCalibrationSubmitBlockReason(record, recordSubmitOptions(record));
    if (validationError) {
      setListError(validationError);
      return;
    }

    unlockVerificationSuccessAudio();
    setSubmitting(true);
    setListError('');
    try {
      if (isVerifier) {
        await submitVerifierWorkForRcReview([record.id]);
        if (editingId === record.id) handleCloseForm();
        await fetchRecords();
        return;
      }
      await ensureRvWalletDebitedForRecords({
        records: [record],
        products,
        feeSettings: appSettings,
        feesForRc: () => resolveRcFeesStructure(rcProfile),
      });
      await submitVerificationRecord(
        {
          id: record.id,
          verificationType: record.verificationType,
          ...rcFilingFieldsForRecord(record, customers, rcFilingPartyFromProfile(rcUid, rcProfile)),
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
    if (!canUseVerificationCapture(user?.role)) {
      setListError(VERIFICATION_MOBILE_ONLY_NOTICE);
      return;
    }
    const selectedRecords = filteredRecords.filter(
      r => selectedDraftIds.has(r.id) && isSiteCalibrationSubmittable(r, recordSubmitOptions(r)),
    );

    if (selectedRecords.length === 0) {
      setListError('None of the selected drafts are ready to submit. Complete required fields and images first.');
      return;
    }

    unlockVerificationSuccessAudio();
    setSubmitting(true);
    setListError('');
    try {
      if (isVerifier) {
        await submitVerifierWorkForRcReview(selectedRecords.map(record => record.id));
        setSelectedDraftIds(new Set());
        if (editingId && selectedRecords.some(r => r.id === editingId)) handleCloseForm();
        await fetchRecords();
        return;
      }
      await ensureRvWalletDebitedForRecords({
        records: selectedRecords,
        products,
        feeSettings: appSettings,
        feesForRc: () => resolveRcFeesStructure(rcProfile),
      });
      await submitVerificationRecords(
        selectedRecords.map(record => ({
          id: record.id,
          verificationType: record.verificationType,
          ...rcFilingFieldsForRecord(record, customers, rcFilingPartyFromProfile(rcUid, rcProfile)),
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

  const handleApproveVerifierWork = async (record: SiteCalibration) => {
    if (!isRcAdmin || !canRcApproveVerifierVerification(record) || !user?.uid) return;

    const zohoError = validateRvZohoSubmitReady(
      record.verificationType,
      rcProfile?.zohoId,
      { zohoRvInvoicingEnabled: isZohoRvInvoicingEnabled(appSettings) },
    );
    if (zohoError) {
      setListError(zohoError);
      return;
    }

    const ok = await confirm({
      title: 'Approve verifier work?',
      message: `Approve verification for "${record.customerName || record.serialNumber || 'this device'}"? Certificate generation starts after approval.`,
      confirmLabel: 'Approve',
    });
    if (!ok) return;

    unlockVerificationSuccessAudio();
    setSubmitting(true);
    setListError('');
    setError('');
    try {
      await updateDoc(
        doc(db, 'siteCalibrations', record.id),
        buildRcApproveVerifierPatch(user.uid),
      );
      await ensureRvWalletDebitedForRecords({
        records: [record],
        products,
        feeSettings: appSettings,
        feesForRc: () => resolveRcFeesStructure(rcProfile),
      });
      await submitVerificationRecord(
        {
          id: record.id,
          verificationType: record.verificationType,
          ...rcFilingFieldsForRecord(record, customers, rcFilingPartyFromProfile(rcUid, rcProfile)),
        },
        db,
        submitOptions,
      );
      if (editingId === record.id) handleCloseForm();
      await fetchRecords();
      beginSubmitProgress([record.id]);
    } catch (err: unknown) {
      const message = isZohoInvoiceGateError(err)
        ? formatZohoInvoiceGateError(err)
        : formatSaveError(err, 'Failed to approve verifier work.', record);
      setListError(message);
      setError(message);
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
      const filingPincode = partyPincodeForFiling(
        sessionForSave,
        customers,
        partyContext.customerForm?.pincode,
        appliedCustomer,
      );
      const product = products.find(p => p.id === row.productId) ?? null;
      const docaPatch = verificationDocaFirestorePatch(
        resolveRcFeesStructure(rcProfile),
        sessionForSave.verificationType,
        sessionForSave.verificationLocation,
        sessionForSave.verificationSubject,
        product,
        appSettings,
        existing,
      );
      const imageFields = await uploadRowImages(editingId, row.localId, sessionForSave.verificationType === 'RV');
      const performerImageFields =
        sessionForSave.verificationType === 'RV' && isVerificationCaptureDevice()
          ? await uploadPerformerPhotos(editingId)
          : {};
      const fees = resolveRcFeesStructure(rcProfile);
      const perDeviceRvAmount =
        sessionForSave.verificationType === 'RV'
          ? computeRvPaymentAmountForRow(
              row,
              products,
              fees,
              sessionForSave.verificationLocation,
              sessionForSave.verificationSubject,
              sessionForSave.verificationType,
              appSettings,
            )?.total
          : null;
      const rvPaymentPatch =
        sessionForSave.verificationType === 'RV' && rvPayment && perDeviceRvAmount != null && perDeviceRvAmount > 0
          ? buildRvPaymentFirestorePatch(rvPayment.paymentId, perDeviceRvAmount)
          : {};
      await updateDoc(doc(db, 'siteCalibrations', editingId), {
        ...buildSiteCalibrationFromRow(sessionForSave, row, {
          product,
          feesStructure: fees,
          partyPincode: filingPincode,
          rcUid,
          rcCompanyName: rcProfile?.companyName || rcProfile?.username,
        }),
        ...docaPatch,
        ...imageFields,
        ...performerImageFields,
        ...rvPaymentPatch,
        ...buildPerformerPatch(sessionForSave, existing),
      });

      if (walletPaymentId) {
        await linkWalletPaymentToRecords({
          paymentId: walletPaymentId,
          recordIds: [editingId],
        });
      }

      if (isVerifier) {
        await submitVerifierWorkForRcReview([editingId]);
      } else {
        await submitVerificationRecord(
          {
            id: editingId,
            verificationType: sessionForSave.verificationType,
            ...rcFilingFieldsForSession(
              sessionForSave,
              filingPincode,
              rcFilingPartyFromProfile(rcUid, rcProfile),
            ),
          },
          db,
          submitOptions,
        );
      }

      handleCloseForm();
      await fetchRecords();
      if (!isVerifier) {
        beginSubmitProgress([editingId]);
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
      setError(isVerifier ? 'Accept the declaration before sending to RC.' : 'Accept the declaration before submitting for certification.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const applied = await persistPartyBeforeSave(sessionValues);
      if (!applied.ok) return;

      const isRv = sessionValues.verificationType === 'RV';
      const rvPaymentRequired = !isVerifier && isRvPaymentRequired(sessionValues.verificationType);

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
        const fees = resolveRcFeesStructure(rcProfile);
        const perRecordExpected =
          existing != null
            ? computeRvPaymentBreakdownForRecord(
                existing,
                products,
                fees,
                appSettings,
              )?.total ?? null
            : null;

        if (isRvSessionPaymentSatisfied(rvSessionPayment, rvPaymentBreakdown.total)) {
          await executeSubmitFromForm(rvSessionPayment!, { partyPersisted: true });
          return;
        }

        if (isRvPaymentSatisfied(existing, perRecordExpected)) {
          const amountInr = perRecordExpected ?? existing?.rvPaymentAmount;
          await executeSubmitFromForm(
            existing?.rvPaymentId && amountInr != null
              ? { paymentId: existing.rvPaymentId, amountInr }
              : undefined,
            { partyPersisted: true },
          );
          return;
        }

        const paid = await payRvFromWallet({
          rcId: rcUid,
          amountInr: rvPaymentBreakdown.total,
          breakdown: rvPaymentBreakdown,
          idempotencyKey:
            typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
              ? crypto.randomUUID()
              : `wallet-${Date.now()}`,
          recordIds: editingId ? [editingId] : [],
        });
        await executeSubmitFromForm(
          { paymentId: paid.paymentId, amountInr: rvPaymentBreakdown.total },
          { partyPersisted: true },
        );
        return;
      }

      await executeSubmitFromForm(undefined, { partyPersisted: true });
    } catch (err: unknown) {
      setError(formatSaveError(err, 'Failed to submit verification.'));
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
      if (!canCreateVerification(user?.role)) {
        setListError('You do not have permission to start verifications.');
        return;
      }
      const gateMsg = verificationCreateGateBlockMessage(
        rcHasWeightsCert,
        rcHasVehicle,
        gatesLoading,
        gatesError,
      );
      if (gateMsg) {
        setListError(gateMsg);
        return;
      }
      if (verificationRequiresMobileCapture(user?.role) && !isVerificationCaptureDevice()) {
        setListError(VERIFICATION_MOBILE_ONLY_NOTICE);
        return;
      }
      setEditingId(null);
      setError('');
      setListError('');
      setRvPaymentOpen(false);
      setRvSessionPayment(null);
      setSessionValues({
        ...session,
        devices: applyLockedSerialToDevices(session.devices, session.lockedSerial),
      });
      const firstDeviceId = session.devices[0]?.localId;
      setDeviceImages(
        firstDeviceId ? { [firstDeviceId]: emptyDeviceVerificationImagesState() } : {},
      );
      setDeviceRvImages(
        firstDeviceId ? { [firstDeviceId]: emptyDeviceRvDocumentsState() } : {},
      );
      setPerformerPhotos(emptyPerformerPhotosState());
      setWizardOnLastStep(false);
      setVerificationDeclarationAccepted(false);
      setShowJobKindPicker(false);
      setShowAddForm(true);
    },
    [user?.role, rcHasWeightsCert, rcHasVehicle, gatesLoading, gatesError],
  );

  const handleStartAdd = () => {
    if (!canCreateVerification(user?.role)) {
      setListError('You do not have permission to start verifications.');
      return;
    }
    const gateMsg = verificationCreateGateBlockMessage(
      rcHasWeightsCert,
      rcHasVehicle,
      gatesLoading,
      gatesError,
    );
    if (gateMsg) {
      setListError(gateMsg);
      return;
    }
    if (verificationRequiresMobileCapture(user?.role) && !isVerificationCaptureDevice()) {
      setListError(VERIFICATION_MOBILE_ONLY_NOTICE);
      return;
    }
    setListError('');
    setShowJobKindPicker(true);
  };

  const handleJobKindSelect = useCallback(
    (kind: VerificationJobKind, serial?: string, manufacturingYear?: string) => {
      setShowJobKindPicker(false);
      if (!rcUid) {
        setListError('RC centre is still loading.');
        return;
      }
      if (kind === 'ov_self' && !rcProfile) {
        setListError('RC centre details are still loading.');
        return;
      }
      openNewVerificationSession(
        buildVerificationSessionForKind(
          kind,
          rcProfile ?? { companyName: '', username: '' },
          rcUid,
          laboratorySealId,
          serial ?? '',
          manufacturingYear ?? '',
        ),
      );
    },
    [rcUid, rcProfile, laboratorySealId, openNewVerificationSession],
  );

  const pendingCustomerId = searchParams.get('customerId');
  const pendingStatusFilter = searchParams.get('status');
  const pendingTypeFilter = searchParams.get('type');
  const pendingDurationFilter = parseVerificationDurationParam(searchParams.get('duration'));
  const pendingOpenId = searchParams.get('open');
  const pendingFocusSearch = searchParams.get('focus') === 'search';
  const pendingNewType = searchParams.get('new');

  useEffect(() => {
    if (!pendingNewType) return;
    if (loading || !canCreateVerification(user?.role)) return;

    const gateMsg = verificationCreateGateBlockMessage(
      rcHasWeightsCert,
      rcHasVehicle,
      gatesLoading,
      gatesError,
    );
    if (gateMsg) {
      setListError(gateMsg);
    } else if (verificationRequiresMobileCapture(user?.role) && !isVerificationCaptureDevice()) {
      setListError(VERIFICATION_MOBILE_ONLY_NOTICE);
    } else {
      setShowJobKindPicker(true);
    }

    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev);
        next.delete('new');
        return next;
      },
      { replace: true },
    );
  }, [
    pendingNewType,
    loading,
    rcHasWeightsCert,
    rcHasVehicle,
    gatesLoading,
    gatesError,
    setSearchParams,
    user?.role,
  ]);

  useEffect(() => {
    if (!pendingCustomerId || loading || !canCreateVerification(user?.role)) return;
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
    user?.role,
  ]);

  useEffect(() => {
    if (!pendingStatusFilter) return;
    const allowed: VerificationStatusFilter[] = [
      'all',
      'draft',
      'submitted',
      'certified',
      'failed_submit',
      'rejected',
    ];
    const raw = pendingStatusFilter as VerificationStatusFilter;
    if (allowed.includes(raw)) {
      setStatusFilter(raw);
    } else if (raw === 'approved' || raw === 'failed_certification') {
      setStatusFilter(raw === 'failed_certification' ? 'failed_submit' : 'submitted');
    }
    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev);
        next.delete('status');
        return next;
      },
      { replace: true },
    );
  }, [pendingStatusFilter, setSearchParams]);

  useEffect(() => {
    if (pendingTypeFilter !== 'OV' && pendingTypeFilter !== 'RV' && pendingTypeFilter !== 'all') {
      return;
    }
    setTypeFilter(pendingTypeFilter);
    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev);
        next.delete('type');
        return next;
      },
      { replace: true },
    );
  }, [pendingTypeFilter, setSearchParams]);

  useEffect(() => {
    if (!pendingDurationFilter) return;
    setDurationFilter(pendingDurationFilter);
    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev);
        next.delete('duration');
        return next;
      },
      { replace: true },
    );
  }, [pendingDurationFilter, setSearchParams]);

  useEffect(() => {
    if (!pendingFocusSearch) return;
    const timer = window.setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>(
        'input[placeholder="Search verification…"], input[placeholder="Search verification..."]',
      );
      input?.focus();
      input?.select();
    }, 80);
    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev);
        next.delete('focus');
        return next;
      },
      { replace: true },
    );
    return () => window.clearTimeout(timer);
  }, [pendingFocusSearch, setSearchParams]);

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
    setPerformerPhotos(performerPhotosFromRecord(record));
    setError('');
  };

  useEffect(() => {
    if (!pendingOpenId || loading) return;
    const record = records.find(entry => entry.id === pendingOpenId);
    if (!record) return;
    openRecord(record);
    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev);
        next.delete('open');
        return next;
      },
      { replace: true },
    );
    // Deep-link open once records are ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOpenId, loading, records, setSearchParams]);

  const startEdit = (record: SiteCalibration) => {
    if (isVerificationEditable(record) && !canUseVerificationCapture(user?.role)) {
      setListError(VERIFICATION_MOBILE_ONLY_NOTICE);
      return;
    }
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
  const rvPaymentRequired = !isVerifier && isRvPaymentRequired(sessionValues.verificationType);
  const editingRecord = editingId ? records.find(r => r.id === editingId) ?? null : null;
  const zohoGateRetry = isRvZohoSubmitGateRetry(editingRecord);
  const submitLabel = isVerifier
    ? showAddForm && includedDeviceCount > 1
      ? `Send ${includedDeviceCount} to RC`
      : 'Send to RC for approval'
    : zohoGateRetry
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
  const compactJob =
    showAddForm
    && (sessionValues.verificationType === 'OV' || sessionValues.verificationType === 'RV');
  const canSaveDraftFromFooter =
    !compactJob
    && !isViewMode
    && !isCertifiedActionsView
    && (!showAddForm || wizardOnLastStep);
  const showVerificationBackBar = isCertifiedActionsView || isViewMode;
  const showFormFooter =
    !showVerificationBackBar && (!showAddForm || wizardOnLastStep);
  const mobileFloatingChrome = useVerificationMobileLayout(showAddForm);
  const ovSelfDevice = sessionValues.devices.find(row => row.included) ?? sessionValues.devices[0];
  const verificationCaptureAllowed = canUseVerificationCapture(user?.role);
  const verificationCreateGateOk = verificationCreateGateSatisfied(
    user?.role,
    rcHasWeightsCert,
    rcHasVehicle,
    gatesLoading,
    gatesError,
  );
  const canStartNewVerification =
    canCreateVerification(user?.role)
    && verificationCreateGateOk
    && (verificationRequiresMobileCapture(user?.role) ? verificationCaptureAllowed : true);

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
      return isVerifier
        ? 'Accept the declaration before sending to RC.'
        : 'Accept the declaration before submitting for certification.';
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
    isVerifier,
  ]);

  const canSubmitFromForm = !submitBlockReason;

  const duplicatePrimaryIds = useMemo(() => buildDuplicatePrimaryIdSet(records), [records]);
  const serialGroups = useMemo(() => buildSerialGroupMap(records), [records]);

  const durationScoped = useMemo(
    () => records.filter(record => matchesVerificationDurationFilter(record, durationFilter)),
    [records, durationFilter],
  );

  const paymentDueCount = useMemo(
    () => durationScoped.filter(record => isRvWalletPaymentOutstanding(record)).length,
    [durationScoped],
  );
  const signedPdfCounts = useMemo(() => tallySignedPdfFilters(durationScoped), [durationScoped]);

  const filteredRecords = useMemo(() => {
    const filtered = durationScoped.filter(record => {
      if (!matchesVerificationSearch(record, searchTerm)) return false;
      if (paymentDueFilter === 'due' && !isRvWalletPaymentOutstanding(record)) {
        return false;
      }
      if (!matchesSignedPdfFilter(record, signedPdfFilter)) {
        return false;
      }
      if (
        !matchesVerificationListStatusFilter(
          record,
          statusFilter,
          durationScoped,
          duplicatePrimaryIds,
          serialGroups,
        )
      ) {
        return false;
      }
      return matchesVerificationTypeFilter(record, typeFilter);
    });
    return buildVerificationListDisplay(filtered, durationScoped, statusFilter);
  }, [durationScoped, statusFilter, typeFilter, paymentDueFilter, signedPdfFilter, searchTerm, duplicatePrimaryIds, serialGroups]);

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
  const statusCounts = useMemo(
    () => tallyVerificationStatusFiltersCollapsed(durationScoped, listFilters),
    [durationScoped, listFilters],
  );
  const dashCounts = useMemo(
    () => tallyVerificationStatusFilters(durationScoped),
    [durationScoped],
  );
  const dashRvCount = useMemo(
    () => tallyVerificationTypeFilters(durationScoped).RV,
    [durationScoped],
  );
  const typeCounts = useMemo(
    () =>
      tallyVerificationTypeFilters(
        verificationListCollapsedForCounts(durationScoped, listFilters, 'type'),
      ),
    [durationScoped, listFilters],
  );

  const statusFilterOptions = buildVerificationStatusFilterOptions(statusCounts);
  const typeFilterOptions = buildVerificationTypeFilterOptions(typeCounts);

  const draftSubmitMeta = useMemo(() => {
    const meta = new Map<string, { submittable: boolean; blockReason: string | null }>();
    for (const record of filteredRecords) {
      if (normalizeVerificationStatus(record) !== 'draft') continue;
      const blockReason = siteCalibrationSubmitBlockReason(record, recordSubmitOptions(record));
      meta.set(record.id, { submittable: !blockReason, blockReason });
    }
    return meta;
  }, [filteredRecords, recordSubmitOptions]);

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
  }, [statusFilter, typeFilter, searchTerm, durationFilter, paymentDueFilter, signedPdfFilter]);

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
  }, [statusFilter, searchTerm, paymentDueFilter, signedPdfFilter]);

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
      {!isCertifiedActionsView && !isViewMode && error && (
        <p className="verification-form-footer-hint verification-form-footer-hint--error mb-0" role="alert">
          {error}
        </p>
      )}
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
            type="button"
            className="verification-form-btn verification-form-btn--save"
            disabled={formBusy || Boolean(draftBlockReason)}
            title={draftBlockReason ?? undefined}
            onClick={() => {
              if (showAddForm) void handleCreate(false);
              else if (editingId) void handleSaveEdit(editingId);
            }}
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
                rcCenterName={rcProfile?.companyName || rcProfile?.username}
                customer={
                  editingRecord.customerId
                    ? customers.find(item => item.id === editingRecord.customerId) ?? null
                    : null
                }
                product={
                  products.find(item => item.id === editingRecord.productId)
                  ?? products.find(item => item.name.trim() === editingRecord.productName?.trim())
                  ?? null
                }
                rcProfile={rcProfile}
                onClose={handleCloseForm}
                closeDisabled={formBusy}
                onResubmitted={async () => {
                  await fetchRecords();
                }}
              />
            ) : (
              <>
                <ListViewBackBar
                  onBack={handleCloseForm}
                  disabled={formBusy}
                  trailing={
                    compactJob ? (
                      <OvSelfSerialMpeBar
                        serial={ovSelfDevice?.serialNumber ?? sessionValues.lockedSerial ?? ''}
                        mpe={ovSelfDevice?.maximumPermissibleError ?? ''}
                        compact
                      />
                    ) : null
                  }
                />
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
                        {verificationCertificateNumber(editingRecord) && (
                          <span className="text-mono text-xs">
                            Cert {verificationCertificateNumber(editingRecord)}
                          </span>
                        )}
                      </div>
                    )}
                    {isViewMode && editingRecord && isRcAdmin && canRcApproveVerifierVerification(editingRecord) && (
                      <button
                        type="button"
                        className="btn btn-primary text-sm py-1.5 px-3 mt-2 flex items-center gap-1.5"
                        onClick={() => void handleApproveVerifierWork(editingRecord)}
                        disabled={submitting}
                      >
                        {submitting ? (
                          <span className="spinner-inline" aria-hidden />
                        ) : (
                          <Check size={16} aria-hidden />
                        )}
                        Approve verifier work
                      </button>
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
                      performerPhotos={performerPhotos}
                      onPerformerPhotoSelect={handlePerformerPhotoSelect}
                      onPerformerPhotoRemove={handlePerformerPhotoRemove}
                      customers={customers}
                      rcProfile={rcProfile}
                      rcUid={rcUid ?? undefined}
                      actorUid={actorUid ?? undefined}
                      submitting={formBusy}
                      lockCustomer={isEditMode}
                      readOnly={isViewMode}
                      allowPerformerAssignment={!isFieldStaff && !isViewMode && !compactJob}
                      assignableVcts={assignableVcts}
                      geoStampCoords={rcProfileGeoStampCoords}
                      laboratorySealIdentification={laboratorySealId}
                      onWizardStepChange={handleWizardStepChange}
                      onDeclarationAcceptedChange={setVerificationDeclarationAccepted}
                      onPartyContextChange={handlePartyContextChange}
                      onCancel={handleCloseForm}
                      wizardNavIncludesCancel={showAddForm}
                      mobileFloatingChrome={mobileFloatingChrome}
                      lockKind={showAddForm}
                      ovQuota={sessionValues.verificationType === 'OV' ? ovQuotaGate : null}
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
          {verificationRequiresMobileCapture(user?.role) && !verificationCaptureAllowed && (
            <div className="verification-mobile-only-notice" role="status">
              <p className="verification-mobile-only-notice__title">Mobile app required</p>
              <p className="verification-mobile-only-notice__text mb-0">
                {VERIFICATION_MOBILE_ONLY_NOTICE}
              </p>
            </div>
          )}
          {showGpsRequiredNotice && (
            <div className="rc-vehicle-required-notice" role="status">
              <p className="rc-vehicle-required-notice__title">Centre GPS required</p>
              <p className="rc-vehicle-required-notice__text mb-0">
                {gpsRequiredMessage}{' '}
                {isRcAdmin
                  ? RC_PROFILE_GPS_REQUIRED_RC_HINT
                  : RC_PROFILE_GPS_REQUIRED_VCT_HINT}
              </p>
            </div>
          )}
          {(isFieldStaff || isRcAdmin) && gatesError ? (
            <div className="rc-vehicle-required-notice" role="alert">
              <p className="rc-vehicle-required-notice__title">Cannot start verification</p>
              <p className="rc-vehicle-required-notice__text mb-0">{gatesError}</p>
            </div>
          ) : null}
          <VerificationListStatusDash
            counts={dashCounts}
            rvCount={dashRvCount}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            typeFilter={typeFilter}
            onTypeFilterChange={setTypeFilter}
            loading={loading}
          />
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
            durationFilter={durationFilter}
            onDurationFilterChange={setDurationFilter}
            paymentDueFilter={paymentDueFilter}
            onPaymentDueFilterChange={setPaymentDueFilter}
            paymentDueCount={paymentDueCount}
            paymentDueAllCount={durationScoped.length}
            signedPdfFilter={signedPdfFilter}
            onSignedPdfFilterChange={setSignedPdfFilter}
            signedPdfCount={signedPdfCounts.signed}
            notSignedPdfCount={signedPdfCounts.notSigned}
            onNewClick={
              canStartNewVerification
                ? handleStartAdd
                : canCreateVerification(user?.role)
                  ? () => {
                      const gateMsg = verificationCreateGateBlockMessage(
                        rcHasWeightsCert,
                        rcHasVehicle,
                        gatesLoading,
                        gatesError,
                      );
                      if (gateMsg) setListError(gateMsg);
                      else if (
                        verificationRequiresMobileCapture(user?.role)
                        && !verificationCaptureAllowed
                      ) {
                        setListError(VERIFICATION_MOBILE_ONLY_NOTICE);
                      }
                    }
                  : undefined
            }
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
                    <Send size={16} /> {isVerifier ? 'Send to RC' : 'Submit for certification'}
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
                hideVctColumn={isFieldStaff}
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
                onApprove={isRcAdmin ? handleApproveVerifierWork : undefined}
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

      {showJobKindPicker && (
        <VerificationJobKindPicker
          ovBalanceQty={quotaSeats.ready ? quotaSeats.balanceQty : null}
          ovRemainingCount={quotaSeats.ready ? quotaSeats.remaining.length : undefined}
          pendingSerials={quotaSeats.remaining}
          onSelect={handleJobKindSelect}
          onClose={() => setShowJobKindPicker(false)}
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
