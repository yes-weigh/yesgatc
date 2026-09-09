export type VerifierOvInName = 'verifier' | 'rc';

export const VERIFIER_OV_IN_NAME_REQUIRED_MESSAGE =
  'RC admin must pick OV in verifier name or OV in RC name first.';

export const OV_IN_NAME_VERIFIER_FALLBACK = 'Verifier name';
export const OV_IN_NAME_RC_FALLBACK = 'RC name';

export function ovInNamePartyLabel(raw: string | undefined | null, fallback: string): string {
  const trimmed = raw?.trim();
  return trimmed ? trimmed.toUpperCase() : fallback;
}

/** Line-2 labels for the OV-in-name toggle. Verifier = Full name field; RC = companyName || username. */
export function ovInNameToggleLabels(
  verifierUsername?: string | null,
  rc?: { companyName?: string | null; username?: string | null } | string | null,
): { verifier: string; rc: string } {
  const rcRaw =
    typeof rc === 'string' ? rc : (rc?.companyName?.trim() || rc?.username?.trim() || '');
  return {
    verifier: ovInNamePartyLabel(verifierUsername, OV_IN_NAME_VERIFIER_FALLBACK),
    rc: ovInNamePartyLabel(rcRaw, OV_IN_NAME_RC_FALLBACK),
  };
}

export function isVerifierOvInName(value: unknown): value is VerifierOvInName {
  return value === 'verifier' || value === 'rc';
}

export function validateVerifierOvInName(value: unknown): string | null {
  if (isVerifierOvInName(value)) return null;
  return VERIFIER_OV_IN_NAME_REQUIRED_MESSAGE;
}

/** Block this verifier from starting OV until RC sets ovInName. */
export function validateVerifierOvStart(ovInName: unknown): string | null {
  return validateVerifierOvInName(ovInName);
}

export function verifierOvParty(
  ovInName: VerifierOvInName,
  verifier: { uid: string; username?: string },
  rc: { uid: string; companyName?: string; username?: string },
): { customerId: string; customerName: string } {
  if (ovInName === 'verifier') {
    return {
      customerId: verifier.uid,
      customerName: verifier.username?.trim() || 'Verifier',
    };
  }
  return {
    customerId: rc.uid,
    customerName: rc.companyName?.trim() || rc.username?.trim() || '',
  };
}
