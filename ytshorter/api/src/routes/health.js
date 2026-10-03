// Sonde de santé : vérifie l'accès MySQL et Redis.
export default async function healthRoutes(app) {
  app.get('/health', { config: { rateLimit: false } }, async (request, reply) => {
    const checks = { db: false, redis: false };
    try {
      checks.db = await app.store.ping();
    } catch (err) {
      request.log.warn({ err: err.message }, 'health: mysql injoignable');
    }
    try {
      checks.redis = await app.queue.ping();
    } catch (err) {
      request.log.warn({ err: err.message }, 'health: redis injoignable');
    }
    const ok = checks.db && checks.redis;
    reply.code(ok ? 200 : 503);
    return { status: ok ? 'ok' : 'degraded', ...checks };
  });
}
