// Erreurs de fournisseur normalisées + appel HTTP avec délai maximal.

export class ProviderHttpError extends Error {
  constructor(
    message,
    {
      status = 0,
      quota = false,
      retryable = false,
      retryAfterMs = 0,
      modelMissing = false,
      truncated = false,
    } = {},
  ) {
    super(message);
    this.name = 'ProviderHttpError';
    this.status = status;
    this.quota = quota;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
    // Modèle inexistant, retiré, ou hors du palier de la clé : c'est un
    // problème de configuration, pas un aléa réseau. Réessayer n'y changera rien.
    this.modelMissing = modelMissing;
    // Réponse coupée faute de tokens : ni un quota, ni un aléa réseau.
    this.truncated = truncated;
  }
}

export function classifyStatus(status, body, retryAfterHeader) {
  const retryAfterMs = parseRetryAfter(retryAfterHeader);
  if (status === 429) {
    return new ProviderHttpError(`429 quota atteint : ${truncate(body)}`, {
      status,
      quota: true,
      retryable: true,
      retryAfterMs,
    });
  }
  if (status === 401 || status === 403) {
    // Clé absente ou invalide : inutile de réessayer, on bascule.
    return new ProviderHttpError(`${status} authentification refusée : ${truncate(body)}`, { status });
  }
  if (status === 402 || status === 413) {
    return new ProviderHttpError(`${status} requête refusée : ${truncate(body)}`, { status });
  }
  if (status === 404) {
    // Les fournisseurs retirent régulièrement des modèles : le message doit
    // dire quoi corriger, pas se perdre dans « réponse inexploitable ».
    return new ProviderHttpError(`404 modèle indisponible : ${truncate(body)}`, {
      status,
      retryable: false,
      modelMissing: true,
    });
  }
  if (status >= 500) {
    return new ProviderHttpError(`${status} erreur du fournisseur : ${truncate(body)}`, {
      status,
      retryable: true,
      retryAfterMs,
    });
  }
  // Certains fournisseurs renvoient 400 avec un message de quota.
  const quotaHint = /quota|rate.?limit|exhausted|resource_exhausted/i.test(String(body));
  return new ProviderHttpError(`${status} requête rejetée : ${truncate(body)}`, {
    status,
    quota: quotaHint,
    retryable: false,
  });
}

function parseRetryAfter(value) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 60000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, Math.min(date - Date.now(), 60000));
  return 0;
}

function truncate(text, max = 400) {
  const s = typeof text === 'string' ? text : JSON.stringify(text);
  return s && s.length > max ? `${s.slice(0, max)}…` : s;
}

/** POST JSON avec délai maximal et classification des erreurs. */
export async function postJson(url, { headers = {}, body, timeoutMs = 120000 }) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new ProviderHttpError(`réseau indisponible : ${err.message}`, { retryable: true });
  }

  const text = await res.text();
  if (!res.ok) throw classifyStatus(res.status, text, res.headers.get('retry-after'));

  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderHttpError('réponse non JSON du fournisseur', { retryable: true });
  }
}
