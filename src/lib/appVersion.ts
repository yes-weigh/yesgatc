/** Display version shown under brand logos. Next main push auto-bumps minor (V6.1, V6.2, …). */
export const APP_VERSION = 'V6.47';

/** Numeric code for min-version gates: V6.40 → 640. */
export function parseAppVersionCode(version: string): number {
  const match = /^V?(\d+)\.(\d+)$/i.exec(version.trim());
  if (!match) return 0;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (!Number.isFinite(major) || !Number.isFinite(minor) || major < 0 || minor < 0) return 0;
  return Math.floor(major) * 100 + Math.floor(minor);
}

export const APP_VERSION_CODE = parseAppVersionCode(APP_VERSION);
