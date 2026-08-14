const EMBED_QUERY = 'embed';
const EMBED_SESSION_KEY = 'yesgatc.embed';
const EMBED_TOKEN_KEY = 'yesgatc.embedToken';
const EMBED_HASH_PREFIX = 'embedToken=';

export function rememberEmbedMode(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get(EMBED_QUERY) === '1') {
    sessionStorage.setItem(EMBED_SESSION_KEY, '1');
    return true;
  }
  return sessionStorage.getItem(EMBED_SESSION_KEY) === '1';
}

export function isEmbedSession(): boolean {
  if (typeof window === 'undefined') return false;
  if (new URLSearchParams(window.location.search).get(EMBED_QUERY) === '1') return true;
  return sessionStorage.getItem(EMBED_SESSION_KEY) === '1';
}

export function embedVerificationPath(): string {
  return '/rc/verification?embed=1';
}

export function takeEmbedTokenFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  rememberEmbedMode();
  const hash = window.location.hash.replace(/^#/, '');
  if (hash.startsWith(EMBED_HASH_PREFIX)) {
    const token = decodeURIComponent(hash.slice(EMBED_HASH_PREFIX.length));
    if (token) {
      sessionStorage.setItem(EMBED_TOKEN_KEY, token);
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      return token;
    }
  }
  return sessionStorage.getItem(EMBED_TOKEN_KEY);
}

export function clearEmbedToken(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(EMBED_TOKEN_KEY);
}
