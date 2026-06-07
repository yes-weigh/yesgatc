const DEFAULT_RAZORPAY_SETTINGS = {
  walletRechargeMode: 'manual',
  razorpayServiceChargePercent: 2,
  razorpayMinWalletRechargeInr: 1,
  zohoRazorpayAccountId: '99381000005573106',
};

function normalizeZohoNumericId(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function normalizeWalletRechargeMode(value) {
  return value === 'razorpay' ? 'razorpay' : 'manual';
}

function clampServiceChargePercent(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_RAZORPAY_SETTINGS.razorpayServiceChargePercent;
  return Math.min(100, Math.max(0, Math.round(parsed * 100) / 100));
}

function clampMinWalletRechargeInr(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_RAZORPAY_SETTINGS.razorpayMinWalletRechargeInr;
  }
  return Math.floor(parsed);
}

function normalizeRazorpaySettings(data) {
  const source = data && typeof data === 'object' ? data : {};
  const accountId =
    normalizeZohoNumericId(source.zohoRazorpayAccountId)
    || DEFAULT_RAZORPAY_SETTINGS.zohoRazorpayAccountId;

  return {
    walletRechargeMode: normalizeWalletRechargeMode(source.walletRechargeMode),
    razorpayServiceChargePercent: clampServiceChargePercent(source.razorpayServiceChargePercent),
    razorpayMinWalletRechargeInr: clampMinWalletRechargeInr(source.razorpayMinWalletRechargeInr),
    zohoRazorpayAccountId: accountId,
  };
}

async function loadRazorpaySettings(db) {
  const snap = await db.doc('appSettings/global').get();
  return normalizeRazorpaySettings(snap.exists ? snap.data() : undefined);
}

function walletRechargeGrossInr(walletCreditInr, serviceChargePercent) {
  const credit = Math.floor(Number(walletCreditInr));
  if (credit < 1) return 0;
  const multiplier = 1 + clampServiceChargePercent(serviceChargePercent) / 100;
  return Math.round(credit * multiplier);
}

module.exports = {
  DEFAULT_RAZORPAY_SETTINGS,
  normalizeRazorpaySettings,
  loadRazorpaySettings,
  walletRechargeGrossInr,
};
