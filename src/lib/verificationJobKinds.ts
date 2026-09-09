export type VerificationJobKind = 'ov_self' | 'ov_customer' | 'rv_customer';

export const ALL_VERIFICATION_JOB_KINDS: VerificationJobKind[] = [
  'ov_self',
  'ov_customer',
  'rv_customer',
];

/** Verifier may start OV Self only. RC admin / VCT get all three kinds. */
export function verificationJobKindsForActor(verifierMode: boolean): VerificationJobKind[] {
  return verifierMode ? ['ov_self'] : ALL_VERIFICATION_JOB_KINDS;
}
