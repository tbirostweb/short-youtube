// Client HTTP de l'api. Toutes les requêtes sont de même origine :
// les cookies de session suivent automatiquement, aucune clé n'est manipulée ici.

export class ApiError extends Error {
  constructor(code, message, status = 0) {
    super(message || code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      headers: options.body ? { 'content-type': 'application/json' } : undefined,
      ...options,
    });
  } catch (err) {
    throw new ApiError('NETWORK', err.message);
  }

  let payload = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const error = payload?.error ?? {};
    throw new ApiError(error.code ?? 'INTERNAL', error.message, response.status);
  }
  return payload;
}

export const api = {
  createJob(payload) {
    return request('/api/jobs', { method: 'POST', body: JSON.stringify(payload) });
  },
  getJob(id) {
    return request(`/api/jobs/${encodeURIComponent(id)}`);
  },
  listJobs({ limit = 20, offset = 0 } = {}) {
    return request(`/api/jobs?limit=${limit}&offset=${offset}`);
  },
  deleteJob(id) {
    return request(`/api/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  getSubtitles(clipId) {
    return request(`/api/clips/${encodeURIComponent(clipId)}/subtitles`);
  },
  saveSubtitles(clipId, lines) {
    return request(`/api/clips/${encodeURIComponent(clipId)}/subtitles`, {
      method: 'PUT',
      body: JSON.stringify({ lines }),
    });
  },
  setPublished(clipId, platform, published) {
    return request(`/api/clips/${encodeURIComponent(clipId)}/published`, {
      method: 'POST',
      body: JSON.stringify({ platform, published }),
    });
  },
  restyleClip(clipId, payload) {
    return request(`/api/clips/${encodeURIComponent(clipId)}/restyle`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * Envoi d'un fichier vidéo. XMLHttpRequest et non fetch : c'est le seul
   * moyen d'obtenir la progression de l'envoi, indispensable sur un gros
   * fichier et une connexion lente.
   */
  uploadFile(file, { onProgress, signal } = {}) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/uploads');
      xhr.withCredentials = true;

      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) onProgress?.(event.loaded / event.total);
      });

      xhr.addEventListener('load', () => {
        let payload = null;
        try {
          payload = JSON.parse(xhr.responseText);
        } catch {
          payload = null;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(payload);
        } else {
          const error = payload?.error ?? {};
          reject(new ApiError(error.code ?? 'INTERNAL', error.message, xhr.status));
        }
      });

      xhr.addEventListener('error', () => reject(new ApiError('NETWORK', 'Envoi interrompu.')));
      xhr.addEventListener('abort', () => reject(new ApiError('ABORTED', 'Envoi annulé.')));

      signal?.addEventListener('abort', () => xhr.abort(), { once: true });

      const form = new FormData();
      form.append('file', file);
      xhr.send(form);
    });
  },
  /**
   * Ouvre le flux SSE de progression.
   * @returns {EventSource}
   */
  openEvents(id) {
    return new EventSource(`/api/jobs/${encodeURIComponent(id)}/events`, {
      withCredentials: true,
    });
  },
};
