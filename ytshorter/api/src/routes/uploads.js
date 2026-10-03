import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { AppError, CODES } from '../lib/errors.js';

// Ingestion par fichier : l'utilisateur envoie sa propre vidéo.
// C'est la voie recommandée pour recycler son propre contenu, sans dépendre
// du téléchargement YouTube.
//
// Le fichier est écrit en flux sur le volume média, jamais chargé en mémoire.
// Il n'est jamais exécuté, jamais servi tel quel : seul le worker le lit.
export default async function uploadRoutes(app) {
  const cfg = app.appConfig;
  const maxBytes = cfg.upload.maxMb * 1024 * 1024;

  app.post(
    '/api/uploads',
    {
      config: {
        rateLimit: {
          max: cfg.rateLimit.jobsMax,
          timeWindow: cfg.rateLimit.window,
          keyGenerator: (request) =>
            request.identity?.userId ? `upload:user:${request.identity.userId}` : `upload:ip:${request.ip}`,
        },
      },
    },
    async (request, reply) => {
      if (cfg.authEnabled && !request.identity.userId) {
        throw new AppError(CODES.UNAUTHORIZED, 'Connectez-vous pour envoyer un fichier.', 401);
      }

      const part = await request.file({ limits: { fileSize: maxBytes, files: 1 } });
      if (!part) {
        throw new AppError(CODES.VALIDATION_FAILED, 'Aucun fichier reçu.', 400);
      }

      const originalName = String(part.filename || 'video').slice(0, 255);
      const extension = path.extname(originalName).toLowerCase();
      if (!cfg.upload.allowedExtensions.includes(extension)) {
        // Le flux doit être consommé, sinon la requête reste ouverte.
        part.file.resume();
        throw new AppError(
          CODES.UNSUPPORTED_FILE,
          `Format non pris en charge. Extensions acceptées : ${cfg.upload.allowedExtensions.join(', ')}.`,
          415,
        );
      }

      const token = crypto.randomBytes(16).toString('hex');
      const uploadDir = path.join(cfg.mediaDir, 'uploads');
      await fsp.mkdir(uploadDir, { recursive: true });
      // Le nom de fichier est entièrement généré : rien de ce que fournit
      // l'utilisateur ne se retrouve dans un chemin.
      const filePath = path.join(uploadDir, `${token}${extension}`);

      try {
        await pipeline(part.file, fs.createWriteStream(filePath));
      } catch (err) {
        await fsp.rm(filePath, { force: true });
        request.log.error({ err: err.message }, 'échec d’écriture du fichier envoyé');
        throw new AppError(CODES.INTERNAL, "L'envoi du fichier a échoué.", 500);
      }

      if (part.file.truncated) {
        await fsp.rm(filePath, { force: true });
        throw new AppError(
          CODES.FILE_TOO_LARGE,
          `Fichier trop volumineux : la limite est de ${cfg.upload.maxMb} Mo.`,
          413,
        );
      }

      const { size } = await fsp.stat(filePath);
      if (size === 0) {
        await fsp.rm(filePath, { force: true });
        throw new AppError(CODES.VALIDATION_FAILED, 'Le fichier envoyé est vide.', 400);
      }

      await app.store.createUpload({
        ownerKey: request.identity.ownerKey,
        token,
        filePath,
        originalName,
        sizeBytes: size,
      });

      request.log.info({ token, size, extension }, 'fichier reçu');
      reply.code(201);
      return { uploadId: token, filename: originalName, sizeBytes: size };
    },
  );
}
