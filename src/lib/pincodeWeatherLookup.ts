import { isValidPincode, normalizePincode } from './contactFields';
import { lookupPincode, type PincodeLookupResult } from './pincodeLookup';

export type WeatherLookupResult = {
  ambientTemperature: string;
  relativeHumidity: string;
};

type GeoCoords = {
  lat: number;
  lng: number;
};

type WeatherApiLocation = {
  name?: string;
  region?: string;
  country?: string;
  lat?: number;
  lon?: number;
};

type WeatherApiCurrentResponse = {
  location?: WeatherApiLocation;
  current?: {
    temp_c?: number;
    humidity?: number;
  };
  error?: {
    code?: number;
    message?: string;
  };
};

const WEATHERAPI_CURRENT_URL = 'https://api.weatherapi.com/v1/current.json';

function weatherApiKey(): string {
  return (import.meta.env.VITE_WEATHERAPI_KEY as string | undefined)?.trim() ?? '';
}

function formatTemperature(value: number): string {
  return Number(value.toFixed(1)).toString();
}

function formatHumidity(value: number): string {
  return Math.round(value).toString();
}

function isIndianWeatherLocation(location: WeatherApiLocation | undefined): boolean {
  const country = location?.country?.trim().toLowerCase() ?? '';
  return country === 'india';
}

function parseWeatherApiResponse(data: WeatherApiCurrentResponse): WeatherLookupResult | null {
  if (data.error || !isIndianWeatherLocation(data.location)) return null;

  const temp = data.current?.temp_c;
  const humidity = data.current?.humidity;

  if (typeof temp !== 'number' || typeof humidity !== 'number') return null;

  return {
    ambientTemperature: formatTemperature(temp),
    relativeHumidity: formatHumidity(humidity),
  };
}

async function fetchWeatherApiCom(query: string): Promise<WeatherLookupResult | null> {
  const key = weatherApiKey();
  if (!key) return null;

  const params = new URLSearchParams({
    key,
    q: query,
  });

  try {
    const res = await fetch(`${WEATHERAPI_CURRENT_URL}?${params}`);
    if (!res.ok) return null;

    const data = (await res.json()) as WeatherApiCurrentResponse;
    return parseWeatherApiResponse(data);
  } catch {
    return null;
  }
}

function coordsQuery(coords: GeoCoords): string {
  return `${coords.lat},${coords.lng}`;
}

function uniqueQueries(queries: string[]): string[] {
  const seen = new Set<string>();
  return queries.filter(query => {
    const trimmed = query.trim();
    if (!trimmed || seen.has(trimmed)) return false;
    seen.add(trimmed);
    return true;
  });
}

/** Build WeatherAPI `q` strings for an Indian pincode (never `{pincode},India` — that resolves to US cities). */
export function buildIndianWeatherQueries(input: {
  pincode?: string;
  district?: string;
  state?: string;
  location?: GeoCoords;
}): string[] {
  const queries: string[] = [];
  const pincode = normalizePincode(input.pincode ?? '');
  const district = input.district?.trim() ?? '';
  const state = input.state?.trim() ?? '';

  if (isValidPincode(pincode)) {
    if (district && state) {
      queries.push(`${district},${state},${pincode},India`);
      queries.push(`${district},${state},India`);
    }
    if (state) {
      queries.push(`${pincode},${state},India`);
    }
  }

  if (input.location) {
    queries.push(coordsQuery(input.location));
  }

  return uniqueQueries(queries);
}

async function resolvePincodeRegion(
  pincode: string,
  district?: string,
  state?: string,
): Promise<PincodeLookupResult | null> {
  const districtTrimmed = district?.trim() ?? '';
  const stateTrimmed = state?.trim() ?? '';
  if (districtTrimmed && stateTrimmed) {
    return { district: districtTrimmed, state: stateTrimmed };
  }
  return lookupPincode(pincode);
}

/** Uses WeatherAPI.com — requires `VITE_WEATHERAPI_KEY` in env. */
export async function lookupWeatherByPincode(options: {
  pincode: string;
  district?: string;
  state?: string;
  location?: GeoCoords;
}): Promise<WeatherLookupResult | null> {
  const pincode = normalizePincode(options.pincode);
  const hasPincode = isValidPincode(pincode);
  const hasLocation = options.location?.lat != null && options.location?.lng != null;

  if (!hasPincode && !hasLocation) return null;

  let district = options.district?.trim() ?? '';
  let state = options.state?.trim() ?? '';

  if (hasPincode && (!district || !state)) {
    const region = await resolvePincodeRegion(pincode, district, state);
    if (region) {
      district = district || region.district;
      state = state || region.state;
    }
  }

  const queries = buildIndianWeatherQueries({
    pincode,
    district,
    state,
    location: hasLocation ? options.location : undefined,
  });

  for (const query of queries) {
    const result = await fetchWeatherApiCom(query);
    if (result) return result;
  }

  return null;
}

export function isWeatherApiConfigured(): boolean {
  return Boolean(weatherApiKey());
}
