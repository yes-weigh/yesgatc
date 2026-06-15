import { isValidPincode, normalizePincode } from './contactFields';
import { normalizeDistrictForDoca } from './docaDistrictAliases';

export type PincodeLookupResult = {
  state: string;
  district: string;
};

type PostalApiPostOffice = {
  State: string;
  District: string;
};

type PostalApiBlock = {
  Status: string;
  PostOffice: PostalApiPostOffice[] | null;
};

type VercelPincodeApiResponse = {
  data?: Array<{
    state?: string;
    district?: string;
  }>;
};

function titleCaseWords(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, ch => ch.toUpperCase());
}

function parsePostalPincodeResponse(data: PostalApiBlock[]): PincodeLookupResult | null {
  const block = data[0];
  if (!block || block.Status !== 'Success' || !block.PostOffice?.length) return null;

  const office = block.PostOffice[0];
  const state = office.State?.trim();
  const district = office.District?.trim();
  if (!state || !district) return null;

  return { state, district: normalizeDistrictForDoca(district) };
}

function parseVercelPincodeResponse(data: VercelPincodeApiResponse): PincodeLookupResult | null {
  const row = data.data?.[0];
  const state = row?.state?.trim();
  const district = row?.district?.trim();
  if (!state || !district) return null;

  return {
    state: titleCaseWords(state),
    district: normalizeDistrictForDoca(titleCaseWords(district)),
  };
}

async function fetchPostalPincodeIn(pincode: string): Promise<PincodeLookupResult | null> {
  const urls = import.meta.env.DEV
    ? [`/api/pincode/${pincode}`, `https://api.postalpincode.in/pincode/${pincode}`]
    : [`https://api.postalpincode.in/pincode/${pincode}`];

  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = (await res.json()) as PostalApiBlock[];
      const parsed = parsePostalPincodeResponse(data);
      if (parsed) return parsed;
    } catch {
      // Try next URL / provider.
    }
  }

  return null;
}

async function fetchVercelPincodeApi(pincode: string): Promise<PincodeLookupResult | null> {
  const res = await fetch(`https://postal-pincode-api.vercel.app/api/v1/pincode/${pincode}`);
  if (!res.ok) throw new Error('Pincode lookup failed.');

  const data = (await res.json()) as VercelPincodeApiResponse;
  return parseVercelPincodeResponse(data);
}

export async function lookupPincode(pincode: string): Promise<PincodeLookupResult | null> {
  const normalized = normalizePincode(pincode);
  if (!isValidPincode(normalized)) return null;

  const primary = await fetchPostalPincodeIn(normalized);
  if (primary) return primary;

  return fetchVercelPincodeApi(normalized);
}
