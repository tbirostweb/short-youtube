import crypto from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import addFormats from 'ajv-formats';

import { config as defaultConfig } from './config.js';
import { AppError, CODES } from './lib/errors.js';
import healthRoutes from './routes/health.js';
import jobRoutes from './routes/jobs.js';
import clipRoutes from './routes/clips.js';
import uploadRoutes from './routes/uploads.js';
import authRoutes from './routes/auth.js';

const SESSION_COOKIE = 'ytsh_uid';
const ANON_COOKIE = 'ytsh_sid';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 jours

/**
 * Construit l'application Fastify. Les dépendances sont injectées :
 * cela permet de tester les routes avec un stockage en mémoire.
 *
 * @param {object} deps
 * @param {object} deps.store   accès données (voir lib/store-mysql.js)
 * @param {object} deps.bus     bus d'événements de progression
 * @param {object} deps.queue   file de jobs ({ enqueue, ping })
 * @param {object} [deps.config] configuration (défaut : config.js)
 * @param {object} [deps.redis]  client Redis pour la limitation de débit distribuée
 */
export async function buildApp({ store, bus, queue, config = defaultConfig, redis = null, loggerOptions } = {}) {
  const app = Fastify({
    logger: loggerOptions ?? {
      level: config.logLevel,
      // Ne jamais journaliser les en-têtes : ils portent les cookies de session.
      serializers: {
        req(request) {
          return { method: request.method, url: request.url, ip: request.ip };
        },
      },
    },
    trustProxy: true,
    bodyLimit: 64 * 1024,
    ajv: { plugins: [addFormats] },
  });

  app.decorate('store', store);
  app.decorate('bus', bus);
  app.decorate('queue', queue);
  app.decorate('appConfig', config);

  const cookieSecure = config.publicBaseUrl.startsWith('https://');

  await app.register(cookie, {
    secret: config.sessionSecret || crypto.randomBytes(32).toString('hex'),
    parseOptions: {},
  });

  // Envoi de fichiers vidéo : lecture en flux, jamais en mémoire.
  await app.register(multipart, {
    limits: {
      fileSize: config.upload.maxMb * 1024 * 1024,
      files: 1,
      fields: 4,
      parts: 6,
    },
  });

  await app.register(helmet, {
    // L'api ne sert que du JSON et des MP4 ; le front est servi par nginx
    // qui applique sa propre politique de sécurité de contenu.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    hsts: cookieSecure ? { maxAge: 15552000, includeSubDomains: true } : false,
  });

  // --- Identité : utilisateur connecté ou session anonyme signée ----------
  app.decorateRequest('identity', null);
  app.addHook('onRequest', async (request, reply) => {
    let userId = null;
    if (config.authEnabled) {
      const raw = request.cookies?.[SESSION_COOKIE];
      const unsigned = raw ? request.unsignCookie(raw) : null;
      if (unsigned?.valid && /^[0-9]{1,19}$/.test(unsigned.value)) userId = unsigned.value;
    }

    // Session anonyme : sert de clé d'appartenance en mode mono-utilisateur
    // et garde les contrôles d'accès actifs même sans comptes.
    let sid = null;
    const rawSid = request.cookies?.[ANON_COOKIE];
    const unsignedSid = rawSid ? request.unsignCookie(rawSid) : null;
    if (unsignedSid?.valid && /^[a-f0-9]{32}$/.test(unsignedSid.value)) {
      sid = unsignedSid.value;
    } else {
      sid = crypto.randomBytes(16).toString('hex');
      reply.setCookie(ANON_COOKIE, sid, {
        signed: true,
        httpOnly: true,
        sameSite: 'lax',
        secure: cookieSecure,
        path: '/',
        maxAge: COOKIE_MAX_AGE,
      });
    }

    request.identity = {
      userId,
      ownerKey: userId ? `user:${userId}` : `anon:${sid}`,
    };
  });

  app.decorate('setSessionCookie', (reply, userId) => {
    reply.setCookie(SESSION_COOKIE, String(userId), {
      signed: true,
      httpOnly: true,
      sameSite: 'lax',
      secure: cookieSecure,
      path: '/',
      maxAge: COOKIE_MAX_AGE,
    });
  });
  app.decorate('clearSessionCookie', (reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
  });

  // --- Limitation de débit ------------------------------------------------
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.window,
    redis: redis ?? undefined,
    // Clé : le compte quand il existe, sinon l'adresse IP. Se déconnecter ou
    // vider ses cookies ne redonne donc pas un quota neuf.
    keyGenerator: (request) =>
      request.identity?.userId ? `user:${request.identity.userId}` : request.ip,
    // Le plugin *lance* la valeur retournée : on renvoie une AppError afin que
    // le gestionnaire d'erreurs produise le format { error: { code, message } }.
    errorResponseBuilder: () =>
      new AppError(CODES.RATE_LIMITED, 'Trop de requêtes. Réessayez dans quelques minutes.', 429),
  });

  // --- Gestion d'erreurs, format unique { error: { code, message } } ------
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      reply.code(error.statusCode);
      return reply.send({ error: { code: error.code, message: error.message } });
    }
    if (error.validation) {
      reply.code(400);
      return reply.send({
        error: {
          code: CODES.VALIDATION_FAILED,
          message: `Requête invalide : ${error.message}`,
        },
      });
    }
    if (error.statusCode === 429) {
      reply.code(429);
      return reply.send({
        error: { code: CODES.RATE_LIMITED, message: 'Trop de requêtes. Réessayez plus tard.' },
      });
    }
    request.log.error({ err: error }, 'erreur non gérée');
    reply.code(error.statusCode && error.statusCode < 500 ? error.statusCode : 500);
    return reply.send({
      error: { code: CODES.INTERNAL, message: 'Erreur interne du serveur.' },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ error: { code: CODES.NOT_FOUND, message: 'Route inconnue.' } });
  });

  await app.register(healthRoutes);
  await app.register(jobRoutes);
  await app.register(clipRoutes);
  await app.register(uploadRoutes);
  if (config.authEnabled) await app.register(authRoutes);

  return app;
}
