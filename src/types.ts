// Core role type — stored directly in Firestore as-is
export type Role = 'super_admin' | 'rc_admin' | 'vct';

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  rc_admin: 'RC Admin',
  vct: 'VCT Technician',
};

export interface User {
  uid: string;
  aadhar: string;       // login ID only
  username: string;
  role: Role;
  rcId?: string;        // for vct: UID of their RC Admin; for rc_admin: their own UID
  email?: string;       // contact / business (not auth)
  phone?: string;       // contact / business (not auth)
}

export interface Product {
  id: string; // The firestore ID
  modelid: string; // Unique Model ID
  modelNo: string;
  name: string;
  typeOfInstrument: string;
  manufacturerBrandSeries: string;
  accuracyClass: string;
  maximumCapacity: number;
  minimumCapacity: number;
  verificationScaleInterval: number;
  unitOfMeasurement: 'kg' | 'g';
  actualScaleInterval: number;
  noOfVerificationIntervals: number;
  maximumPermissibleError: number;
  supplyVoltage: string;
  modelApprovalNo: string;
  modelApprovalDocUrl?: string;
  modelApprovalDocPath?: string;
  modelApprovalDocName?: string;
  modelApprovalDocContentType?: string;
  productImageUrl?: string;
  productImagePath?: string;
  productImageName?: string;
  productImageContentType?: string;
  /** Set when Super Admin creates the product; RC users only see admin-managed products. */
  managedByRole?: Role;
  managedByUid?: string;
  managedAt?: string;
}

export type JobType = 'OV' | 'RV';
/** Where verification was performed for a device. */
export type VerificationLocation = 'in_situ' | 'in_premises';

/**
 * Verification request lifecycle — client may create/edit draft and submit.
 * Only the certificate server (Admin SDK) should set `approved` and certificate fields.
 */
export type VerificationRequestStatus = 'draft' | 'submitted' | 'approved' | 'certified';

/** Who performed the verification in the field. */
export type VerificationPerformedBy = 'rc' | 'vct';

/**
 * How the request entered the pipeline (for the certificate server).
 * - rc_direct: RC entered verification directly
 * - vct_manual: VCT job approved by RC before certificate generation
 * - vct_auto: VCT with auto-approval workflow
 */
export type VerificationRequestSource = 'rc_direct' | 'vct_manual' | 'vct_auto';

export type JobStatus = 'assigned' | 'pending_review' | 'completed';
export type PaymentStatus = 'not_required' | 'pending' | 'paid';
export type WalletTopUpStatus = 'pending' | 'approved' | 'rejected';

/** RC prepaid balance — topped up via manual payment screenshots approved by Super Admin. */
export interface RcWallet {
  rcId: string;
  balanceInr: number;
  updatedAt: string;
}

export interface WalletTopUp {
  id: string;
  rcId: string;
  rcCompanyName?: string;
  amountInr: number;
  status: WalletTopUpStatus;
  screenshotUrl?: string;
  screenshotPath?: string;
  screenshotName?: string;
  screenshotContentType?: string;
  note?: string;
  submittedAt: string;
  submittedByUid: string;
  reviewedAt?: string;
  reviewedByUid?: string;
  rejectionReason?: string;
  /** Zoho Books transfer_fund GATC Wallet → Kotak on Super Admin approval. */
  zohoTransferStatus?: 'completed' | 'failed';
  zohoTransactionId?: string;
  zohoFromAccountName?: string;
  zohoToAccountName?: string;
  zohoReferenceNumber?: string;
  zohoTransferDescription?: string;
  zohoTransferError?: string;
  zohoTransferredAt?: string;
  /** YYYY-MM-DD sent to Zoho — wallet approval date (IST). */
  zohoTransferDate?: string;
}

export type WalletLedgerEntryType = 'top_up_credit' | 'rv_payment' | 'rv_refund';

export interface WalletLedgerEntry {
  id: string;
  rcId: string;
  type: WalletLedgerEntryType;
  amountInr: number;
  balanceAfterInr: number;
  status?: 'completed' | 'refunded';
  topUpId?: string;
  recordIds?: string[];
  relatedPaymentId?: string;
  refundReason?: string;
  createdAt: string;
  createdByUid?: string;
}

