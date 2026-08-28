export const YESONE_INBOUND_HTTP_URL = 'https://us-central1-yesgatc.cloudfunctions.net/yesoneInbound';

export function generateYesoneInboundToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function yesoneInboundDestinationUrl(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) return YESONE_INBOUND_HTTP_URL;
  return `${YESONE_INBOUND_HTTP_URL}?token=${encodeURIComponent(trimmed)}`;
}
