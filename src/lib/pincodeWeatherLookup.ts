import { isValidPincode, normalizePincode } from './contactFields';

export type WeatherLookupResult = {
  ambientTemperature: string;
  relativeHumidity: string;
};

type GeoCoords = {
  lat: number;
  lng: number;
};

type WttrInResponse = {
  current_condition?: Array<{
    temp_C?: string | number;
    humidity?: string | number;
  }>;
};

type OpenMeteoForecastResult = {
  current?: {
    temperature_2m?: number;
    relative_humidity_2m?: number;
  };
};

function formatTemperature(value: number): string {
  return Number(value.toFixed(1)).toString();
}

function formatHumidity(value: number): string {
  return Math.round(value).toString();
}

function parseNumber(value: string | number | undefined): number | null {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

async function fetchWeatherWttrIn(pincode: string): Promise<WeatherLookupResult | null> {
  const res = await fetch(`https://wttr.in/${encodeURIComponent(pincode)}?format=j1`, {
    headers: { 'User-Agent': 'yesgatcin/1.0' },
  });
  if (!res.ok) return null;

  const data = (await res.json()) as WttrInResponse;
  const current = data.current_condition?.[0];
  const temp = parseNumber(current?.temp_C);
  const humidity = parseNumber(current?.humidity);

  if (temp === null || humidity === null) return null;

  return {
    ambientTemperature: formatTemperature(temp),
    relativeHumidity: formatHumidity(humidity),
  };
}

async function fetchWeatherOpenMeteo(coords: GeoCoords): Promise<WeatherLookupResult | null> {
  const params = new URLSearchParams({
    latitude: coords.lat.toString(),
    longitude: coords.lng.toString(),
    current: 'temperature_2m,relative_humidity_2m',
    timezone: 'auto',
  });

  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) return null;

  const data = (await res.json()) as OpenMeteoForecastResult;
  const temp = data.current?.temperature_2m;
  const humidity = data.current?.relative_humidity_2m;

  if (typeof temp !== 'number' || typeof humidity !== 'number') return null;

  return {
    ambientTemperature: formatTemperature(temp),
    relativeHumidity: formatHumidity(humidity),
  };
}

export async function lookupWeatherByPincode(options: {
  pincode: string;
  location?: GeoCoords;
}): Promise<WeatherLookupResult | null> {
  const pincode = normalizePincode(options.pincode);
  if (!isValidPincode(pincode)) return null;

  if (options.location) {
    const fromCoords = await fetchWeatherOpenMeteo(options.location);
    if (fromCoords) return fromCoords;
  }

  return fetchWeatherWttrIn(pincode);
}
