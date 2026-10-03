import Redis from 'ioredis';
import { Queue } from 'bullmq';
import { config, assertProductionSecrets } from './config.js';
import { buildApp } from './app.js';
import { createMysqlStore } from './lib/store-mysql.js';
import { createRedisBus } from './lib/bus-redis.js';

export const JOB_QUEUE_NAME = 'ytshorter-clips';

async function main() {
  assertProductionSecrets();

  const store = createMysqlStore(config.mysql);
  const bus = createRedisBus(config.redisUrl);
  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  const bullQueue = new Queue(JOB_QUEUE_NAME, { connection: redis });

  const queue = {
    async enqueue(data) {
      const queueJobId = `job-${data.jobId}`;
      // BullMQ déduplique par jobId : si un job du même identifiant existe
      // encore (terminé, en échec, conservé par removeOnFail), add() ne fait
      // RIEN silencieusement — l'api répond 202 et le job n'est jamais traité.
      // On retire donc l'éventuel résidu avant d'ajouter.
      await bullQueue.remove(queueJobId).catch(() => {});

      const added = await bullQueue.add('process-video', data, {
        jobId: queueJobId,
        removeOnComplete: { age: 3600, count: 100 },
        removeOnFail: { age: 86400, count: 100 },
        attempts: 1,
      });
      // Garde-fou : mieux vaut une erreur visible qu'un job qui attend à 0 %.
      if (!added?.id) {
        throw new Error(`Mise en file impossible pour le job ${data.jobId}`);
      }
      return added.id;
    },
    // Ré-encodage d'un seul clip : même file, nom de tâche différent.
    async enqueueRestyle(data) {
      await bullQueue.add('restyle-clip', data, {
        jobId: `restyle-${data.clipId}-${Date.now()}`,
        removeOnComplete: { age: 3600, count: 100 },
        removeOnFail: { age: 86400, count: 100 },
        attempts: 1,
      });
    },
    /**
     * Position dans la file d'attente, 1 pour le prochain traité.
     * Le worker ne traite qu'un job à la fois : sans cette information,
     * un job en attente est indiscernable d'un job bloqué.
     */
    async position(jobId) {
      const waiting = await bullQueue.getWaiting(0, 100);
      const index = waiting.findIndex((entry) => entry.id === `job-${jobId}`);
      return index === -1 ? null : index + 1;
    },
    async ping() {
      const pong = await redis.ping();
      return pong === 'PONG';
    },
  };

  const app = await buildApp({ store, bus, queue, config, redis });

  // Migrations au démarrage : la stack se lance sans étape manuelle.
  let attempts = 0;
  for (;;) {
    try {
      await store.migrate(app.log);
      break;
    } catch (err) {
      attempts += 1;
      if (attempts >= 20) throw err;
      app.log.warn({ err: err.message, attempts }, 'MySQL pas encore prêt, nouvelle tentative dans 3 s');
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  const shutdown = async (signal) => {
    app.log.info({ signal }, 'arrêt en cours');
    try {
      await app.close();
      await bullQueue.close();
      await bus.close();
      await redis.quit();
      await store.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await app.listen({ port: config.port, host: config.host });
  app.log.info({ authEnabled: config.authEnabled }, 'api démarrée');
}

main().catch((err) => {
  console.error('Démarrage impossible :', err);
  process.exit(1);
});
