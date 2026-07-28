/**
 * Bind to the Gmail that receives eMAAP OTPs.
 * Triggers → Add Trigger → relayEmaapOtps → Time-driven → Every minute.
 *
 * Posts ONLY the newest OTP mail in the last 15 minutes (avoids flooding old codes).
 * Encode @ in secret as %40.
 */
const WEBHOOK =
  'https://us-central1-yesgatc.cloudfunctions.net/emaapOtpWebhook?secret=Yesweigh%402026';

function relayEmaapOtps() {
  const threads = GmailApp.search(
    'from:ansibletest@nic.in subject:"Your Login OTP" newer_than:1h',
  );
  const cutoffMs = Date.now() - 15 * 60 * 1000;

  let newest = null;
  for (const t of threads) {
    for (const m of t.getMessages()) {
      const ts = m.getDate().getTime();
      if (ts < cutoffMs) continue;
      if (!newest || ts > newest.ts) {
        newest = { msg: m, ts: ts };
      }
    }
  }

  if (!newest) {
    Logger.log('relayEmaapOtps: no recent OTP mail');
    return;
  }

  const m = newest.msg;
  const res = UrlFetchApp.fetch(WEBHOOK, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({
      from: m.getFrom(),
      subject: m.getSubject(),
      text: m.getPlainBody(),
    }),
  });
  Logger.log(
    `relayEmaapOtps newest=${m.getDate()} HTTP ${res.getResponseCode()}: ${res.getContentText()}`,
  );
}
