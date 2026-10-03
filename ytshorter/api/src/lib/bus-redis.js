import Redis from 'ioredis';

// Bus d'événements de progression : le worker publie, l'api diffuse en SSE.
// Une seule connexion Redis en mode "subscribe" est partagée par tous les flux.
export function createRedisBus(redisUrl) {
  const sub = new Redis(redisUrl, { maxRetriesPerRequest: null });
  /** @type {Map<string, Set<Function>>} */
  const listeners = new Map();

  sub.on('message', (channel, payload) => {
    const set = listeners.get(channel);
    if (!set || set.size === 0) return;
    let data;
    try {
      data = JSON.parse(payload);
    } catch {
      return;
    }
    for (const fn of set) {
      try {
        fn(data);
      } catch {
        /* un abonné défaillant ne casse pas les autres */
      }
    }
  });

  const channelFor = (jobId) => `ytshorter:job:${jobId}`;

  return {
    /**
     * @returns {Promise<() => void>} fonction de désabonnement
     */
    async subscribe(jobId, handler) {
      const channel = channelFor(jobId);
      let set = listeners.get(channel);
      if (!set) {
        set = new Set();
        listeners.set(channel, set);
        await sub.subscribe(channel);
      }
      set.add(handler);
      return () => {
        const current = listeners.get(channel);
        if (!current) return;
        current.delete(handler);
        if (current.size === 0) {
          listeners.delete(channel);
          sub.unsubscribe(channel).catch(() => {});
        }
      };
    },
    async close() {
      await sub.quit().catch(() => {});
    },
  };
}
