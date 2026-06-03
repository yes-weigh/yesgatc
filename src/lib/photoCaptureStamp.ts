export type PhotoCaptureStamp = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  placeName?: string;
  addressLine?: string;
  capturedAt: Date;
};

type GeoPosition = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
};

const STAMP_FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function getCurrentPosition(timeoutMs = 12_000): Promise<GeoPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracyMeters: pos.coords.accuracy,
        }),
      err => reject(err),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

/** OpenStreetMap Nominatim — free, no API key; use sparingly (1 req/s policy). */
async function reverseGeocode(lat: number, lon: number): Promise<{ placeName?: string; addressLine?: string }> {
  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('format', 'json');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lon));
  url.searchParams.set('zoom', '18');
  url.searchParams.set('addressdetails', '1');

  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json', 'Accept-Language': 'en' },
  });
  if (!res.ok) return {};

  const data = (await res.json()) as {
    display_name?: string;
    address?: Record<string, string | undefined>;
  };

  const addr = data.address;
  const locality =
    addr?.city || addr?.town || addr?.village || addr?.suburb || addr?.county || '';
  const state = addr?.state || '';
  const country = addr?.country || '';
  const placeName = [locality, state, country].filter(Boolean).join(', ') || undefined;

  const street = [addr?.house_number, addr?.road].filter(Boolean).join(' ');
  const postcode = addr?.postcode || '';
  const addressLine =
    data.display_name ||
    [street, locality, postcode, country].filter(Boolean).join(', ') ||
    undefined;

  return { placeName, addressLine };
}

/** Load a single satellite tile (Esri World Imagery — no API key). May fail CORS on some networks. */
function loadSatelliteTile(lat: number, lon: number, zoom = 17): Promise<HTMLImageElement | null> {
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${y}/${x}`;

  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function formatStampDateTime(date: Date): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'shortOffset',
    }).format(date);
  } catch {
    return date.toLocaleString('en-GB');
  }
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

/** Fetch GPS + optional address while the camera is open. */
export async function loadPhotoCaptureStamp(): Promise<PhotoCaptureStamp | null> {
  try {
    const pos = await getCurrentPosition();
    const capturedAt = new Date();
    let placeName: string | undefined;
    let addressLine: string | undefined;
    try {
      const geo = await reverseGeocode(pos.latitude, pos.longitude);
      placeName = geo.placeName;
      addressLine = geo.addressLine;
    } catch {
      /* address is optional */
    }
    return {
      latitude: pos.latitude,
      longitude: pos.longitude,
      accuracyMeters: pos.accuracyMeters,
      placeName,
      addressLine,
      capturedAt,
    };
  } catch {
    return null;
  }
}

/** Burn GPS, time, and optional satellite inset into the bottom of a canvas. */
export async function drawPhotoCaptureStamp(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  stamp: PhotoCaptureStamp,
): Promise<void> {
  const scale = Math.max(width / 1080, 0.55);
  const pad = Math.round(12 * scale);
  const mapSize = Math.round(Math.min(width * 0.22, height * 0.2, 140 * scale));
  const fontSm = Math.round(11 * scale);
  const fontMd = Math.round(13 * scale);
  const fontLg = Math.round(15 * scale);
  const lineGap = Math.round(4 * scale);

  const latStr = `Lat ${stamp.latitude.toFixed(6)}°`;
  const lonStr = `Long ${stamp.longitude.toFixed(6)}°`;
  const timeStr = formatStampDateTime(stamp.capturedAt);

  const textLines: string[] = [];
  if (stamp.placeName) textLines.push(stamp.placeName);
  if (stamp.addressLine && stamp.addressLine !== stamp.placeName) {
    textLines.push(...wrapText(ctx, stamp.addressLine, width * 0.62));
  }
  textLines.push(`${latStr}  ${lonStr}`);
  textLines.push(timeStr);

  ctx.font = `${fontMd}px ${STAMP_FONT_FAMILY}`;
  const textBlockHeight =
    textLines.length * (fontMd + lineGap) + pad * 2;
  const barHeight = Math.max(textBlockHeight, mapSize + pad * 2);
  const barTop = height - barHeight;

  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
  ctx.fillRect(0, barTop, width, barHeight);

  const mapImg = await loadSatelliteTile(stamp.latitude, stamp.longitude);
  const textLeft = mapImg ? pad + mapSize + pad : pad;

  if (mapImg) {
    const mapX = pad;
    const mapY = barTop + (barHeight - mapSize) / 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = Math.max(1, scale);
    ctx.drawImage(mapImg, mapX, mapY, mapSize, mapSize);
    ctx.strokeRect(mapX, mapY, mapSize, mapSize);

    const pinX = mapX + mapSize / 2;
    const pinY = mapY + mapSize / 2;
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(pinX, pinY - mapSize * 0.08, mapSize * 0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(pinX, pinY - mapSize * 0.08, mapSize * 0.03, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'top';
  let y = barTop + pad;

  if (stamp.placeName) {
    ctx.font = `600 ${fontLg}px ${STAMP_FONT_FAMILY}`;
    ctx.fillText(stamp.placeName, textLeft, y);
    y += fontLg + lineGap;
  }

  ctx.font = `${fontSm}px ${STAMP_FONT_FAMILY}`;
  const detailLines = stamp.placeName
    ? textLines.filter((line, i) => i > 0 || line !== stamp.placeName)
    : textLines;

  for (const line of detailLines) {
    const isCoords = line.startsWith('Lat ');
    const isTime = line === timeStr;
    ctx.font = `${isCoords || isTime ? 500 : 400} ${isCoords || isTime ? fontSm : fontMd}px ${STAMP_FONT_FAMILY}`;
    ctx.fillStyle = isCoords || isTime ? 'rgba(255, 255, 255, 0.92)' : 'rgba(255, 255, 255, 0.88)';
    const maxW = width - textLeft - pad;
    for (const wrapped of isCoords || isTime ? [line] : wrapText(ctx, line, maxW)) {
      ctx.fillText(wrapped, textLeft, y);
      y += (isCoords || isTime ? fontSm : fontMd) + lineGap;
    }
  }

  ctx.restore();
}
