export type SerialPlateFields = {
  serialNumber: string;
  modelNo: string;
  modelid: string;
  max: string;
  e: string;
  min: string;
  unit: string;
  accuracyClass: string;
  modelApprovalNo: string;
  manufacturingYear: string;
  rawText: string;
};

const EMPTY_FIELDS: SerialPlateFields = {
  serialNumber: '',
  modelNo: '',
  modelid: '',
  max: '',
  e: '',
  min: '',
  unit: '',
  accuracyClass: '',
  modelApprovalNo: '',
  manufacturingYear: '',
  rawText: '',
};

function cleanToken(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizeSerialKey(value: string): string {
  return value.replace(/[\s\-_.]/g, '').toUpperCase();
}

function pick(regex: RegExp, text: string): string {
  const match = text.match(regex);
  return match?.[1] ? cleanToken(match[1]) : '';
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cur = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = cur;
    }
  }
  return row[b.length];
}

/** Parse OCR / model JSON into plate fields. */
export function parseSerialPlateText(raw: string): SerialPlateFields {
  const text = raw.replace(/\u0000/g, ' ').trim();
  if (!text) return { ...EMPTY_FIELDS };
  const serialNumber =
    pick(/(?:serial(?:\s*(?:no|number|#))?|sl\s*no)[\s.:#-]*([A-Z0-9][A-Z0-9\-\/]{2,})/i, text)
    || pick(/\bS\/N[\s.:#-]*([A-Z0-9][A-Z0-9\-\/]{2,})/i, text);
  const modelNo =
    pick(/(?:model(?:\s*(?:no|number|#))?)[\s.:#-]*([A-Z0-9][A-Z0-9\-\/]{1,})/i, text);
  const modelid = pick(/(?:model\s*id)[\s.:#-]*([A-Z0-9][A-Z0-9\-\/]{1,})/i, text);
  const max = pick(/\bmax(?:imum)?(?:\s*cap(?:acity)?)?[\s.:#-]*([0-9]+(?:\.[0-9]+)?)\s*(kg|g)?/i, text);
  const e = pick(/\be(?:\s*=)?[\s.:#-]*([0-9]+(?:\.[0-9]+)?)\s*g?/i, text);
  const min = pick(/\bmin(?:imum)?[\s.:#-]*([0-9]+(?:\.[0-9]+)?)\s*(kg|g)?/i, text);
  const unitMatch = text.match(/\b(kg|g)\b/i);
  const accuracyClass = pick(/\bclass[\s.:#-]*([IVX]+|\d+|III|II|I)\b/i, text);
  const modelApprovalNo = pick(/\b(IND\/[0-9][A-Z0-9\/-]*)/i, text);
  const manufacturingYear = pick(/\b((?:19|20)\d{2})\b/, text);
  return {
    serialNumber,
    modelNo,
    modelid,
    max,
    e,
    min,
    unit: unitMatch?.[1]?.toLowerCase() === 'g' ? 'g' : max ? 'kg' : '',
    accuracyClass,
    modelApprovalNo,
    manufacturingYear,
    rawText: text,
  };
}

export function mergeSerialPlateFields(
  parsed: Partial<SerialPlateFields> | null | undefined,
  rawText = '',
): SerialPlateFields {
  const fromText = parseSerialPlateText(rawText || parsed?.rawText || '');
  return {
    serialNumber: cleanToken(parsed?.serialNumber || fromText.serialNumber),
    modelNo: cleanToken(parsed?.modelNo || fromText.modelNo),
    modelid: cleanToken(parsed?.modelid || fromText.modelid),
    max: cleanToken(parsed?.max || fromText.max),
    e: cleanToken(parsed?.e || fromText.e),
    min: cleanToken(parsed?.min || fromText.min),
    unit: cleanToken(parsed?.unit || fromText.unit),
    accuracyClass: cleanToken(parsed?.accuracyClass || fromText.accuracyClass),
    modelApprovalNo: cleanToken(parsed?.modelApprovalNo || fromText.modelApprovalNo),
    manufacturingYear: cleanToken(parsed?.manufacturingYear || fromText.manufacturingYear),
    rawText: fromText.rawText || rawText,
  };
}

/** Best allotted serial for OCR text. Prefers exact / contained, then close Levenshtein. */
export function matchAllottedSerial(
  ocrSerial: string,
  rawText: string,
  allotted: string[],
): string | null {
  const seats = allotted.map(s => s.trim()).filter(Boolean);
  if (seats.length === 0) return null;
  const needle = normalizeSerialKey(ocrSerial);
  const hay = normalizeSerialKey(rawText);

  for (const seat of seats) {
    if (normalizeSerialKey(seat) === needle && needle) return seat;
  }

  const byLen = [...seats].sort((a, b) => b.length - a.length);
  for (const seat of byLen) {
    const key = normalizeSerialKey(seat);
    if (key.length < 4) continue;
    if (hay.includes(key)) return seat;
  }

  if (!needle || needle.length < 3) return null;
  let best: string | null = null;
  let bestScore = 0;
  for (const seat of seats) {
    const key = normalizeSerialKey(seat);
    if (!key) continue;
    const dist = levenshtein(needle, key);
    const score = 1 - dist / Math.max(needle.length, key.length);
    if (score > bestScore) {
      bestScore = score;
      best = seat;
    }
  }
  return bestScore >= 0.72 ? best : null;
}
