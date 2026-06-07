const crypto = require('crypto');
const { tryCompleteWalletTopUpFromWebhook } = require('./razorpayWallet');

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

function verifyWebhookSignature(rawBody, signature) {
  const { webhookSecret } = razorpayKeys();
  const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
  return expected === signature;
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
        await tryCompleteWalletTopUpFromWebhook(db, orderId, payment.id);
      }
    }

    res.status(200).send('ok');
  } catch (err) {
    console.error('razorpayWebhook failed', err);
    res.status(500).send('Webhook handler failed');
  }
}

module.exports = {
  razorpayWebhookHandler,
};
