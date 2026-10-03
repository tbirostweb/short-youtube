import crypto from 'node:crypto';

// Liens de téléchargement signés : HMAC sur (identifiant du clip, expiration).
// Le chemin de fichier réel n'est jamais exposé au client.

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function signClipToken({ clipId, expiresAt, secret }) {
  const payload = `clip:${clipId}:${expiresAt}`;
  return base64url(crypto.createHmac('sha256', secret).update(payload).digest());
}

export function verifyClipToken({ clipId, expiresAt, signature, secret }) {
  if (!signature || typeof signature !== 'string') return { ok: false, reason: 'missing' };
  const exp = Number(expiresAt);
  if (!Number.isFinite(exp)) return { ok: false, reason: 'malformed' };
  const expected = signClipToken({ clipId, expiresAt: exp, secret });
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'signature' };
  if (Math.floor(Date.now() / 1000) > exp) return { ok: false, reason: 'expired' };
  return { ok: true };
}

export function buildSignedClipPath({ clipId, ttlSeconds, secret }) {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = signClipToken({ clipId, expiresAt, secret });
  return `/api/clips/${clipId}/download?exp=${expiresAt}&sig=${sig}`;
}