export type WorkflowMode = 'auto' | 'manual';
export type VctApprovalStatus = 'pending' | 'approved';

export type VehicleApprovalStatus = VctApprovalStatus;

export interface TechnicalData {
  mfgYear: string;
  maxError: string;
  sealId: string;
  photos: string[];
}

export interface Job {
  id: string;
  customer: string;
  product: string;
  serial: string;
  jobType: JobType;
  status: JobStatus;
  assignedTo: string;
  technicalData: TechnicalData | null;
  photos: string[];
  paymentStatus: PaymentStatus;
  rcWorkflowMode: WorkflowMode;
  rcApproved: boolean;
  createdAt: string;
  completedAt?: string;
  createdByUid?: string;
}

export interface Certificate {
  id: string;
  jobId: string;
  issuedAt: string;
  assignedTo?: string;
}

// Shape of a document in the Firestore `users` collection
export interface FirestoreUserDoc {
  aadhar: string;       // 12-digit login ID (unique across all users)
  role: Role;
  username: string;
  createdAt: string;
  createdByUid?: string;
  clearTextPassword?: string; // admin password reveal / reset helper
  rcId?: string;        // VCT → UID of their RC Admin; RC Admin → their own UID
  workflowMode?: WorkflowMode; // VCT only — set by RC Admin (auto | manual)

  // VCT profile — managed by RC Admin (address & phone shared with RC contact fields above)
  /** Postal code — VCT address; RC centre PIN for self-verification weather prefill. */
  pincode?: string;
  /** VCT biodata — standard ABO/Rh grouping. */
  bloodGroup?: string;
  policeStation?: string;
  secondaryContactName?: string;
  secondaryContactRelationship?: string;
  secondaryContactPhone?: string;
  biodataDocUrl?: string;
  biodataDocPath?: string;
  biodataDocName?: string;
  biodataDocContentType?: string;
  aadharDocUrl?: string;
  aadharDocPath?: string;
  aadharDocName?: string;
  aadharDocContentType?: string;
  educationCertDocUrl?: string;
  educationCertDocPath?: string;
  educationCertDocName?: string;
  educationCertDocContentType?: string;
  pccDocUrl?: string;
  pccDocPath?: string;
  pccDocName?: string;
  pccDocContentType?: string;
  profilePhotoUrl?: string;
  profilePhotoPath?: string;
  profilePhotoName?: string;
  profilePhotoContentType?: string;
  /** RC-created VCTs start as pending until Super Admin approves. */
  approvalStatus?: VctApprovalStatus;
  approvedAt?: string;
  approvedByUid?: string;
  /** RC can disable approved VCTs; omitted or true means enabled. */
  active?: boolean;
  deactivatedAt?: string;
  deactivatedByUid?: string;

  // Contact (not used for login)
  email?: string;
  phone?: string;
  address?: string;

  // RC Admin business profile fields
  companyName?: string;
  contactPerson?: string;
  place?: string;
  /** RC centre GPS — used for weather prefill on self verifications. */
  location?: CustomerLocation;
  gstNumber?: string;
  standardWeightsCertUrl?: string;
  standardWeightsCertPath?: string;
  standardWeightsCertName?: string;
  standardWeightsCertContentType?: string;
  standardWeightsCertNumber?: string;
  standardWeightsCertDate?: string; // YYYY-MM-DD
  standardWeightsCertExpiry?: string; // YYYY-MM-DD, cert date + 1 year (due date)
  sealUrl?: string;
  sealPath?: string;
  sealName?: string;
  sealContentType?: string;
  /** RC laboratory seal ID — prefilled on verification devices (default IND/KL/26/04/B26). */
  laboratorySealIdentification?: string;
  /** RC verification fee amounts by weight tier and location (in premise / in situ). */
  feesStructure?: RcFeesStructure;
  /** Super Admin only — 3-letter code used in DOCA remarks (e.g. Original verification by ABC). */
  rcCode?: string;
  /** Super Admin only — Zoho Books customer / contact ID for RV invoicing. */
  zohoId?: string;
}

/** Verification fees for a weight tier (amounts in INR). */
export interface RcFeeTierAmounts {
  inPremise: number;
  inSitu: number;
  self: number;
}

