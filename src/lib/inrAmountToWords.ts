const BELOW_TWENTY = [
  'Zero',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
] as const;

const TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
] as const;

function twoDigitsWords(value: number): string {
  if (value < 20) return BELOW_TWENTY[value] ?? String(value);
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  return ones ? `${TENS[tens]} ${BELOW_TWENTY[ones]}` : TENS[tens];
}

function threeDigitsWords(value: number): string {
  const hundreds = Math.floor(value / 100);
  const remainder = value % 100;
  if (!hundreds) return twoDigitsWords(remainder);
  const hundredPart = `${BELOW_TWENTY[hundreds]} Hundred`;
  return remainder ? `${hundredPart} ${twoDigitsWords(remainder)}` : hundredPart;
}

function integerToWords(value: number): string {
  if (value === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(value / 10_000_000);
  const lakh = Math.floor((value % 10_000_000) / 100_000);
  const thousand = Math.floor((value % 100_000) / 1000);
  const remainder = value % 1000;

  if (crore) parts.push(`${twoDigitsWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigitsWords(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigitsWords(thousand)} Thousand`);
  if (remainder) parts.push(threeDigitsWords(remainder));

  return parts.join(' ');
}

/** Indian receipt wording — e.g. "Rupees Two Hundred Ninety Five Only". */
export function inrAmountToWords(amount: number): string {
  const rounded = Math.max(0, Math.round(amount));
  return `Rupees ${integerToWords(rounded)} Only`;
}
