import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
// archiver v8 est en modules ES : la classe ZipArchive remplace l'ancienne fabrique.
import { ZipArchive } from 'archiver';
import { createJobBodySchema, jobIdParamsSchema, listJobsQuerySchema } from '../lib/schemas.js';
import { parseYoutubeUrl } from '../lib/youtube.js';
import { AppError, CODES, notFound, forbidden, unauthorized } from '../lib/errors.js';
import { buildSignedClipPath } from '../lib/signing.js';
import { canRestyle, canEditSubtitles } from '../lib/restyle-availability.js';

// Représentation publique d'un clip : jamais le chemin de fichier réel,
// seulement un lien signé à durée de vie limitée.
function publicClip(clip, cfg, capabilities = {}) {
  return {
    id: clip.id,
    idx: clip.idx,
    start: clip.startSeconds,
    end: clip.endSeconds,
    duration: clip.duration,
    score: clip.score,
    hook: clip.hook,
    captionStyle: clip.captionStyle ?? null,
    focusX: clip.focusX ?? null,
    layout: clip.layout ?? null,
    hookOverlay: clip.hookOverlay ?? null,
    restyleStatus: clip.restyleStatus ?? 'idle',
    subtitlesEdited: clip.subtitlesEdited ?? false,
    published: {
      youtube: Boolean(clip.publishedYoutube),
      tiktok: Boolean(clip.publishedTiktok),
    },
    restylable: capabilities.restylable ?? false,
    subtitlesEditable: capabilities.subtitlesEditable ?? false,
    // Marge encore disponible de part et d'autre, en secondes : c'est
    // l'amplitude dans laquelle les bornes peuvent bouger.
    adjustable: {
      before: Number(clip.padStart ?? 0),
      after: Number(clip.padEnd ?? 0),
    },
    downloadUrl: buildSignedClipPath({
      clipId: clip.id,
      ttlSeconds: cfg.signedUrlTtl,
      secret: cfg.signingSecret,
    }),
    youtubeShorts: {
      title: clip.ytTitle,
      description: clip.ytDescription,
      hashtags: clip.ytHashtags,
    },
    tiktok: {
      caption: clip.tiktokCaption,
      hashtags: clip.tiktokHashtags,
    },
  };
}

function publicJob(job, clips, cfg, capabilities = [], queuePosition = null) {
  return {
    id: job.id,
    status: job.status,
    currentStep: job.currentStep,
    progress: job.progress,
    sourceKind: job.sourceKind,
    sourceName: job.sourceName ?? null,
    language: job.language,
    clipCount: job.clipCount,
    targetDuration: job.targetDuration,
    captionStyle: job.captionStyle,
    layout: job.layout,
    hookOverlay: job.hookOverlay,
    seriesMode: job.seriesMode,
    subtitleLanguage: job.subtitleLanguage,
    sourceTitle: job.sourceTitle ?? null,
    error: job.errorCode ? { code: job.errorCode, message: job.errorMessage } : null,
    // Position dans la file, seulement tant que le traitement n'a pas démarré :
    // une attente annoncée est une attente supportable.
    queuePosition,
    clips: clips.map((c, i) => publicClip(c, cfg, capabilities[i] ?? {})),
  };
}