/** Default fee tiers: up to 20 kg and above 20 kg up to 150 kg. */
export interface RcFeesStructure {
  tierUpto20Kg: RcFeeTierAmounts;
  tierUpto150Kg: RcFeeTierAmounts;
}

/** RC-managed vehicle record (Firestore `vehicles` collection). */
export interface Vehicle {
  id: string;
  rcId: string;
  brand: string;
  model: string;
  year: string;
  regNumber: string;
  rcValidity: string;
  insuranceValidity: string;
  pollutionValidity: string;
  f2WeightValidity: string;
  rcDocUrl?: string;
  rcDocPath?: string;
  rcDocName?: string;
  rcDocContentType?: string;
  insuranceDocUrl?: string;
  insuranceDocPath?: string;
  insuranceDocName?: string;
  insuranceDocContentType?: string;
  pollutionDocUrl?: string;
  pollutionDocPath?: string;
  pollutionDocName?: string;
  pollutionDocContentType?: string;
  f2WeightDocUrl?: string;
  f2WeightDocPath?: string;
  f2WeightDocName?: string;
  f2WeightDocContentType?: string;
  vehiclePhotoUrl?: string;
  vehiclePhotoPath?: string;
  vehiclePhotoName?: string;
  vehiclePhotoContentType?: string;
  /** Legacy approval fields; new RC vehicles are active immediately without admin approval. */
  approvalStatus?: VehicleApprovalStatus;
  approvedAt?: string;
  approvedByUid?: string;
  /** RC or Super Admin can deactivate; omitted or true means active. */
  active?: boolean;
  deactivatedAt?: string;
  deactivatedByUid?: string;
  createdAt: string;
  createdByUid?: string;
}

export interface CustomerLocation {
  lat: number;
  lng: number;
}

export interface CustomerDevice {
  id: string;
  serialNumber: string;
  productId?: string;
  productName: string;
  imageUrl?: string;
  imagePath?: string;
  imageName?: string;
  imageContentType?: string;
}

/** RC-managed customer (Firestore `customers` collection). */
export interface Customer {
  id: string;
  rcId: string;
  name: string;
  phone: string;
  email?: string;
  address: string;
  pincode?: string;
  state?: string;
  district?: string;
  location?: CustomerLocation;
  shopPhotoUrl?: string;
  shopPhotoPath?: string;
  shopPhotoName?: string;
  shopPhotoContentType?: string;
  /** @deprecated use shopPhotoUrl — kept for older records */
  customerPhotoUrl?: string;
  customerPhotoPath?: string;
  customerPhotoName?: string;
  customerPhotoContentType?: string;
  devices?: CustomerDevice[];
  createdAt: string;
  createdByUid?: string;
  updatedAt?: string;
}

