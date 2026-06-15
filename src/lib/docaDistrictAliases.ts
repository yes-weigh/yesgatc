const DOCA_DISTRICT_ALIASES: Readonly<Record<string, string>> = {
  kasargod: 'Kasaragod',
  kasargode: 'Kasaragod',
};

export function normalizeDistrictForDoca(district: string): string {
  const trimmed = district.trim();
  if (!trimmed) return trimmed;
  return DOCA_DISTRICT_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}
