import { credentialsBodySchema } from '../lib/schemas.js';
import { hashPassword, verifyPassword } from '../lib/passwords.js';
import { AppError, CODES, unauthorized } from '../lib/errors.js';

// Routes de comptes. Enregistrées uniquement si AUTH_ENABLED=1.
export default async function authRoutes(app) {
  const authLimit = {
    max: app.appConfig.rateLimit.authMax,
    timeWindow: app.appConfig.rateLimit.window,
  };

  app.post(
    '/api/auth/register',
    { schema: { body: credentialsBodySchema }, config: { rateLimit: authLimit } },
    async (request, reply) => {
      const email = String(request.body.email).trim().toLowerCase();
      const existing = await app.store.getUserByEmail(email);
      if (existing) {
        throw new AppError(CODES.CONFLICT, 'Un compte existe déjà pour cet email.', 409);
      }
      const passwordHash = await hashPassword(request.body.password);
      const id = await app.store.createUser({ email, passwordHash });
      app.setSessionCookie(reply, id);
      reply.code(201);
      return { user: { id, email } };
    },
  );

  app.post(
    '/api/auth/login',
    { schema: { body: credentialsBodySchema }, config: { rateLimit: authLimit } },
    async (request, reply) => {
      const email = String(request.body.email).trim().toLowerCase();
      const user = await app.store.getUserByEmail(email);
      // Message identique dans les deux cas : pas d'énumération de comptes.
      const invalid = unauthorized('Email ou mot de passe incorrect.');
      if (!user) {
        await verifyPassword(request.body.password, 'scrypt$16384$8$1$00$00');
        throw invalid;
      }
      const ok = await verifyPassword(request.body.password, user.passwordHash);
      if (!ok) throw invalid;
      app.setSessionCookie(reply, user.id);
      return { user: { id: user.id, email: user.email } };
    },
  );

  app.post('/api/auth/logout', async (request, reply) => {
    app.clearSessionCookie(reply);
    return { ok: true };
  });

  app.get('/api/auth/me', async (request) => {
    if (!request.identity.userId) return { user: null };
    const user = await app.store.getUserById(request.identity.userId);
    return { user: user ?? null };
  });
}
