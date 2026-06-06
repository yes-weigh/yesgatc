const WALLET_UPI_PAY_PARAMS = {
  pa: '8803333444@okbizaxis',
  pn: 'Interweighing Pvt Ltd',
  mc: '5732',
  aid: 'uGICAgIDDr4C-GA',
  tr: 'BCR2DN6T7OC2FEBD',
  cu: 'INR',
} as const;

function formatUpiAmount(amountInr: number): string {
  const rounded = Math.round(amountInr * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2);
}

export function parseWalletTopUpAmountInput(value: string): number | null {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

/** Builds a UPI deep link that opens the RC's payment app with the entered amount. */
export function buildWalletUpiPayUrl(amountInr: number, note?: string): string {
  const params = new URLSearchParams({
    pa: WALLET_UPI_PAY_PARAMS.pa,
    pn: WALLET_UPI_PAY_PARAMS.pn,
    mc: WALLET_UPI_PAY_PARAMS.mc,
    aid: WALLET_UPI_PAY_PARAMS.aid,
    tr: WALLET_UPI_PAY_PARAMS.tr,
    am: formatUpiAmount(amountInr),
    cu: WALLET_UPI_PAY_PARAMS.cu,
  });

  const trimmedNote = note?.trim();
  if (trimmedNote) {
    params.set('tn', trimmedNote.slice(0, 80));
  }

  return `upi://pay?${params.toString()}`;
}
