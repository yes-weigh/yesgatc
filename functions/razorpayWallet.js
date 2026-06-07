const crypto = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { loadRazorpaySettings, walletRechargeGrossInr } = require('./razorpaySettings');
const { processWalletTopUpZohoTransfer } = require('./zohoWallet');

function razorpayKeys() {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim() || keySecret;
  return { keyId, keySecret, webhookSecret };
}

function razorpayConfigured() {
  const { keyId, keySecret } = razorpayKeys();
  return Boolean(keyId && keySecret);
}

function getRazorpayClient() {
  const { keyId, keySecret } = razorpayKeys();
  if (!keyId || !keySecret) {
    throw new HttpsError('failed-precondition', 'Razorpay is not configured on the server.');
  }
  // eslint-disable-next-line global-require
  const Razorpay = require('razorpay');
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

function paymentDocId(orderId) {
  return orderId;
}

function roundInr(value) {
  return Math.round(Number(value) * 100) / 100;
}

function walletRef(db, rcId) {
  return db.doc(`rcWallets/${rcId}`);
}

function topUpRef(db, topUpId) {
  return db.doc(`walletTopUps/${topUpId}`);
}

function ledgerRef(db, ledgerId) {
  return db.doc(`walletLedger/${ledgerId}`);
}

function verifyCheckoutSignature(orderId, paymentId, signature) {
  const { keySecret } = razorpayKeys();
  const payload = `${orderId}|${paymentId}`;
  const expected = crypto.createHmac('sha256', keySecret).update(payload).digest('hex');
  return expected === signature;
}

async function assertSuperAdmin(db, uid) {
  const snap = await db.doc(`users/${uid}`).get();
  if (!snap.exists || snap.data().role !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Super Admin only.');
  }
}

async function resolveWalletRcId(db, uid, { allowSuperAdmin = false } = {}) {
  const callerSnap = await db.doc(`users/${uid}`).get();
  if (!callerSnap.exists) {
    throw new HttpsError('permission-denied', 'User profile not found.');
  }

  const caller = callerSnap.data();
  if (allowSuperAdmin && caller.role === 'super_admin') {
    return uid;
  }

  if (caller.role === 'rc_admin') {
    return uid;
  }

  if (caller.role === 'vct') {
    if (typeof caller.rcId !== 'string' || !caller.rcId.trim()) {
      throw new HttpsError('failed-precondition', 'VCT is not linked to an RC centre.');
    }
    return caller.rcId.trim();
  }

  throw new HttpsError('permission-denied', 'RC or VCT access required.');
}

async function assertRcWalletAccess(db, uid, rcId) {
  if (!rcId || typeof rcId !== 'string') {
    throw new HttpsError('invalid-argument', 'rcId is required.');
  }

  const callerSnap = await db.doc(`users/${uid}`).get();
  if (!callerSnap.exists) {
    throw new HttpsError('permission-denied', 'User profile not found.');
  }

  const caller = callerSnap.data();
  if (caller.role === 'super_admin') {
    return caller;
  }

  if (caller.role === 'rc_admin') {
    if (uid !== rcId) {
      throw new HttpsError('permission-denied', 'Cannot use wallet for another RC.');
    }
    return caller;
  }

  if (caller.role === 'vct') {
    if (caller.rcId !== rcId) {
      throw new HttpsError('permission-denied', 'Cannot use wallet for another RC.');
    }
    const approvalStatus = caller.approvalStatus ?? 'approved';
    if (approvalStatus !== 'approved') {
      throw new HttpsError('permission-denied', 'VCT approval required before wallet recharge.');
    }
    if (caller.active === false) {
      throw new HttpsError('permission-denied', 'VCT account is inactive.');
    }
    return caller;
  }

  throw new HttpsError('permission-denied', 'RC or VCT access required.');
}

async function assertRazorpayWalletRechargeEnabled(db) {
  const settings = await loadRazorpaySettings(db);
  if (settings.walletRechargeMode !== 'razorpay') {
    throw new HttpsError(
      'failed-precondition',
      'Wallet recharge via Razorpay is disabled. Use manual top-up or ask Super Admin to enable Razorpay mode.',
    );
  }
  return settings;
}

async function creditWalletTopUpFromRazorpay(db, session, patch = {}) {
  const orderId = session.orderId;
  const paymentRef = db.doc(`walletTopUpPayments/${paymentDocId(orderId)}`);

  if (session.test === true) {
    const paidAt = patch.paidAt || new Date().toISOString();
    await paymentRef.set(
      {
        status: 'paid',
        paidAt,
        razorpayPaymentId: patch.razorpayPaymentId || null,
        source: patch.source || 'gateway_test',
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
    return { topUpId: null, balanceInr: 0, test: true };
  }

  if (session.status === 'paid' && session.topUpId) {
    const existingTopUp = await topUpRef(db, session.topUpId).get();
    if (existingTopUp.exists && existingTopUp.data().status === 'approved') {
      return {
        topUpId: session.topUpId,
        balanceInr: Number(existingTopUp.data().amountInr) || session.walletCreditInr,
        alreadyCompleted: true,
      };
    }
  }

  const topUpId = session.topUpId || crypto.randomUUID();
  const paidAt = patch.paidAt || new Date().toISOString();
  const rcId = session.rcId;
  const walletCreditInr = roundInr(session.walletCreditInr);
  const grossAmountInr = roundInr(session.grossAmountInr);

  const result = await db.runTransaction(async transaction => {
    const paymentSnap = await transaction.get(paymentRef);
    if (!paymentSnap.exists) {
      throw new HttpsError('not-found', 'Wallet payment session not found.');
    }

    const paymentData = paymentSnap.data();
    if (paymentData.status === 'paid' && paymentData.topUpId) {
      const topUpSnap = await transaction.get(topUpRef(db, paymentData.topUpId));
      if (topUpSnap.exists && topUpSnap.data().status === 'approved') {
        const walletSnap = await transaction.get(walletRef(db, rcId));
        return {
          topUpId: paymentData.topUpId,
          balanceInr: walletSnap.exists ? Number(walletSnap.data().balanceInr) || 0 : 0,
          alreadyCompleted: true,
        };
      }
    }

    const walletSnap = await transaction.get(walletRef(db, rcId));
    const currentBalance = walletSnap.exists ? Number(walletSnap.data().balanceInr) || 0 : 0;
    const nextBalance = roundInr(currentBalance + walletCreditInr);

    transaction.set(
      walletRef(db, rcId),
      {
        rcId,
        balanceInr: nextBalance,
        updatedAt: paidAt,
      },
      { merge: true },
    );

    transaction.set(
      topUpRef(db, topUpId),
      {
        rcId,
        rcCompanyName: session.rcCompanyName || '',
        amountInr: walletCreditInr,
        grossAmountInr,
        status: 'approved',
        rechargeMethod: 'razorpay',
        razorpayOrderId: orderId,
        razorpayPaymentId: patch.razorpayPaymentId || paymentData.razorpayPaymentId || null,
        note: session.note || '',
        submittedAt: session.createdAt || paidAt,
        submittedByUid: session.createdBy || '',
        reviewedAt: paidAt,
        reviewedByUid: session.createdBy || 'system:razorpay',
        paidAt,
      },
      { merge: true },
    );

    transaction.set(ledgerRef(db, `topup-${topUpId}`), {
      rcId,
      type: 'top_up_credit',
      topUpId,
      amountInr: walletCreditInr,
      balanceAfterInr: nextBalance,
      status: 'completed',
      createdAt: paidAt,
      createdByUid: session.createdBy || 'system:razorpay',
    });

    transaction.set(
      paymentRef,
      {
        status: 'paid',
        paidAt,
        topUpId,
        razorpayPaymentId: patch.razorpayPaymentId || paymentData.razorpayPaymentId || null,
        source: patch.source || paymentData.source || 'unknown',
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );

    return {
      topUpId,
      balanceInr: nextBalance,
      topUp: {
        rcId,
        rcCompanyName: session.rcCompanyName || '',
        amountInr: walletCreditInr,
        grossAmountInr,
        status: 'approved',
        rechargeMethod: 'razorpay',
        razorpayOrderId: orderId,
        note: session.note || '',
        submittedAt: session.createdAt || paidAt,
        reviewedAt: paidAt,
        reviewedByUid: session.createdBy || 'system:razorpay',
      },
    };
  });

  if (!result.alreadyCompleted && result.topUp) {
    await processWalletTopUpZohoTransfer(db, result.topUpId, result.topUp);
  }

  return result;
}

async function syncWalletTopUpPaymentStatus(db, orderId) {
  const paymentRef = db.doc(`walletTopUpPayments/${paymentDocId(orderId)}`);
  const snap = await paymentRef.get();
  if (!snap.exists) {
    return { status: 'unknown' };
  }

  const session = snap.data();
  if (session.status === 'paid') {
    return {
      status: 'paid',
      paidAt: session.paidAt,
      topUpId: session.topUpId,
      balanceInr: session.balanceInr,
      razorpayPaymentId: session.razorpayPaymentId,
    };
  }

  const razorpay = getRazorpayClient();
  const payments = await razorpay.orders.fetchPayments(orderId);
  const captured = (payments.items || []).find(item => item.status === 'captured');
  if (captured) {
    const result = await creditWalletTopUpFromRazorpay(db, session, {
      razorpayPaymentId: captured.id,
      paidAt: new Date().toISOString(),
      source: 'order_poll',
    });
    return {
      status: 'paid',
      paidAt: new Date().toISOString(),
      topUpId: result.topUpId,
      balanceInr: result.balanceInr,
      razorpayPaymentId: captured.id,
    };
  }

  return { status: session.status || 'created' };
}

async function tryCompleteWalletTopUpFromWebhook(db, orderId, razorpayPaymentId) {
  const paymentRef = db.doc(`walletTopUpPayments/${paymentDocId(orderId)}`);
  const snap = await paymentRef.get();
  if (!snap.exists) {
    return false;
  }

  await creditWalletTopUpFromRazorpay(db, snap.data(), {
    razorpayPaymentId: razorpayPaymentId || null,
    paidAt: new Date().toISOString(),
    source: 'webhook_payment_captured',
  });
  return true;
}

async function createWalletTopUpOrderHandler(request, db) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }

  const testMode = request.data?.testMode === true;
  const settings = testMode
    ? await loadRazorpaySettings(db)
    : await assertRazorpayWalletRechargeEnabled(db);

  const walletCreditInr = testMode
    ? 1
    : Math.floor(Number(request.data?.walletCreditInr));
  const note = typeof request.data?.note === 'string' ? request.data.note.trim() : '';

  if (!testMode && (!Number.isFinite(walletCreditInr) || walletCreditInr < settings.razorpayMinWalletRechargeInr)) {
    throw new HttpsError(
      'invalid-argument',
      `Wallet credit must be at least ₹${settings.razorpayMinWalletRechargeInr}.`,
    );
  }

  const uid = request.auth.uid;
  if (testMode) {
    await assertSuperAdmin(db, uid);
  }

  const rcId = await resolveWalletRcId(db, uid, { allowSuperAdmin: testMode });
  if (!testMode) {
    await assertRcWalletAccess(db, uid, rcId);
  }

  if (!razorpayConfigured()) {
    return {
      configured: false,
      orderId: '',
      walletCreditInr,
      grossAmountInr: walletRechargeGrossInr(walletCreditInr, settings.razorpayServiceChargePercent),
      amountPaise: 0,
      keyId: '',
    };
  }

  const grossAmountInr = testMode
    ? 1
    : walletRechargeGrossInr(walletCreditInr, settings.razorpayServiceChargePercent);
  const { keyId } = razorpayKeys();
  const razorpay = getRazorpayClient();
  const amountPaise = grossAmountInr * 100;
  const receipt = testMode
    ? `test_${uid.slice(0, 8)}_${Date.now()}`
    : `wallet_${rcId.slice(0, 8)}_${Date.now()}`;

  const rcProfileSnap = await db.doc(`users/${rcId}`).get();
  const rcProfile = rcProfileSnap.exists ? rcProfileSnap.data() : {};

  const order = await razorpay.orders.create({
    amount: amountPaise,
    currency: 'INR',
    receipt,
    notes: {
      rcId,
      paymentType: testMode ? 'gateway_test' : 'wallet_topup',
      walletCreditInr: String(walletCreditInr),
    },
  });

  const orderId = order.id;
  await db.doc(`walletTopUpPayments/${paymentDocId(orderId)}`).set({
    orderId,
    status: 'created',
    rcId,
    rcCompanyName: rcProfile.companyName?.trim() || rcProfile.username?.trim() || '',
    walletCreditInr,
    grossAmountInr,
    amountPaise,
    serviceChargePercent: settings.razorpayServiceChargePercent,
    note,
    test: testMode,
    createdBy: uid,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  return {
    configured: true,
    orderId,
    walletCreditInr,
    grossAmountInr,
    amountPaise,
    keyId,
    serviceChargePercent: settings.razorpayServiceChargePercent,
  };
}

async function getWalletTopUpPaymentStatusHandler(request, db) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }

  const orderId = typeof request.data?.orderId === 'string' ? request.data.orderId.trim() : '';
  if (!orderId) {
    throw new HttpsError('invalid-argument', 'orderId is required.');
  }

  const paymentSnap = await db.doc(`walletTopUpPayments/${paymentDocId(orderId)}`).get();
  if (!paymentSnap.exists) {
    throw new HttpsError('not-found', 'Wallet payment session not found.');
  }

  const session = paymentSnap.data();
  await assertRcWalletAccess(db, request.auth.uid, session.rcId);

  if (!razorpayConfigured()) {
    return { status: 'unknown' };
  }

  return syncWalletTopUpPaymentStatus(db, orderId);
}

async function verifyWalletTopUpPaymentHandler(request, db) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }

  const orderId = typeof request.data?.orderId === 'string' ? request.data.orderId.trim() : '';
  const razorpayOrderId = typeof request.data?.razorpayOrderId === 'string'
    ? request.data.razorpayOrderId.trim()
    : '';
  const razorpayPaymentId = typeof request.data?.razorpayPaymentId === 'string'
    ? request.data.razorpayPaymentId.trim()
    : '';
  const razorpaySignature = typeof request.data?.razorpaySignature === 'string'
    ? request.data.razorpaySignature.trim()
    : '';

  if (!orderId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    throw new HttpsError('invalid-argument', 'Payment verification payload is incomplete.');
  }

  if (orderId !== razorpayOrderId) {
    throw new HttpsError('invalid-argument', 'Order mismatch.');
  }

  const paymentSnap = await db.doc(`walletTopUpPayments/${paymentDocId(orderId)}`).get();
  if (!paymentSnap.exists) {
    throw new HttpsError('not-found', 'Wallet payment session not found.');
  }

  const session = paymentSnap.data();
  await assertRcWalletAccess(db, request.auth.uid, session.rcId);

  if (!verifyCheckoutSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
    throw new HttpsError('permission-denied', 'Invalid payment signature.');
  }

  const result = await creditWalletTopUpFromRazorpay(db, session, {
    razorpayPaymentId,
    paidAt: new Date().toISOString(),
    source: 'checkout_verify',
  });

  return {
    status: 'paid',
    paidAt: new Date().toISOString(),
    topUpId: result.topUpId,
    balanceInr: result.balanceInr,
    razorpayPaymentId,
  };
}

module.exports = {
  createWalletTopUpOrderHandler,
  getWalletTopUpPaymentStatusHandler,
  verifyWalletTopUpPaymentHandler,
  tryCompleteWalletTopUpFromWebhook,
};
