const crypto = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');

function razorpayKeys() {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  /** From Razorpay Dashboard → Webhooks (only after you create a webhook). Falls back to API secret. */
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

async function markPaymentPaid(db, paymentId, patch = {}) {
  const ref = db.doc(`rvPayments/${paymentId}`);
  const snap = await ref.get();
  if (!snap.exists) return null;

  const data = snap.data();
  if (data.status === 'paid') {
    return data;
  }

  const paidAt = patch.paidAt || new Date().toISOString();
  await ref.set(
    {
      status: 'paid',
      paidAt,
      ...patch,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );

  const recordIds = Array.isArray(data.recordIds) ? data.recordIds : [];
  if (recordIds.length > 0) {
    const batch = db.batch();
    for (const recordId of recordIds) {
      batch.set(
        db.doc(`siteCalibrations/${recordId}`),
        {
          rvPaymentStatus: 'paid',
          rvPaymentId: paymentId,
          rvPaymentAmount: data.amountInr,
          rvPaidAt: paidAt,
        },
        { merge: true },
      );
    }
    await batch.commit();
  }

  return { ...data, status: 'paid', paidAt };
}

async function syncPaymentStatusFromRazorpay(db, paymentId) {
  const ref = db.doc(`rvPayments/${paymentId}`);
  const snap = await ref.get();
  if (!snap.exists) {
    return { status: 'unknown' };
  }

  const data = snap.data();
  if (data.status === 'paid') {
    return {
      status: 'paid',
      paidAt: data.paidAt,
      razorpayPaymentId: data.razorpayPaymentId,
    };
  }

  const razorpay = getRazorpayClient();

  if (data.qrId) {
    const qr = await razorpay.qrCode.fetch(data.qrId);
    const received = Number(qr.payments_amount_received || 0);
    const expected = Number(data.amountPaise || 0);
    if (received >= expected && expected > 0) {
      const paid = await markPaymentPaid(db, paymentId, {
        razorpayPaymentId: qr.payment_id || data.razorpayPaymentId || null,
        source: 'qr_poll',
      });
      return {
        status: 'paid',
        paidAt: paid?.paidAt,
        razorpayPaymentId: paid?.razorpayPaymentId,
      };
    }
  }

  if (data.orderId) {
    const payments = await razorpay.orders.fetchPayments(data.orderId);
    const captured = (payments.items || []).find(item => item.status === 'captured');
    if (captured) {
      const paid = await markPaymentPaid(db, paymentId, {
        razorpayPaymentId: captured.id,
        source: 'order_poll',
      });
      return {
        status: 'paid',
        paidAt: paid?.paidAt,
        razorpayPaymentId: paid?.razorpayPaymentId,
      };
    }
  }

  return { status: data.status || 'created' };
}

function verifyCheckoutSignature(orderId, paymentId, signature) {
  const { keySecret } = razorpayKeys();
  const payload = `${orderId}|${paymentId}`;
  const expected = crypto.createHmac('sha256', keySecret).update(payload).digest('hex');
  return expected === signature;
}

function verifyWebhookSignature(rawBody, signature) {
  const { webhookSecret } = razorpayKeys();
  const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
  return expected === signature;
}

function razorpayErrorMessage(err) {
  if (err?.error?.description) return String(err.error.description);
  if (err?.message) return String(err.message);
  return 'Razorpay request failed.';
}

async function assertSuperAdmin(db, uid) {
  const callerSnap = await db.doc(`users/${uid}`).get();
  if (!callerSnap.exists || callerSnap.data().role !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Super Admin only.');
  }
  return callerSnap.data();
}

async function assertRvPaymentCaller(request, db, rcId) {
  const callerSnap = await db.doc(`users/${request.auth.uid}`).get();
  if (!callerSnap.exists) {
    throw new HttpsError('permission-denied', 'User profile not found.');
  }

  const caller = callerSnap.data();
  const role = caller.role;

  if (role === 'super_admin') {
    return caller;
  }

  if (role === 'rc_admin') {
    if (request.auth.uid !== rcId) {
      throw new HttpsError('permission-denied', 'Cannot create payment for another RC.');
    }
    return caller;
  }

  if (role === 'vct') {
    if (caller.rcId !== rcId) {
      throw new HttpsError('permission-denied', 'Cannot create payment for another RC.');
    }
    const approvalStatus = caller.approvalStatus ?? 'approved';
    if (approvalStatus !== 'approved') {
      throw new HttpsError('permission-denied', 'VCT approval required before taking payments.');
    }
    if (caller.active === false) {
      throw new HttpsError('permission-denied', 'VCT account is inactive.');
    }
    return caller;
  }

  throw new HttpsError('permission-denied', 'RC or VCT access required.');
}

async function isRvRazorpayEnabled(db) {
  const snap = await db.doc('appSettings/global').get();
  if (!snap.exists) return false;
  return snap.data()?.rvRazorpayEnabled === true;
}

async function loadRvPaymentForCaller(request, db, paymentId) {
  const paymentSnap = await db.doc(`rvPayments/${paymentId}`).get();
  if (!paymentSnap.exists) {
    throw new HttpsError('not-found', 'Payment session not found.');
  }
  const payment = paymentSnap.data();
  await assertRvPaymentCaller(request, db, payment.rcId);
  return payment;
}

async function createRvPaymentOrderHandler(request, db) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }

  const testMode = request.data?.testMode === true;

  if (testMode) {
    await assertSuperAdmin(db, request.auth.uid);
  } else if (!(await isRvRazorpayEnabled(db))) {
    throw new HttpsError('failed-precondition', 'RV Razorpay payments are disabled.');
  }

  try {
  const amountInr = testMode ? 1 : Number(request.data?.amountInr);
  let rcId = typeof request.data?.rcId === 'string' ? request.data.rcId.trim() : '';
  if (testMode && !rcId) {
    rcId = request.auth.uid;
  }
  const recordIds = Array.isArray(request.data?.recordIds)
    ? request.data.recordIds.filter(id => typeof id === 'string' && id.trim())
    : [];
  const breakdown = request.data?.breakdown || null;

  if (!Number.isFinite(amountInr) || amountInr <= 0 || !Number.isInteger(amountInr)) {
    throw new HttpsError('invalid-argument', 'amountInr must be a positive whole rupee amount.');
  }
  if (!rcId) {
    throw new HttpsError('invalid-argument', 'rcId is required.');
  }

  await assertRvPaymentCaller(request, db, rcId);

  if (!razorpayConfigured()) {
    return {
      configured: false,
      paymentId: '',
      orderId: '',
      amountInr,
      amountPaise: amountInr * 100,
      keyId: '',
      qrImageUrl: null,
    };
  }

  const { keyId } = razorpayKeys();
  const razorpay = getRazorpayClient();
  const amountPaise = amountInr * 100;
  const receipt = testMode
    ? `test_${request.auth.uid.slice(0, 8)}_${Date.now()}`
    : `rv_${rcId.slice(0, 8)}_${Date.now()}`;

  const order = await razorpay.orders.create({
    amount: amountPaise,
    currency: 'INR',
    receipt,
    notes: {
      rcId,
      recordIds: JSON.stringify(recordIds),
      paymentType: testMode ? 'admin_gateway_test' : 'rv_admin_gst',
    },
  });

  let qrImageUrl = null;
  let qrId = null;
  try {
    const qr = await razorpay.qrCode.create({
      type: 'upi_qr',
      name: 'RV administrative fees + GST',
      usage: 'single_use',
      fixed_amount: true,
      payment_amount: amountPaise,
      description: testMode ? 'Razorpay gateway test' : 'RV verification payment',
      notes: {
        orderId: order.id,
        rcId,
      },
    });
    qrImageUrl = qr.image_url || null;
    qrId = qr.id || null;
  } catch (err) {
    console.warn('Razorpay QR create failed; checkout-only fallback.', err);
  }

  const paymentId = paymentDocId(order.id);
  await db.doc(`rvPayments/${paymentId}`).set({
    paymentId,
    orderId: order.id,
    qrId,
    qrImageUrl,
    amountInr,
    amountPaise,
    status: 'created',
    rcId,
    recordIds: testMode ? [] : recordIds,
    breakdown,
    test: testMode,
    createdBy: request.auth.uid,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  return {
    configured: true,
    paymentId,
    orderId: order.id,
    amountInr,
    amountPaise,
    keyId,
    qrImageUrl,
  };
  } catch (err) {
    console.error('createRvPaymentOrder failed', err);
    if (err instanceof HttpsError) throw err;
    throw new HttpsError('internal', razorpayErrorMessage(err));
  }
}

async function getRvPaymentStatusHandler(request, db) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }

  const paymentId = typeof request.data?.paymentId === 'string' ? request.data.paymentId.trim() : '';
  if (!paymentId) {
    throw new HttpsError('invalid-argument', 'paymentId is required.');
  }

  await loadRvPaymentForCaller(request, db, paymentId);

  if (!razorpayConfigured()) {
    return { status: 'unknown' };
  }

  return syncPaymentStatusFromRazorpay(db, paymentId);
}

