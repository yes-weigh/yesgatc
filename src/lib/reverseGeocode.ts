export type ReverseGeocodeResult = {
  placeName?: string;
  addressLine?: string;
  provider?: 'google' | 'bigdatacloud';
};

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

function googleMapsApiKey(): string {
  return (
    (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim() ||
    (import.meta.env.VITE_GEOCODING_API_KEY as string | undefined)?.trim() ||
    ''
  );
}

const GOOGLE_PREFERRED_TYPES = [
  'premise',
  'street_address',
  'establishment',
  'point_of_interest',
  'store',
  'route',
  'neighborhood',
  'sublocality_level_1',
  'sublocality',
] as const;

type GoogleGeocodeResult = {
  formatted_address?: string;
  types?: string[];
  geometry?: { location?: { lat?: number; lng?: number } };
  address_components?: Array<{
    long_name?: string;
    short_name?: string;
    types?: string[];
  }>;
};

function googleTypeScore(types: string[]): number {
  const idx = GOOGLE_PREFERRED_TYPES.findIndex(t => types.includes(t));
  return idx >= 0 ? idx : 99;
}

function componentName(
  components: GoogleGeocodeResult['address_components'],
  ...types: string[]
): string | undefined {
  for (const type of types) {
    const hit = components?.find(c => c.types?.includes(type));
    if (hit?.long_name?.trim()) return hit.long_name.trim();
  }
  return undefined;
}

function labelsFromGoogleResult(result: GoogleGeocodeResult): ReverseGeocodeResult {
  const components = result.address_components ?? [];
  const state = componentName(components, 'administrative_area_level_1');
  const country = componentName(components, 'country');
  const postcode = componentName(components, 'postal_code');

  const poi = componentName(components, 'establishment', 'point_of_interest', 'premise');
  const streetNumber = componentName(components, 'street_number');
  const route = componentName(components, 'route');
  const road = [streetNumber, route].filter(Boolean).join(' ').trim();
  const area = componentName(
    components,
    'neighborhood',
    'sublocality_level_1',
    'sublocality_level_2',
    'sublocality',
  );
  const city = componentName(components, 'locality', 'postal_town');

  const headline = poi || road || area || city;
  const placeName = headline
    ? [headline, state, country].filter(Boolean).join(', ')
    : result.formatted_address;

  const addressLine =
    result.formatted_address ||
    [poi && poi !== headline ? poi : '', road, area, city, postcode].filter(Boolean).join(', ');

  return {
    placeName: placeName || undefined,
    addressLine: addressLine || undefined,
    provider: 'google',
  };
}

/** Same data source family as the Google Maps app (requires API key). */
async function reverseGeocodeGoogle(lat: number, lon: number): Promise<ReverseGeocodeResult | null> {
  const key = googleMapsApiKey();
  if (!key) return null;

  const tryRequest = async (resultType?: string) => {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('latlng', `${lat},${lon}`);
    url.searchParams.set('key', key);
    url.searchParams.set('language', 'en');
    if (resultType) url.searchParams.set('result_type', resultType);

    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      status?: string;
      results?: GoogleGeocodeResult[];
    };
    if (data.status !== 'OK' || !data.results?.length) return null;
    return data.results;
  };

  let results =
    (await tryRequest(
      'street_address|route|premise|establishment|point_of_interest|neighborhood|sublocality',
    )) ?? (await tryRequest());

  if (!results?.length) return null;

  let best = results[0];
  let bestScore = googleTypeScore(best.types ?? []);

  for (const candidate of results) {
    const types = candidate.types ?? [];
    const score = googleTypeScore(types);
    const loc = candidate.geometry?.location;
    const dist =
      loc?.lat != null && loc?.lng != null
        ? haversineMeters(lat, lon, loc.lat, loc.lng)
        : Number.POSITIVE_INFINITY;

    if (dist <= 120 && score <= 4) {
      return labelsFromGoogleResult(candidate);
    }

    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return labelsFromGoogleResult(best);
}

type BigDataCloudResponse = {
  city?: string;
  locality?: string;
  principalSubdivision?: string;
  countryName?: string;
  postcode?: string;
  plusCode?: string;
  localityInfo?: {
    informative?: Array<{ name?: string; description?: string }>;
    administrative?: Array<{ name?: string; order?: number; description?: string }>;
  };
};

/** Free client-side reverse geocode (fallback when Google key is not set). */
async function reverseGeocodeBigDataCloud(lat: number, lon: number): Promise<ReverseGeocodeResult | null> {
  const url = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set('localityLanguage', 'en');

  const res = await fetch(url.toString());
  if (!res.ok) return null;

  const data = (await res.json()) as BigDataCloudResponse;
  const informative = data.localityInfo?.informative ?? [];

  const micro = informative.find(entry => {
    const d = (entry.description ?? '').toLowerCase();
    return (
      d.includes('neighbour') ||
      d.includes('neighbor') ||
      d.includes('suburb') ||
      d.includes('quarter') ||
      d.includes('road') ||
      d.includes('street') ||
      d.includes('locality')
    );
  })?.name;

  const city = data.city?.trim() || data.locality?.trim();
  const state = data.principalSubdivision?.trim();
  const country = data.countryName?.trim();
  const postcode = data.postcode?.trim();

  const headline = micro || city;
  if (!headline) return null;

  const placeName = [headline, state, country].filter(Boolean).join(', ');
  const addressLine = [micro && micro !== headline ? micro : '', city, postcode]
    .filter(Boolean)
    .join(', ');

  return {
    placeName,
    addressLine: addressLine || undefined,
    provider: 'bigdatacloud',
  };
}

/**
 * Resolve human-readable labels for a GPS point.
 * Prefer Google Geocoding (matches Google Maps) when `VITE_GOOGLE_MAPS_API_KEY` is set.
 */
export async function reverseGeocodeForStamp(
  lat: number,
  lon: number,
): Promise<ReverseGeocodeResult> {
  try {
    const google = await reverseGeocodeGoogle(lat, lon);
    if (google?.placeName) return google;
  } catch {
    /* try fallback */
  }

  try {
    const bdc = await reverseGeocodeBigDataCloud(lat, lon);
    if (bdc?.placeName) return bdc;
  } catch {
    /* coords-only stamp */
  }

  return {};
}
