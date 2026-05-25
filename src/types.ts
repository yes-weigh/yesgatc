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
export type JobStatus = 'assigned' | 'pending_review' | 'completed';
export type PaymentStatus = 'not_required' | 'pending' | 'paid';
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
  pincode?: string;
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
