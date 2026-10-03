// Validation immédiate côté navigateur, pour un retour instantané dans le
// formulaire. La validation qui fait autorité reste celle du serveur.
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const ALLOWED_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);

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
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return null;

  const segments = url.pathname.split('/').filter(Boolean);
  let id = null;
  if (url.hostname.toLowerCase().endsWith('youtu.be')) id = segments[0] || null;
  else if (segments[0] === 'watch') id = url.searchParams.get('v');
  else if (['shorts', 'live', 'embed'].includes(segments[0])) id = segments[1] || null;

  return id && VIDEO_ID.test(id) ? { id } : null;
}
