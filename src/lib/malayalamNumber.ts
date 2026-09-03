const ONES = ['', 'ഒന്ന്', 'രണ്ട്', 'മൂന്ന്', 'നാല്', 'അഞ്ച്', 'ആറ്', 'ഏഴ്', 'എട്ട്', 'ഒമ്പത്'] as const;

const TEENS: Record<number, string> = {
  10: 'പത്ത്',
  11: 'പതിനൊന്ന്',
  12: 'പന്ത്രണ്ട്',
  13: 'പതിമൂന്ന്',
  14: 'പതിനാല്',
  15: 'പതിനഞ്ച്',
  16: 'പതിനാറ്',
  17: 'പതിനേഴ്',
  18: 'പതിനെട്ട്',
  19: 'പത്തൊമ്പത്',
};

const TENS_ALONE = [
  '',
  '',
  'ഇരുപത്',
  'മുപ്പത്',
  'നാല്പത്',
  'അമ്പത്',
  'അറുപത്',
  'എഴുപത്',
  'എൺപത്',
  'തൊണ്ണൂറ്',
] as const;

const TENS_STEM = [
  '',
  '',
  'ഇരുപത്തി',
  'മുപ്പത്തി',
  'നാല്പത്തി',
  'അമ്പത്തി',
  'അറുപത്തി',
  'എഴുപത്തി',
  'എൺപത്തി',
  'തൊണ്ണൂറ്റി',
] as const;

const ONES_AFTER_I: Record<number, string> = {
  1: 'യൊന്ന്',
  2: 'രണ്ട്',
  3: 'മൂന്ന്',
  4: 'നാല്',
  5: 'യഞ്ച്',
  6: 'യാറ്',
  7: 'യേഴ്',
  8: 'യെട്ട്',
  9: 'യൊമ്പത്',
};

const HUNDRED_ALONE = [
  '',
  'നൂറ്',
  'ഇരുനൂറ്',
  'മുന്നൂറ്',
  'നാനൂറ്',
  'അഞ്ഞൂറ്',
  'അറുനൂറ്',
  'എഴുനൂറ്',
  'എണ്ണൂറ്',
  'തൊള്ളായിരം',
] as const;

const HUNDRED_STEM = [
  '',
  'നൂറ്റി',
  'ഇരുനൂറ്റി',
  'മുന്നൂറ്റി',
  'നാനൂറ്റി',
  'അഞ്ഞൂറ്റി',
  'അറുനൂറ്റി',
  'എഴുനൂറ്റി',
  'എണ്ണൂറ്റി',
  'തൊള്ളായിരത്തി',
] as const;

function belowHundred(n: number): string {
  if (n <= 0) return '';
  if (n < 10) return ONES[n];
  if (n < 20) return TEENS[n];
  const ten = Math.floor(n / 10);
  const one = n % 10;
  if (one === 0) return TENS_ALONE[ten];
  return `${TENS_STEM[ten]}${ONES_AFTER_I[one]}`;
}

function attachToIStem(stem: string, restWord: string): string {
  if (restWord.startsWith('ഇ')) return `${stem}യി${restWord.slice(1)}`;
  if (restWord.startsWith('അ')) return `${stem}യ${restWord.slice(1)}`;
  if (restWord.startsWith('എ')) return `${stem}യെ${restWord.slice(1)}`;
  return `${stem}${restWord}`;
}

function joinAfterHundredStem(stem: string, rest: number): string {
  if (rest === 50) return `${stem.slice(0, -1)}മ്പത്`;
  if (rest === 10) return `${stem}പ്പത്ത്`;
  if (rest < 10) return `${stem}${ONES_AFTER_I[rest]}`;
  return attachToIStem(stem, belowHundred(rest));
}

function belowThousand(n: number): string {
  if (n < 100) return belowHundred(n);
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  if (rest === 0) return HUNDRED_ALONE[hundred];
  return joinAfterHundredStem(HUNDRED_STEM[hundred], rest);
}

function belowTenThousand(n: number): string {
  if (n < 1000) return belowThousand(n);
  const thousand = Math.floor(n / 1000);
  const rest = n % 1000;
  const thousandWord =
    thousand === 1
      ? 'ആയിരം'
      : thousand === 2
        ? 'രണ്ടായിരം'
        : thousand === 3
          ? 'മൂവായിരം'
          : thousand === 4
            ? 'നാലായിരം'
            : thousand === 5
              ? 'അയ്യായിരം'
              : `${belowHundred(thousand)} ആയിരം`;
  if (rest === 0) return thousandWord;
  const stem =
    thousand === 1
      ? 'ആയിരത്തി'
      : thousand === 2
        ? 'രണ്ടായിരത്തി'
        : thousand === 3
          ? 'മൂവായിരത്തി'
          : thousand === 4
            ? 'നാലായിരത്തി'
            : thousand === 5
              ? 'അയ്യായിരത്തി'
              : `${belowHundred(thousand)} ആയിരത്തി`;
  if (rest === 50) return `${stem.replace(/ി$/, '')}യമ്പത്`;
  if (rest >= 100) return `${stem}${belowThousand(rest)}`;
  return joinAfterHundredStem(stem, rest);
}

function digitWord(d: number): string {
  if (d === 0) return 'പൂജ്യം';
  return ONES[d] || String(d);
}

/** Integer / decimal → Malayalam words. 100 → നൂറ്, 150 → നൂറ്റമ്പത്, 10 → പത്ത്. */
export function numberToMalayalam(value: number): string {
  if (!Number.isFinite(value)) return '';
  if (value < 0) return numberToMalayalam(-value);
  const rounded = Math.round(value * 1e6) / 1e6;
  const [intPart, fracPart] = String(rounded).split('.');
  const whole = Number(intPart);
  const wholeWord = whole === 0 && fracPart ? 'പൂജ്യം' : whole === 0 ? 'പൂജ്യം' : belowTenThousand(whole);
  if (!fracPart) return wholeWord;
  const fracWords = fracPart.split('').map(ch => digitWord(Number(ch))).join(' ');
  return `${wholeWord} പോയിന്റ് ${fracWords}`;
}

export function capacityToMalayalam(label: string): string | null {
  const match = label.trim().match(/^([\d.]+)\s*(kg|g)\s+([\d.]+)\s*g$/i);
  if (!match) return null;
  const max = Number(match[1]);
  const unit = match[2].toLowerCase();
  const e = Number(match[3]);
  const maxWord = numberToMalayalam(max);
  const eWord = numberToMalayalam(e);
  if (!maxWord || !eWord) return null;
  const maxUnit = unit === 'g' ? 'ഗ്രാം' : 'കിലോ';
  return `${maxWord} ${maxUnit} ${eWord} ഗ്രാം`;
}
