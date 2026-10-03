import { defineStore } from 'pinia';
import { api, ApiError } from '../lib/api.js';

const POLL_INTERVAL = 3000;
const RESTYLE_POLL_INTERVAL = 2500;
const RESTYLE_POLL_TIMEOUT = 5 * 60 * 1000;

// Options par défaut du formulaire, alignées sur les bornes validées par l'api.
export const defaultOptions = {
  language: 'fr',
  subtitleLanguage: 'source',
  clipCount: 3,
  targetDuration: 45,
  captionStyle: 'punch',
  focusX: 0.5,
  layout: 'crop',
  hookOverlay: false,
  seriesMode: false,
};

export const useJobStore = defineStore('job', {
  state: () => ({
    jobId: null,
    status: 'idle', // idle | queued | processing | done | error
    currentStep: 'queued',
    progress: 0,
    clips: [],
    sourceTitle: null,
    sourceKind: 'youtube',
    subtitleLanguage: 'source',
    seriesMode: false,
    clipCount: null,
    queuePosition: null,
    error: null,
    submitting: false,
    loading: false,
    // Envoi de fichier : 0 à 1, null quand aucun envoi n'est en cours.
    uploadProgress: null,
    live: false, // vrai tant que le flux SSE est actif
    options: { ...defaultOptions },
    // Ressources ouvertes, hors état réactif exposé aux composants.
    _source: null,
    _poller: null,
    _restylePoller: null,
  }),

  getters: {
    isFinished: (state) => state.status === 'done' || state.status === 'error',
    hasClips: (state) => state.clips.length > 0,
  },

  actions: {
    reset() {
      this.stopTracking();
      this.stopRestyleWatch();
      this.jobId = null;
      this.status = 'idle';
      this.currentStep = 'queued';
      this.progress = 0;
      this.clips = [];
      this.sourceTitle = null;
      this.sourceKind = 'youtube';
      this.subtitleLanguage = 'source';
      this.queuePosition = null;
      this.error = null;
    },

    /**
     * Envoie un fichier vidéo puis crée le job correspondant.
     * L'envoi et la création sont deux appels : si la création échoue, le
     * fichier reste utilisable et sera nettoyé par la rétention.
     */
    async submitFile(file, options) {
      this.submitting = true;
      this.error = null;
      this.uploadProgress = 0;
      try {
        const { uploadId } = await api.uploadFile(file, {
          onProgress: (ratio) => {
            this.uploadProgress = ratio;
          },
        });
        this.uploadProgress = 1;
        const { jobId } = await api.createJob({ uploadId, ...options });
        this.reset();
        this.jobId = String(jobId);
        this.status = 'queued';
        return this.jobId;
      } catch (err) {
        this.error = toPlainError(err);
        throw err;
      } finally {
        this.submitting = false;
        this.uploadProgress = null;
      }
    },

    /** Crée un job et renvoie son identifiant. */
    async submit(payload) {
      this.submitting = true;
      this.error = null;
      try {
        const { jobId } = await api.createJob(payload);
        this.reset();
        this.jobId = String(jobId);
        this.status = 'queued';
        this.progress = 0;
        return this.jobId;
      } catch (err) {
        this.error = toPlainError(err);
        throw err;
      } finally {
        this.submitting = false;
      }
    },

    /** Charge l'état complet d'un job (y compris ses clips). */
    async load(jobId) {
      this.loading = true;
      try {
        const job = await api.getJob(jobId);
        this.applyJob(job);
        return job;
      } catch (err) {
        this.jobId = String(jobId);
        this.status = 'error';
        this.error = toPlainError(err);
        throw err;
      } finally {
        this.loading = false;
      }
    },

    applyJob(job) {
      this.jobId = String(job.id);
      this.status = job.status;
      this.currentStep = job.currentStep;
      this.progress = job.progress;
      this.clips = job.clips ?? [];
      this.sourceTitle = job.sourceTitle ?? job.sourceName ?? null;
      this.sourceKind = job.sourceKind ?? 'youtube';
      this.subtitleLanguage = job.subtitleLanguage ?? 'source';
      this.seriesMode = Boolean(job.seriesMode);
      this.clipCount = job.clipCount ?? null;
      this.queuePosition = job.queuePosition ?? null;
      this.error = job.error ?? null;
    },

    /**
     * Suit la progression en direct via SSE, avec repli sur un sondage
     * périodique si la connexion tombe.
     */
    trackProgress(jobId) {
      this.stopTracking();
      const id = String(jobId);
      this.jobId = id;

      let source;
      try {
        source = api.openEvents(id);
      } catch {
        this.startPolling(id);
        return;
      }
      this._source = source;

      source.addEventListener('open', () => {
        this.live = true;
        this.stopPolling();
      });

      source.addEventListener('progress', (event) => {
        const data = safeParse(event.data);
        if (!data) return;
        if (typeof data.progress === 'number' && data.progress >= this.progress) {
          this.progress = data.progress;
        }
        if (data.step) this.currentStep = data.step;
        if (data.status) this.status = data.status;
        if (data.status === 'processing') this.queuePosition = null;
      });

      source.addEventListener('done', () => {
        this.progress = 100;
        this.currentStep = 'done';
        this.status = 'done';
        this.stopTracking();
        this.load(id).catch(() => {});
      });

      source.addEventListener('error', (event) => {
        const data = safeParse(event.data);
        if (data?.error) {
          // Erreur métier envoyée par le serveur : le job est terminé.
          this.status = 'error';
          this.currentStep = data.step ?? 'error';
          this.error = data.error;
          this.stopTracking();
          return;
        }
        // Coupure réseau : on bascule sur le sondage périodique.
        this.live = false;
        this.stopSource();
        this.startPolling(id);
      });
    },

    startPolling(jobId) {
      if (this._poller) return;
      this._poller = setInterval(async () => {
        try {
          const job = await api.getJob(jobId);
          this.applyJob(job);
          if (job.status === 'done' || job.status === 'error') this.stopTracking();
        } catch (err) {
          if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
            this.status = 'error';
            this.error = toPlainError(err);
            this.stopTracking();
          }
        }
      }, POLL_INTERVAL);
    },

    stopPolling() {
      if (this._poller) {
        clearInterval(this._poller);
        this._poller = null;
      }
    },

    stopSource() {
      if (this._source) {
        this._source.close();
        this._source = null;
      }
    },

    stopTracking() {
      this.stopSource();
      this.stopPolling();
      this.live = false;
    },

    /**
     * Demande le ré-encodage d'un clip avec un autre style ou un autre
     * cadrage, puis surveille son avancement. Aucune génération complète
     * n'est relancée : les quotas gratuits ne sont pas touchés.
     */
    async restyleClip(clipId, payload) {
      const clip = this.clips.find((c) => c.id === clipId);
      try {
        await api.restyleClip(clipId, payload);
        if (clip) clip.restyleStatus = 'queued';
        this.watchRestyle();
        return true;
      } catch (err) {
        if (clip) clip.restyleStatus = 'error';
        this.error = toPlainError(err);
        throw err;
      }
    },

    /**
     * Marque un clip comme publié. La mise à jour est appliquée tout de suite
     * (le geste doit être instantané) et annulée si le serveur refuse.
     */
    async setPublished(clipId, platform, published) {
      const clip = this.clips.find((c) => c.id === clipId);
      const previous = clip?.published?.[platform] ?? false;
      if (clip) clip.published = { ...clip.published, [platform]: published };
      try {
        await api.setPublished(clipId, platform, published);
      } catch (err) {
        if (clip) clip.published = { ...clip.published, [platform]: previous };
        this.error = toPlainError(err);
        throw err;
      }
    },

    /** Enregistre des sous-titres corrigés, puis suit le ré-encodage. */
    async saveSubtitles(clipId, lines) {
      const clip = this.clips.find((c) => c.id === clipId);
      try {
        await api.saveSubtitles(clipId, lines);
        if (clip) clip.restyleStatus = 'queued';
        this.watchRestyle();
        return true;
      } catch (err) {
        this.error = toPlainError(err);
        throw err;
      }
    },

    /** Sondage court, le temps que le ré-encodage se termine. */
    watchRestyle() {
      if (this._restylePoller) return;
      let elapsed = 0;
      this._restylePoller = setInterval(async () => {
        elapsed += RESTYLE_POLL_INTERVAL;
        try {
          const job = await api.getJob(this.jobId);
          this.applyJob(job);
          const pending = job.clips.some(
            (c) => c.restyleStatus === 'queued' || c.restyleStatus === 'processing',
          );
          if (!pending || elapsed > RESTYLE_POLL_TIMEOUT) this.stopRestyleWatch();
        } catch {
          this.stopRestyleWatch();
        }
      }, RESTYLE_POLL_INTERVAL);
    },

    stopRestyleWatch() {
      if (this._restylePoller) {
        clearInterval(this._restylePoller);
        this._restylePoller = null;
      }
    },
  },
});

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function toPlainError(err) {
  return { code: err?.code ?? 'INTERNAL', message: err?.message ?? '' };
}