export default async function jobRoutes(app) {
  const cfg = app.appConfig;

  // --- Création d'un job -------------------------------------------------
  app.post(
    '/api/jobs',
    {
      schema: { body: createJobBodySchema },
      config: {
        rateLimit: {
          max: cfg.rateLimit.jobsMax,
          timeWindow: cfg.rateLimit.window,
          // Limite par compte quand l'authentification est active, par IP sinon.
          keyGenerator: (request) =>
            request.identity?.userId ? `jobs:user:${request.identity.userId}` : `jobs:ip:${request.ip}`,
        },
      },
    },
    async (request, reply) => {
      if (cfg.authEnabled && !request.identity.userId) {
        throw unauthorized('Connectez-vous pour lancer une génération.');
      }

      const body = request.body;
      if (body.youtubeUrl && body.uploadId) {
        throw new AppError(
          CODES.VALIDATION_FAILED,
          'Fournissez une URL YouTube ou un fichier, pas les deux.',
          400,
        );
      }

      // Deux sources possibles : une URL YouTube, ou un fichier déjà envoyé.
      let source;
      if (body.uploadId) {
        const upload = await app.store.getUploadByToken(body.uploadId);
        // Message identique si le fichier n'existe pas ou appartient à autrui :
        // pas de moyen de tester l'existence d'un identifiant.
        if (!upload || upload.ownerKey !== request.identity.ownerKey) {
          throw new AppError(CODES.UPLOAD_NOT_FOUND, 'Fichier introuvable. Renvoyez-le.', 404);
        }
        if (upload.consumedAt) {
          throw new AppError(
            CODES.CONFLICT,
            'Ce fichier a déjà servi à une génération. Renvoyez-le pour en lancer une autre.',
            409,
          );
        }
        source = {
          sourceKind: 'upload',
          sourceName: upload.originalName,
          uploadId: upload.id,
          uploadPath: upload.filePath,
        };
      } else {
        const parsed = parseYoutubeUrl(body.youtubeUrl);
        if (!parsed) {
          throw new AppError(
            CODES.INVALID_URL,
            "Cette URL n'est pas une vidéo YouTube valide. Formats acceptés : youtube.com/watch?v=…, youtu.be/…, youtube.com/shorts/…",
            400,
          );
        }
        source = { sourceKind: 'youtube', youtubeUrl: parsed.url, youtubeVideoId: parsed.id };
      }

      const options = {
        language: body.language ?? 'fr',
        subtitleLanguage: body.subtitleLanguage ?? 'source',
        clipCount: body.clipCount ?? 3,
        targetDuration: body.targetDuration ?? 45,
        captionStyle: body.captionStyle ?? 'punch',
        focusX: body.focusX ?? 0.5,
        layout: body.layout ?? 'crop',
        hookOverlay: body.hookOverlay ?? false,
        seriesMode: body.seriesMode ?? false,
      };

      const jobId = await app.store.createJob({
        userId: request.identity.userId,
        ownerKey: request.identity.ownerKey,
        sourceKind: source.sourceKind,
        sourceName: source.sourceName ?? null,
        youtubeUrl: source.youtubeUrl ?? null,
        youtubeVideoId: source.youtubeVideoId ?? null,
        ...options,
      });

      if (source.uploadId) await app.store.consumeUpload(source.uploadId);

      const queuedId = await app.queue.enqueue({
        jobId,
        sourceKind: source.sourceKind,
        youtubeUrl: source.youtubeUrl ?? null,
        youtubeVideoId: source.youtubeVideoId ?? null,
        uploadPath: source.uploadPath ?? null,
        sourceName: source.sourceName ?? null,
        ...options,
      });

      request.log.info({ jobId, queuedId, sourceKind: source.sourceKind }, 'job créé et mis en file');
      reply.code(202);
      return { jobId };
    },
  );

  // --- Historique : uniquement les jobs du demandeur ---------------------
  app.get('/api/jobs', { schema: { querystring: listJobsQuerySchema } }, async (request) => {
    const { limit, offset } = request.query;
    const [jobs, total] = await Promise.all([
      app.store.listJobs(request.identity.ownerKey, { limit, offset }),
      app.store.countJobs(request.identity.ownerKey),
    ]);
    return {
      total,
      limit,
      offset,
      jobs: jobs.map((job) => ({
        id: job.id,
        status: job.status,
        currentStep: job.currentStep,
        progress: job.progress,
        sourceKind: job.sourceKind,
        sourceTitle: job.sourceTitle ?? null,
        sourceName: job.sourceName ?? null,
        language: job.language,
        clipsCount: job.clipsCount,
        error: job.errorCode ? { code: job.errorCode, message: job.errorMessage } : null,
        createdAt: job.createdAt,
      })),
    };
  });

  // --- Suppression d'un job et de ses fichiers ---------------------------
  app.delete('/api/jobs/:id', { schema: { params: jobIdParamsSchema } }, async (request, reply) => {
    const job = await loadOwnedJob(app, request);

    // Un job en cours écrit encore sur le disque : on ne tire pas le tapis
    // sous les pieds du worker.
    if (job.status === 'queued' || job.status === 'processing') {
      throw new AppError(
        CODES.CONFLICT,
        'Ce job est en cours de traitement. Attendez la fin avant de le supprimer.',
        409,
      );
    }

    const mediaRoot = path.resolve(cfg.mediaDir);
    const jobDir = path.resolve(path.join(mediaRoot, String(job.id)));
    if (jobDir.startsWith(mediaRoot + path.sep)) {
      await fsp.rm(jobDir, { recursive: true, force: true });
    }
    await app.store.deleteJob(job.id);

    request.log.info({ jobId: job.id }, 'job supprimé');
    reply.code(204);
    return null;
  });

  // --- Lecture d'un job --------------------------------------------------
  app.get('/api/jobs/:id', { schema: { params: jobIdParamsSchema } }, async (request) => {
    const job = await loadOwnedJob(app, request);
    const clips = await app.store.getClips(job.id);

    const capabilities = await Promise.all(
      clips.map(async (clip) => ({
        restylable: await canRestyle(cfg, job.id, clip.idx),
        subtitlesEditable: await canEditSubtitles(cfg, job.id, clip.idx),
      })),
    );

    const queuePosition =
      job.status === 'queued' && app.queue.position
        ? await app.queue.position(job.id).catch(() => null)
        : null;

    return publicJob(job, clips, cfg, capabilities, queuePosition);
  });

  // --- Archive de tous les clips d'un job ---------------------------------
  // Télécharger cinq clips un par un, c'est cinq fois la même manipulation.
  // L'archive est construite en flux : rien n'est écrit sur le disque, et la
  // mémoire ne monte pas avec la taille des vidéos.
  app.get(
    '/api/jobs/:id/clips.zip',
    { schema: { params: jobIdParamsSchema }, config: { rateLimit: false } },
    async (request, reply) => {
      const job = await loadOwnedJob(app, request);
      const clips = await app.store.getClips(job.id);
      if (clips.length === 0) throw notFound('Ce job ne contient aucun clip.');

      const mediaRoot = path.resolve(cfg.mediaDir);
      // Niveau 0 : une vidéo est déjà compressée, recompresser ne ferait que
      // brûler du CPU pour rien.
      const archive = new ZipArchive({ zlib: { level: 0 } });

      const available = [];
      for (const clip of clips) {
        const filePath = path.resolve(clip.filePath);
        if (!filePath.startsWith(mediaRoot + path.sep)) continue;
        try {
          await fsp.access(filePath);
          available.push({ clip, filePath });
        } catch {
          /* fichier nettoyé : on l'omet plutôt que de casser l'archive */
        }
      }
      if (available.length === 0) throw notFound('Les fichiers de ce job ont été nettoyés.');

      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', `attachment; filename="clips-job-${job.id}.zip"`);
      reply.header('Cache-Control', 'private, no-store');

      archive.on('error', (err) => {
        request.log.error({ err: err.message, jobId: job.id }, 'archive interrompue');
        archive.destroy();
      });

      for (const { clip, filePath } of available) {
        const name = `clip-${String(clip.idx + 1).padStart(2, '0')}.mp4`;
        archive.file(filePath, { name });
      }

      // Un mémo texte : titres et descriptions à portée de copier-coller,
      // même hors ligne.
      archive.append(
        buildPublishNotes(job, available.map((entry) => entry.clip)),
        { name: 'a-publier.txt' },
      );
      archive.finalize();

      return reply.send(archive);
    },
  );

  // --- Flux SSE de progression ------------------------------------------
  app.get(
    '/api/jobs/:id/events',
    { schema: { params: jobIdParamsSchema }, config: { rateLimit: false } },
    async (request, reply) => {
      const job = await loadOwnedJob(app, request);

      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      let closed = false;
      const send = (event, data) => {
        if (closed) return;
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      // État courant immédiatement, pour ne pas perdre la progression déjà faite.
      send('progress', {
        step: job.currentStep,
        progress: job.progress,
        status: job.status,
      });

      const finish = (event, data) => {
        send(event, data);
        cleanup();
        if (!closed) {
          closed = true;
          res.end();
        }
      };

      const onEvent = (payload) => {
        if (payload.status === 'done') {
          finish('done', { step: 'done', progress: 100, status: 'done' });
        } else if (payload.status === 'error') {
          finish('error', {
            step: payload.step ?? 'error',
            progress: payload.progress ?? 0,
            status: 'error',
            error: payload.error ?? { code: CODES.INTERNAL, message: 'Erreur de traitement' },
          });
        } else {
          send('progress', {
            step: payload.step,
            progress: payload.progress,
            status: payload.status ?? 'processing',
          });
        }
      };

      let unsubscribe = null;
      const heartbeat = setInterval(() => {
        if (!closed) res.write(': ping\n\n');
      }, 20000);

      function cleanup() {
        clearInterval(heartbeat);
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
      }

      request.raw.on('close', () => {
        closed = true;
        cleanup();
      });

      // Si le job est déjà terminé, on clôture tout de suite.
      if (job.status === 'done') {
        finish('done', { step: 'done', progress: 100, status: 'done' });
        return;
      }
      if (job.status === 'error') {
        finish('error', {
          step: job.currentStep,
          progress: job.progress,
          status: 'error',
          error: { code: job.errorCode, message: job.errorMessage },
        });
        return;
      }

      unsubscribe = await app.bus.subscribe(job.id, onEvent);
      if (closed) cleanup();
    },
  );
}

// Contrôle d'appartenance : un identifiant deviné dans l'URL ne donne rien.
async function loadOwnedJob(app, request) {
  const job = await app.store.getJob(request.params.id);
  if (!job) throw notFound('Job introuvable.');
  if (job.ownerKey !== request.identity.ownerKey) {
    request.log.warn({ jobId: request.params.id }, 'accès refusé à un job (appartenance)');
    throw forbidden("Ce job ne vous appartient pas.");
  }
  return job;
}

/** Mémo de publication joint à l'archive : tout le texte, dans l'ordre. */
function buildPublishNotes(job, clips) {
  const lines = [
    `Clips générés depuis : ${job.sourceTitle || job.sourceName || 'source inconnue'}`,
    `Nombre de clips : ${clips.length}`,
    job.seriesMode ? 'Mode série : publier dans cet ordre, un épisode à la fois.' : '',
    '',
  ];

  clips.forEach((clip, index) => {
    const file = `clip-${String(clip.idx + 1).padStart(2, '0')}.mp4`;
    lines.push(
      '='.repeat(70),
      `${file}${job.seriesMode ? `   (partie ${index + 1}/${clips.length})` : ''}`,
      '='.repeat(70),
      '',
      '--- YOUTUBE SHORTS ---',
      'Titre :',
      clip.ytTitle ?? '',
      '',
      'Description :',
      [clip.ytDescription ?? '', (clip.ytHashtags ?? []).join(' ')].filter(Boolean).join('\n\n'),
      '',
      '--- TIKTOK ---',
      'Légende (un seul champ) :',
      [clip.tiktokCaption ?? '', (clip.tiktokHashtags ?? []).join(' ')].filter(Boolean).join(' '),
      '',
      '',
    );
  });
  return lines.join('\n');
}
