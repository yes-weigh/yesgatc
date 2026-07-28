const { FieldValue } = require('firebase-admin/firestore');

const COLLECTION = 'emaapOtpInbox';

const OTP_FOR_LOGIN = /(?:one[-\s]?time\s+password\s*\(?\s*OTP\s*\)?|OTP)\s+for\s+login\s+is\s*:?\s*(\d{6})/i;
const OTP_NEAR = /(?:otp|one[-\s]?time(?:\s+password)?|login\s+code)[^\d]{0,48}(\d{6})/i;
const OTP_SIX = /\b(\d{6})\b/g;

function extractOtp(text) {
  if (!text || typeof text !== 'string') return null;
  const a = text.match(OTP_FOR_LOGIN);
  if (a?.[1]) return a[1];
  const b = text.match(OTP_NEAR);
  if (b?.[1]) return b[1];
  const all = [...text.matchAll(OTP_SIX)].map(m => m[1]);
  return all.length ? all[all.length - 1] : null;
}

function readSecret(req) {
  const q = req.query?.secret || req.query?.key;
  if (q) return String(q);
  const h = req.get?.('x-emaap-otp-secret') || req.headers?.['x-emaap-otp-secret'];
  return h ? String(h) : '';
}

function parseInbound(req) {
  const body = req.body || {};
  // Generic JSON
  if (typeof body === 'object' && (body.text || body.code || body.otp || body['body-plain'])) {
    return {
      from: String(body.from || body.sender || body.From || ''),
      subject: String(body.subject || body.Subject || ''),
      text: String(
        body.text
          || body['body-plain']
          || body['stripped-text']
          || body.body
          || body.html
          || body['body-html']
          || '',
      ),
      codeHint: body.code || body.otp || null,
    };
  }

  // form-urlencoded / multipart fields (Mailgun style)
  const from = body.from || body.sender || '';
  const subject = body.subject || '';
  const text = body['body-plain'] || body['stripped-text'] || body.text || body['body-html'] || '';
  return { from: String(from), subject: String(subject), text: String(text), codeHint: null };
}

/**
 * HTTP webhook: inbound OTP email (or JSON) → Firestore emaapOtpInbox.
 *
 * Auth: ?secret=... or header x-emaap-otp-secret (Firebase secret EMAAP_OTP_WEBHOOK_SECRET).
 *
 * Setup (no Mailgun required):
 * 1. Deploy this function, set secret:
 *      firebase functions:secrets:set EMAAP_OTP_WEBHOOK_SECRET
 * 2. Gmail → filter from:ansibletest subject:"Your Login OTP"
 *    → forward to an address that POSTs here, OR use Apps Script (see file comment below).
 * 3. Worker polls emaapOtpInbox after Send OTP.
 *
 * Google Apps Script (run every 1 min on admin@yesweigh.in):
 *   const WEBHOOK = 'https://us-central1-yesgatc.cloudfunctions.net/emaapOtpWebhook?secret=YOUR_SECRET';
 *   function relayEmaapOtps() {
 *     const threads = GmailApp.search('from:ansibletest subject:"Your Login OTP" newer_than:1h');
 *     for (const t of threads) {
 *       for (const m of t.getMessages()) {
 *         if (m.getDate() < new Date(Date.now() - 3600e3)) continue;
 *         UrlFetchApp.fetch(WEBHOOK, {
 *           method: 'post',
 *           contentType: 'application/json',
 *           payload: JSON.stringify({
 *             from: m.getFrom(),
 *             subject: m.getSubject(),
 *             text: m.getPlainBody(),
 *           }),
 *         });
 *       }
 *     }
 *   }
 */
async function emaapOtpWebhookHandler(req, res, db, expectedSecret) {
  if (req.method === 'GET') {
    res.status(200).json({
      ok: true,
      service: 'emaapOtpWebhook',
      hint: 'POST email JSON { from, subject, text } or Mailgun fields with ?secret=',
    });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const secret = readSecret(req);
  if (!expectedSecret || secret !== expectedSecret) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  const parsed = parseInbound(req);
  const blob = [parsed.subject, parsed.from, parsed.text].join('\n');
  const code = (parsed.codeHint && /^\d{6}$/.test(String(parsed.codeHint))
    ? String(parsed.codeHint)
    : extractOtp(blob));

  if (!code) {
    res.status(422).json({ ok: false, error: 'no_otp_found', from: parsed.from, subject: parsed.subject });
    return;
  }

  // Dedupe same unused code (single-field query — no composite index).
  const recent = await db.collection(COLLECTION).where('code', '==', code).limit(8).get();
  const open = recent.docs.find(d => d.data()?.consumed === false);
  if (open) {
    res.status(200).json({ ok: true, deduped: true, code, id: open.id });
    return;
  }

  const ref = await db.collection(COLLECTION).add({
    code,
    from: parsed.from,
    subject: parsed.subject,
    snippet: parsed.text.slice(0, 500),
    consumed: false,
    consumedAt: null,
    receivedAt: FieldValue.serverTimestamp(),
    source: 'webhook',
  });

  res.status(200).json({ ok: true, code, id: ref.id });
}

module.exports = {
  emaapOtpWebhookHandler,
  extractOtp,
  COLLECTION,
};
