// Validation d'URL YouTube et extraction de l'identifiant vidéo.
// Volontairement stricte : hôtes YouTube connus et identifiant de 11 caractères.
// Ce module est dupliqué à l’identique dans l’api (api/src/lib/youtube.js)
// pour garder des images Docker indépendantes ; les tests couvrent les deux copies.

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const ALLOWED_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);

/**
 * @param {string} input URL fournie par l'utilisateur.
 * @returns {{ id: string, url: string } | null} null si l'URL n'est pas une vidéo YouTube.
 */
export function parseYoutubeUrl(input) {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw || raw.length > 500) return null;

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const host = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) return null;

  let id = null;
  const segments = url.pathname.split('/').filter(Boolean);

  if (host === 'youtu.be' || host === 'www.youtu.be') {
    id = segments[0] || null;
  } else if (segments[0] === 'watch') {
    id = url.searchParams.get('v');
  } else if (segments[0] === 'shorts' || segments[0] === 'live' || segments[0] === 'embed') {
    id = segments[1] || null;
  }

  if (!id || !VIDEO_ID.test(id)) return null;
  return { id, url: `https://www.youtube.com/watch?v=${id}` };
}

export function isValidYoutubeUrl(input) {
  return parseYoutubeUrl(input) !== null;
}
