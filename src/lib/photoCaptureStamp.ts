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
const MAP_ZOOM = 18;
const TILE_SIZE = 256;
/** Above this, village-level labels are often misleading vs true position. */
const POOR_ACCURACY_METERS = 80;

function latLonToWorldPx(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const scale = TILE_SIZE * 2 ** zoom;
  const x = ((lon + 180) / 360) * scale;
  const latRad = (lat * Math.PI) / 180;
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale;
  return { x, y };
}

function tileXY(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const world = latLonToWorldPx(lat, lon, zoom);
  return {
    x: Math.floor(world.x / TILE_SIZE),
    y: Math.floor(world.y / TILE_SIZE),
  };
}

/** Pixel offset (0–256) of lat/lon within its slippy-map tile. */
function pixelInTile(lat: number, lon: number, zoom: number): { px: number; py: number } {
  const world = latLonToWorldPx(lat, lon, zoom);
  const tile = tileXY(lat, lon, zoom);
  return {
    px: world.x - tile.x * TILE_SIZE,
    py: world.y - tile.y * TILE_SIZE,
  };
}

/**
 * Prefer a fresh, high-accuracy fix. Uses watchPosition briefly, then keeps the best reading.
 */
function getBestCurrentPosition(timeoutMs = 14_000): Promise<GeoPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
      return;
    }

    let best: GeoPosition | null = null;
    let settled = false;
    let watchId: number | null = null;

    const consider = (pos: GeolocationPosition) => {
      const candidate: GeoPosition = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracyMeters: pos.coords.accuracy,
      };
      const bestAcc = best?.accuracyMeters ?? Number.POSITIVE_INFINITY;
      const candAcc = candidate.accuracyMeters ?? Number.POSITIVE_INFINITY;
      if (!best || candAcc < bestAcc) best = candidate;
      if (candAcc <= 20) settleOk();
    };

    const settleOk = () => {
      if (settled || !best) return;
      settled = true;
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      clearTimeout(timer);
      resolve(best);
    };

    const timer = setTimeout(() => {
      if (best) settleOk();
      else if (!settled) {
        settled = true;
        if (watchId != null) navigator.geolocation.clearWatch(watchId);
        reject(new Error('GPS timeout'));
      }
    }, timeoutMs);

    const geoOpts: PositionOptions = {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: timeoutMs,
    };

    watchId = navigator.geolocation.watchPosition(consider, () => {}, geoOpts);

    navigator.geolocation.getCurrentPosition(consider, () => {}, geoOpts);
  });
}

import { reverseGeocodeForStamp } from './reverseGeocode';

function loadSatelliteTile(z: number, x: number, y: number): Promise<HTMLImageElement | null> {
  const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
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

/** Fetch GPS at capture time (always fresh). */
export async function loadPhotoCaptureStamp(): Promise<PhotoCaptureStamp | null> {
  try {
    const pos = await getBestCurrentPosition();
    const capturedAt = new Date();
    const accuracy = pos.accuracyMeters;

    let placeName: string | undefined;
    let addressLine: string | undefined;

    try {
      const geo = await reverseGeocodeForStamp(pos.latitude, pos.longitude);
      placeName = geo.placeName;
      addressLine = geo.addressLine;
    } catch {
      /* address is optional — coordinates always shown */
    }

    return {
      latitude: pos.latitude,
      longitude: pos.longitude,
      accuracyMeters: accuracy,
      placeName,
      addressLine,
      capturedAt,
    };
  } catch {
    return null;
  }
}

function drawMapPin(
  ctx: CanvasRenderingContext2D,
  pinX: number,
  pinY: number,
  scale: number,
  mapSize: number,
) {
  const pinR = Math.max(mapSize * 0.08, 5 * scale);
  ctx.fillStyle = '#3b82f6';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(2, scale * 1.5);
  ctx.beginPath();
  ctx.arc(pinX, pinY, pinR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(pinX, pinY, pinR * 0.35, 0, Math.PI * 2);
  ctx.fill();
}

/** Burn GPS, time, and satellite inset into the bottom of a canvas. */
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
  const accuracyNote =
    stamp.accuracyMeters != null && stamp.accuracyMeters > POOR_ACCURACY_METERS
      ? `GPS accuracy ±${Math.round(stamp.accuracyMeters)}m — using coordinates`
      : stamp.accuracyMeters != null && stamp.accuracyMeters > 25
        ? `GPS ±${Math.round(stamp.accuracyMeters)}m`
        : null;

  const textLines: string[] = [];
  if (accuracyNote) textLines.push(accuracyNote);
  if (stamp.placeName) textLines.push(stamp.placeName);
  if (stamp.addressLine && stamp.addressLine !== stamp.placeName) {
    textLines.push(...wrapText(ctx, stamp.addressLine, width * 0.62));
  }
  textLines.push(`${latStr}  ${lonStr}`);
  textLines.push(timeStr);

  ctx.font = `${fontMd}px ${STAMP_FONT_FAMILY}`;
  const textBlockHeight = textLines.length * (fontMd + lineGap) + pad * 2;
  const barHeight = Math.max(textBlockHeight, mapSize + pad * 2);
  const barTop = height - barHeight;

  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
  ctx.fillRect(0, barTop, width, barHeight);

  const { x: tileX, y: tileY } = tileXY(stamp.latitude, stamp.longitude, MAP_ZOOM);
  const { px, py } = pixelInTile(stamp.latitude, stamp.longitude, MAP_ZOOM);
  const mapImg = await loadSatelliteTile(MAP_ZOOM, tileX, tileY);
  const textLeft = mapImg ? pad + mapSize + pad : pad;

  if (mapImg) {
    const mapX = pad;
    const mapY = barTop + (barHeight - mapSize) / 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = Math.max(1, scale);
    ctx.drawImage(mapImg, mapX, mapY, mapSize, mapSize);
    ctx.strokeRect(mapX, mapY, mapSize, mapSize);

    const pinX = mapX + (px / TILE_SIZE) * mapSize;
    const pinY = mapY + (py / TILE_SIZE) * mapSize;
    drawMapPin(ctx, pinX, pinY, scale, mapSize);
  }

  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'top';
  let y = barTop + pad;

  const titleLine = stamp.placeName;
  if (titleLine) {
    ctx.font = `600 ${fontLg}px ${STAMP_FONT_FAMILY}`;
    ctx.fillText(titleLine, textLeft, y);
    y += fontLg + lineGap;
  }

  for (const line of textLines) {
    if (line === titleLine) continue;
    const isCoords = line.startsWith('Lat ');
    const isTime = line === timeStr;
    const isAccuracy = line.startsWith('GPS');
    ctx.font = `${isCoords || isTime || isAccuracy ? 500 : 400} ${
      isCoords || isTime ? fontSm : fontMd
    }px ${STAMP_FONT_FAMILY}`;
    ctx.fillStyle =
      isAccuracy ? 'rgba(251, 191, 36, 0.95)' : isCoords || isTime ? 'rgba(255, 255, 255, 0.92)' : 'rgba(255, 255, 255, 0.88)';
    const maxW = width - textLeft - pad;
    for (const wrapped of isCoords || isTime || isAccuracy ? [line] : wrapText(ctx, line, maxW)) {
      ctx.fillText(wrapped, textLeft, y);
      y += (isCoords || isTime ? fontSm : fontMd) + lineGap;
    }
  }

  ctx.restore();
}
