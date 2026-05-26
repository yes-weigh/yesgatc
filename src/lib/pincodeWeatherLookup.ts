import { isValidPincode, normalizePincode } from './contactFields';

export type WeatherLookupResult = {
  ambientTemperature: string;
  relativeHumidity: string;
};

type GeoCoords = {
  lat: number;
  lng: number;
};

type WeatherApiCurrentResponse = {
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

function parseWeatherApiResponse(data: WeatherApiCurrentResponse): WeatherLookupResult | null {
  if (data.error) return null;

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

function pincodeQuery(pincode: string): string {
  return `${pincode},India`;
}

/** Uses WeatherAPI.com — requires `VITE_WEATHERAPI_KEY` in env. */
export async function lookupWeatherByPincode(options: {
  pincode: string;
  location?: GeoCoords;
}): Promise<WeatherLookupResult | null> {
  const pincode = normalizePincode(options.pincode);
  const hasPincode = isValidPincode(pincode);

  if (options.location) {
    const fromCoords = await fetchWeatherApiCom(coordsQuery(options.location));
    if (fromCoords) return fromCoords;
  }

  if (hasPincode) {
    return fetchWeatherApiCom(pincodeQuery(pincode));
  }

  return null;
}

export function isWeatherApiConfigured(): boolean {
  return Boolean(weatherApiKey());
}
