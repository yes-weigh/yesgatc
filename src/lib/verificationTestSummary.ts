export type VerificationTestOutcome = 'PASS' | 'FAIL';

export type VerificationTestSummaryRow = {
  name: string;
  result: VerificationTestOutcome;
};

/** Standard metrological tests shown on certificate / evidence summary (matches DOCA form). */
export const VERIFICATION_TEST_SUMMARY_ROWS: readonly Omit<VerificationTestSummaryRow, 'result'>[] = [
  { name: 'Visual Examination' },
  { name: 'Zero Setting / Zero Tracking Test' },
  { name: 'Eccentricity Test' },
  { name: 'Repeatability Test' },
  { name: 'Accuracy / Weighing Performance Test' },
  { name: 'Tare Device Test' },
  { name: 'Overall Verification Result' },
];

export function buildDefaultVerificationTestSummary(
  outcome: VerificationTestOutcome = 'PASS',
): VerificationTestSummaryRow[] {
  return VERIFICATION_TEST_SUMMARY_ROWS.map(row => ({
    ...row,
    result: outcome,
  }));
}

export function formatVerificationSummaryDateTime(date = new Date()): string {
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export const DEFAULT_VERIFICATION_SUMMARY_REMARKS =
  'All metrological tests completed successfully.';

export const DEFAULT_VERIFICATION_SUMMARY_INFO =
  'All parameters are within permissible limits.';
