import { EventEmitter } from 'node:events';

// Implémentations en mémoire des dépendances de l'api, pour les tests.
export function createMemoryStore() {
  const jobs = new Map();
  const clips = new Map();
  const users = new Map();
  const uploads = new Map();
  let jobSeq = 1000;
  let clipSeq = 5000;
  let userSeq = 1;
  let uploadSeq = 1;

  return {
    jobs,
    clips,
    uploads,
    async ping() {
      return true;
    },
    async migrate() {},
    async createJob(job) {
      const id = String(++jobSeq);
      jobs.set(id, {
        id,
        userId: job.userId ?? null,
        ownerKey: job.ownerKey,
        sourceKind: job.sourceKind ?? 'youtube',
        sourceName: job.sourceName ?? null,
        youtubeUrl: job.youtubeUrl,
        youtubeVideoId: job.youtubeVideoId,
        language: job.language,
        clipCount: job.clipCount,
        targetDuration: job.targetDuration,
        captionStyle: job.captionStyle,
        focusX: job.focusX,
        layout: job.layout ?? 'crop',
        hookOverlay: job.hookOverlay ?? false,
        seriesMode: job.seriesMode ?? false,
        subtitleLanguage: job.subtitleLanguage ?? 'source',
        status: 'queued',
        currentStep: 'queued',
        progress: 0,
        errorCode: null,
        errorMessage: null,
        sourceTitle: null,
        createdAt: new Date(Date.now() + jobSeq),
      });
      return id;
    },

    async listJobs(ownerKey, { limit = 20, offset = 0 } = {}) {
      return [...jobs.values()]
        .filter((job) => job.ownerKey === ownerKey)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(offset, offset + limit)
        .map((job) => ({
          ...job,
          clipsCount: [...clips.values()].filter((c) => c.jobId === job.id).length,
        }));
    },

    async countJobs(ownerKey) {
      return [...jobs.values()].filter((job) => job.ownerKey === ownerKey).length;
    },

    async deleteJob(id) {
      jobs.delete(String(id));
      for (const [clipId, clip] of clips) if (clip.jobId === String(id)) clips.delete(clipId);
    },

    async createUpload(upload) {
      const id = String(++uploadSeq);
      uploads.set(upload.token, { id, consumedAt: null, ...upload });
      return id;
    },

    async getUploadByToken(token) {
      return uploads.get(token) ?? null;
    },

    async consumeUpload(id) {
      for (const upload of uploads.values()) {
        if (upload.id === String(id)) upload.consumedAt = new Date();
      }
    },

    async setClipPublished(clipId, platform, published) {
      const clip = clips.get(String(clipId));
      if (!clip) return;
      const key = platform === 'youtube' ? 'publishedYoutube' : 'publishedTiktok';
      clip[key] = published ? new Date() : null;
    },

    async setClipRestyleStatus(clipId, status) {
      const clip = clips.get(String(clipId));
      if (clip) clip.restyleStatus = status;
    },
    async getJob(id) {
      return jobs.get(String(id)) ?? null;
    },
    async getClips(jobId) {
      return [...clips.values()].filter((c) => c.jobId === String(jobId)).sort((a, b) => a.idx - b.idx);
    },
    async getClipWithOwner(id) {
      const clip = clips.get(String(id));
      if (!clip) return null;
      const job = jobs.get(clip.jobId);
      return { ...clip, ownerKey: job?.ownerKey ?? null, userId: job?.userId ?? null };
    },
    addClip(clip) {
      const id = String(++clipSeq);
      clips.set(id, {
        id,
        ytHashtags: [],
        tiktokHashtags: [],
        restyleStatus: 'idle',
        captionStyle: null,
        focusX: null,
        layout: null,
        hookOverlay: null,
        padStart: 0,
        padEnd: 0,
        subtitlesEdited: false,
        ...clip,
      });
      return id;
    },
    async createUser({ email, passwordHash }) {
      const id = String(++userSeq);
      users.set(email, { id, email, passwordHash });
      return id;
    },
    async getUserByEmail(email) {
      return users.get(email) ?? null;
    },
    async getUserById(id) {
      return [...users.values()].find((u) => u.id === String(id)) ?? null;
    },
    async close() {},
  };
}

export function createMemoryBus() {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  return {
    async subscribe(jobId, handler) {
      const channel = `job:${jobId}`;
      emitter.on(channel, handler);
      return () => emitter.off(channel, handler);
    },
    publish(jobId, payload) {
      emitter.emit(`job:${jobId}`, payload);
    },
    async close() {},
  };
}

export function createMemoryQueue() {
  const enqueued = [];
  const restyled = [];
  return {
    enqueued,
    restyled,
    async enqueue(data) {
      enqueued.push(data);
    },
    async enqueueRestyle(data) {
      restyled.push(data);
    },
    async position(jobId) {
      const index = enqueued.findIndex((entry) => String(entry.jobId) === String(jobId));
      return index === -1 ? null : index + 1;
    },
    async ping() {
      return true;
    },
  };
}