async function verifyRvPaymentHandler(request, db) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }

  const paymentId = typeof request.data?.paymentId === 'string' ? request.data.paymentId.trim() : '';
  const razorpayOrderId = typeof request.data?.razorpayOrderId === 'string'
    ? request.data.razorpayOrderId.trim()
    : '';
  const razorpayPaymentId = typeof request.data?.razorpayPaymentId === 'string'
    ? request.data.razorpayPaymentId.trim()
    : '';
  const razorpaySignature = typeof request.data?.razorpaySignature === 'string'
    ? request.data.razorpaySignature.trim()
    : '';

  if (!paymentId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    throw new HttpsError('invalid-argument', 'Payment verification payload is incomplete.');
  }

  const payment = await loadRvPaymentForCaller(request, db, paymentId);
  if (payment.orderId !== razorpayOrderId) {
    throw new HttpsError('invalid-argument', 'Order mismatch.');
  }

  if (!verifyCheckoutSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
    throw new HttpsError('permission-denied', 'Invalid payment signature.');
  }

  await markPaymentPaid(db, paymentId, {
    razorpayPaymentId,
    source: 'checkout_verify',
  });

  return {
    status: 'paid',
    paidAt: new Date().toISOString(),
    razorpayPaymentId,
  };
}

async function razorpayWebhookHandler(req, res, db) {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  if (!razorpayConfigured()) {
    res.status(503).send('Razorpay not configured');
    return;
  }

  const signature = req.get('x-razorpay-signature');
  const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {});

  if (!signature || !verifyWebhookSignature(rawBody, signature)) {
    res.status(400).send('Invalid signature');
    return;
  }

  const event = req.body?.event;
  const payload = req.body?.payload || {};

  try {
    if (event === 'payment.captured') {
      const payment = payload.payment?.entity;
      const orderId = payment?.order_id;
      if (orderId) {
        await markPaymentPaid(db, paymentDocId(orderId), {
          razorpayPaymentId: payment.id,
          source: 'webhook_payment_captured',
        });
      }
    }

    if (event === 'qr_code.credited') {
      const qr = payload.qr_code?.entity;
      const payment = payload.payment?.entity;
      const orderId = qr?.notes?.orderId || payment?.order_id;
      if (orderId) {
        await markPaymentPaid(db, paymentDocId(orderId), {
          razorpayPaymentId: payment?.id || null,
          source: 'webhook_qr_credited',
        });
      }
    }

    res.status(200).send('ok');
  } catch (err) {
    console.error('razorpayWebhook failed', err);
    res.status(500).send('Webhook handler failed');
  }
}

module.exports = {
  createRvPaymentOrderHandler,
  getRvPaymentStatusHandler,
  verifyRvPaymentHandler,
  razorpayWebhookHandler,
};
