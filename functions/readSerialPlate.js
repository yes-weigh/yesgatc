const { HttpsError } = require('firebase-functions/v2/https');

const PLATE_PROMPT = `Read this weighing-instrument nameplate / serial plate photo.
Return JSON only with keys:
serialNumber, modelNo, modelid, max, e, min, unit, accuracyClass, modelApprovalNo, manufacturingYear, rawText.
Use empty string when unknown. unit is kg or g. manufacturingYear is YYYY or empty.
rawText is all visible text, single line spaces.`;

function asString(value) {
  return value == null ? '' : String(value).trim();
}

function parseModelJson(text) {
  const trimmed = String(text || '').trim();
  const block = trimmed.match(/\{[\s\S]*\}/);
  if (!block) return { rawText: trimmed };
  try {
    return JSON.parse(block[0]);
  } catch {
    return { rawText: trimmed };
  }
}

async function geminiReadPlate(apiKey, base64, mimeType) {
  const models = ['gemini-2.5-flash', 'gemini-2.0-flash'];
  let lastError = '';
  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: PLATE_PROMPT },
                { inlineData: { mimeType: mimeType, data: base64 } },
            ],
          },
        ],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      lastError = json?.error?.message || `${res.status}`;
      continue;
    }
    const text = json?.candidates?.[0]?.content?.parts?.map(p => p.text).join('\n') || '';
    return parseModelJson(text);
  }
  throw new HttpsError('unavailable', lastError || 'Plate read failed.');
}

async function readSerialPlateHandler(request, getCallerRole, apiKey) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }
  const role = await getCallerRole(request.auth.uid);
  const allowed = role === 'super_admin' || role === 'rc_admin' || role === 'vct' || role === 'verifier';
  if (!allowed) {
    throw new HttpsError('permission-denied', 'Not allowed to read serial plates.');
  }
  if (!apiKey) {
    throw new HttpsError('failed-precondition', 'GEMINI_API_KEY is not configured.');
  }
  const imageBase64 = asString(request.data?.imageBase64).replace(/^data:[^;]+;base64,/, '');
  const mimeType = asString(request.data?.mimeType) || 'image/jpeg';
  if (!imageBase64 || imageBase64.length < 80) {
    throw new HttpsError('invalid-argument', 'Plate image is required.');
  }
  if (imageBase64.length > 6_000_000) {
    throw new HttpsError('invalid-argument', 'Plate image is too large.');
  }
  const parsed = await geminiReadPlate(apiKey, imageBase64, mimeType);
  return {
    serialNumber: asString(parsed.serialNumber),
    modelNo: asString(parsed.modelNo),
    modelid: asString(parsed.modelid),
    max: asString(parsed.max),
    e: asString(parsed.e),
    min: asString(parsed.min),
    unit: asString(parsed.unit),
    accuracyClass: asString(parsed.accuracyClass),
    modelApprovalNo: asString(parsed.modelApprovalNo),
    manufacturingYear: asString(parsed.manufacturingYear),
    rawText: asString(parsed.rawText),
  };
}

module.exports = { readSerialPlateHandler };
