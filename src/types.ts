// Core role type — stored directly in Firestore as-is
export type Role = 'super_admin' | 'rc_admin' | 'vct';

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  rc_admin: 'RC Admin',
  vct: 'VCT Technician',
};

export interface User {
  uid: string;
  email: string;
  username: string;
  role: Role;
  rcId?: string; // for vct: UID of their RC Admin; for rc_admin: their own UID
}

export interface Product {
  id: string; // The firestore ID
  modelid: string; // Unique Model ID
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
}

export type JobType = 'OV' | 'RV';
export type JobStatus = 'assigned' | 'pending_review' | 'completed';
export type PaymentStatus = 'not_required' | 'pending' | 'paid';
export type WorkflowMode = 'auto' | 'manual';

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
  email: string;
  role: Role;           // stored natively: 'super_admin' | 'rc_admin' | 'vct'
  username: string;
  createdAt: string;
  createdByUid?: string;
  clearTextPassword?: string;
  rcId?: string;        // VCT → UID of their RC Admin; RC Admin → their own UID
  workflowMode?: WorkflowMode; // VCT only — set by RC Admin (auto | manual)

  // RC Admin business profile fields
  companyName?: string; // e.g. "Meezan Electronic Scales Pvt Ltd"
  address?: string;     // full postal address
  gstNumber?: string;   // GSTIN
  phone?: string;       // primary contact number

  // VCT specific fields
  aadhar?: string;      // 12-digit Aadhar number
}