/** RC site calibration intake record (Firestore `siteCalibrations` collection). */
export interface SiteCalibration {
  id: string;
  rcId: string;
  verificationType: JobType;
  customerId: string;
  customerName: string;
  /** Links to customer device when verified from registered devices. */
  deviceId?: string;
  productId: string;
  productName: string;
  serialNumber: string;
  /** Product snapshot for table display and certificate server. */
  maximumCapacity?: number;
  verificationScaleInterval?: number;
  unitOfMeasurement?: 'kg' | 'g';
  /** MPE for this calibration; may differ from the product default. */
  maximumPermissibleError?: number;
  ambientTemperature: string;
  relativeHumidity: string;
  sealIdentificationNumber: string;
  /** In situ vs in the premises — once per verification session. */
  verificationLocation?: VerificationLocation;
  /** Self (RC centre) vs customer verification. */
  verificationSubject?: 'self' | 'customer';
  /** Request workflow — omitted on legacy records (treated as draft). */
  status?: VerificationRequestStatus;
  submittedAt?: string;
  approvedAt?: string;
  /** Set when the signed certificate is uploaded to DOCA. */
  certifiedAt?: string;
  /** Filled by certificate server when approved. */
  certificateNumber?: string;
  /** Internal application reference — e.g. VC/26/1. Assigned at draft creation. */
  applicationNumber?: string;
  /** Fee breakdown for DOCA Verification & Charges (INR, whole rupees). */
  verificationFeeBase?: number;
  verificationFeeGst?: number;
  /** Verification fee incl. 18% GST — filled on DOCA as Verification Fee and Total deposited. */
  verificationFeeTotal?: number;
  /** RV service fee (INR) — app-only; stored on Firebase, not used by certificate worker / DOCA. */
  serviceFee?: number;
  /** RV additional fee (INR) — app-only; stored on Firebase, not used by certificate worker / DOCA. */
  additionalFee?: number;
  /** RV Razorpay payment for administrative fees + GST. */
  rvPaymentStatus?: 'not_required' | 'pending' | 'paid';
  rvPaymentId?: string;
  rvPaymentAmount?: number;
  rvPaidAt?: string;
  /** Zoho Books invoice — written by Cloud Function on RV submit. */
  zohoInvoiceId?: string;
  zohoInvoiceNumber?: string;
  zohoInvoiceStatus?: string;
  zohoCustomerId?: string;
  zohoCustomerName?: string;
  zohoInvoiceTotal?: number;
  zohoOrganizationId?: string;
  zohoPushStatus?: 'pending' | 'sent' | 'failed' | 'skipped';
  zohoPushedAt?: string;
  zohoPushError?: string;
  /** Stored for future DOCA automation; worker currently submits 0. */
  carriageConveyanceFee?: number;
  totalDeposited?: number;
  /** Super Admin resubmit — links to the source document when this is a DOCA re-run. */
  resubmittedFromId?: string;
  /** Shared id for all versions of the same serial resubmission chain. */
  resubmissionRootId?: string;
  resubmissionOrdinal?: number;
  resubmittedByUid?: string;
  resubmittedAt?: string;
  /** Set on the original when a resubmission was queued. */
  certificateQuality?: 'corrupted_qr';
  supersededByResubmissionId?: string;
  /** Admin void or auto-void when a resubmission certifies — invalidates this certificate in the app. */
  certificateVoidedAt?: string;
  certificateVoidedByUid?: string;
  certificateVoidReason?: 'admin' | 'resubmit_superseded';
  /** Set by certificate worker when DOCA pipeline fails at a known phase. */
  pipelineFailedPhase?: 'submit' | 'certification';
  pipelineFailureMessage?: string;
  pipelineFailedAt?: string;
  certificatePdfUrl?: string;
  certificatePdfPath?: string;
  certificatePdfName?: string;
  certificatePdfContentType?: string;
  /** VCT display — RC direct verifications use performedBy `rc` (shown as Self). */
  performedBy?: VerificationPerformedBy;
  vctId?: string;
  vctName?: string;
  requestSource?: VerificationRequestSource;
  /** Optional link to a VCT job when request originates from the job queue. */
  jobId?: string;
  scaleImageUrl?: string;
  scaleImagePath?: string;
  scaleImageName?: string;
  scaleImageContentType?: string;
  /** Re-verification only — rear view of the instrument. */
  instrumentRearImageUrl?: string;
  instrumentRearImagePath?: string;
  instrumentRearImageName?: string;
  instrumentRearImageContentType?: string;
  stampingImageUrl?: string;
  stampingImagePath?: string;
  stampingImageName?: string;
  stampingImageContentType?: string;
  standardWeightImageUrl?: string;
  standardWeightImagePath?: string;
  standardWeightImageName?: string;
  standardWeightImageContentType?: string;
  verificationSealImageUrl?: string;
  verificationSealImagePath?: string;
  verificationSealImageName?: string;
  verificationSealImageContentType?: string;
  installationImageUrl?: string;
  installationImagePath?: string;
  installationImageName?: string;
  installationImageContentType?: string;
  /** Re-verification only — year the device was manufactured. */
  manufacturingYear?: number;
  oldVerificationCertificateUrl?: string;
  oldVerificationCertificatePath?: string;
  oldVerificationCertificateName?: string;
  oldVerificationCertificateContentType?: string;
  oldInvoiceUrl?: string;
  oldInvoicePath?: string;
  oldInvoiceName?: string;
  oldInvoiceContentType?: string;
  createdAt: string;
  createdByUid?: string;
  updatedAt?: string;
}
