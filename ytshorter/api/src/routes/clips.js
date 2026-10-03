import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  clipIdParamsSchema,
  downloadQuerySchema,
  restyleBodySchema,
  subtitlesBodySchema,
  publishedBodySchema,
} from '../lib/schemas.js';
import { verifyClipToken } from '../lib/signing.js';
import { canRestyle } from '../lib/restyle-availability.js';
import { readLines, buildSrt, buildVtt } from '../lib/clip-files.js';
import { AppError, CODES, notFound, forbidden } from '../lib/errors.js';

// Téléchargement du MP4 final.
// L'autorisation est portée par la signature HMAC du lien, émise par
// GET /api/jobs/:id après contrôle d'appartenance. Le chemin de fichier
// n'apparaît jamais côté client et ne peut pas être fourni par le client.
export default async function clipRoutes(app) {
  const cfg = app.appConfig;

  // --- Re-stylisation d'un clip ------------------------------------------
  // Ré-encode un seul clip avec un autre style de sous-titres ou un autre
  // point de focus. Aucun téléchargement, aucune transcription, aucun appel
  // LLM : rien n'est reconsommé sur les quotas gratuits.
  app.post(
    '/api/clips/:id/restyle',
    {
      schema: { params: clipIdParamsSchema, body: restyleBodySchema },
      config: {
        rateLimit: {
          max: cfg.rateLimit.restyleMax,
          timeWindow: cfg.rateLimit.window,
          keyGenerator: (request) =>
            request.identity?.userId ? `restyle:user:${request.identity.userId}` : `restyle:ip:${request.ip}`,
        },
      },
    },
    async (request, reply) => {
      const clip = await app.store.getClipWithOwner(request.params.id);
      if (!clip) throw notFound('Clip introuvable.');
      if (clip.ownerKey !== request.identity.ownerKey) {
        request.log.warn({ clipId: request.params.id }, 'accès refusé à un clip (appartenance)');
        throw forbidden("Ce clip ne vous appartient pas.");
      }
      if (clip.restyleStatus === 'queued' || clip.restyleStatus === 'processing') {
        throw new AppError(
          CODES.RESTYLE_IN_PROGRESS,
          'Ce clip est déjà en cours de ré-encodage.',
          409,
        );
      }

      if (!(await canRestyle(cfg, clip.jobId, clip.idx))) {
        throw new AppError(
          CODES.RESTYLE_UNAVAILABLE,
          "Les fichiers de découpe de ce job ont été nettoyés : le style ne peut plus être changé. Relancez une génération.",
          410,
        );
      }

      // Bornes : le serveur les ramène dans la marge réellement disponible.
      const bounds = clampBounds(clip, request.body);

      const captionStyle = request.body.captionStyle ?? clip.captionStyle ?? undefined;
      const focusX = request.body.focusX ?? clip.focusX ?? undefined;
      const layout = request.body.layout ?? clip.layout ?? undefined;
      const hookOverlay = request.body.hookOverlay ?? clip.hookOverlay ?? undefined;

      await app.store.setClipRestyleStatus(clip.id, 'queued');
      await app.queue.enqueueRestyle({
        clipId: clip.id,
        jobId: clip.jobId,
        captionStyle,
        focusX,
        layout,
        hookOverlay,
        ...bounds,
      });

      request.log.info(
        { clipId: clip.id, captionStyle, focusX, layout, hookOverlay, ...bounds },
        're-stylisation demandée',
      );
      reply.code(202);
      return { status: 'queued' };
    },
  );

  // --- Suivi de publication ----------------------------------------------
  // Publier reste manuel (les plateformes verrouillent en privé les envois
  // d'applications non auditées), mais l'app se souvient de ce qui est fait.
  app.post(
    '/api/clips/:id/published',
    { schema: { params: clipIdParamsSchema, body: publishedBodySchema } },
    async (request, reply) => {
      const clip = await loadOwnedClip(app, request);
      const { platform } = request.body;
      const published = request.body.published ?? true;

      await app.store.setClipPublished(clip.id, platform, published);
      request.log.info({ clipId: clip.id, platform, published }, 'statut de publication mis à jour');

      reply.code(200);
      return { clipId: clip.id, platform, published };
    },
  );

  // --- Sous-titres : lecture, correction, export -------------------------
  app.get('/api/clips/:id/subtitles', { schema: { params: clipIdParamsSchema } }, async (request) => {
    const clip = await loadOwnedClip(app, request);
    const lines = await readLines(cfg, clip.jobId, clip.idx);
    if (!lines) {
      throw new AppError(
        CODES.SUBTITLES_UNAVAILABLE,
        "Les sous-titres de ce clip ne sont plus modifiables. Relancez une génération.",
        410,
      );
    }
    // Temps locaux au clip : c'est ce que la personne voit dans le lecteur.
    return {
      clipId: clip.id,
      duration: clip.duration,
      lines: toLocal(lines, clip.startSeconds, clip.duration),
    };
  });

  app.put(
    '/api/clips/:id/subtitles',
    {
      schema: { params: clipIdParamsSchema, body: subtitlesBodySchema },
      config: {
        rateLimit: {
          max: cfg.rateLimit.restyleMax,
          timeWindow: cfg.rateLimit.window,
          keyGenerator: (request) =>
            request.identity?.userId ? `subs:user:${request.identity.userId}` : `subs:ip:${request.ip}`,
        },
      },
    },
    async (request, reply) => {
      const clip = await loadOwnedClip(app, request);
      if (clip.restyleStatus === 'queued' || clip.restyleStatus === 'processing') {
        throw new AppError(CODES.RESTYLE_IN_PROGRESS, 'Ce clip est déjà en cours de ré-encodage.', 409);
      }
      if (!(await canRestyle(cfg, clip.jobId, clip.idx))) {
        throw new AppError(
          CODES.RESTYLE_UNAVAILABLE,
          "Les fichiers de découpe de ce job ont été nettoyés : les sous-titres ne peuvent plus être modifiés.",
          410,
        );
      }

      const duration = Number(clip.duration) || Number(clip.endSeconds) - Number(clip.startSeconds);
      const lines = sanitizeLines(request.body.lines, duration);
      if (lines.length === 0) {
        throw new AppError(CODES.VALIDATION_FAILED, 'Aucune ligne de sous-titre exploitable.', 400);
      }

      await app.store.setClipRestyleStatus(clip.id, 'queued');
      await app.queue.enqueueRestyle({
        clipId: clip.id,
        jobId: clip.jobId,
        // Le worker écrit le fichier de lignes : l'api ne touche pas au volume.
        lines: lines.map((line) => ({
          start: Number((line.start + Number(clip.startSeconds)).toFixed(3)),
          end: Number((line.end + Number(clip.startSeconds)).toFixed(3)),
          text: line.text,
        })),
      });

      request.log.info({ clipId: clip.id, lines: lines.length }, 'sous-titres corrigés');
      reply.code(202);
      return { status: 'queued', lines: lines.length };
    },
  );

  // Export des sous-titres, pour publier sans incrustation ou retoucher ailleurs.
  for (const [suffix, build, type] of [
    ['srt', buildSrt, 'application/x-subrip; charset=utf-8'],
    ['vtt', buildVtt, 'text/vtt; charset=utf-8'],
  ]) {
    app.get(
      `/api/clips/:id/subtitles.${suffix}`,
      { schema: { params: clipIdParamsSchema } },
      async (request, reply) => {
        const clip = await loadOwnedClip(app, request);
        const lines = await readLines(cfg, clip.jobId, clip.idx);
        if (!lines) {
          throw new AppError(
            CODES.SUBTITLES_UNAVAILABLE,
            'Les sous-titres de ce clip ne sont plus disponibles.',
            410,
          );
        }
        const filename = `clip-${clip.jobId}-${String(clip.idx + 1).padStart(2, '0')}.${suffix}`;
        reply.header('Content-Type', type);
        reply.header('Content-Disposition', `attachment; filename="${filename}"`);
        return build(toLocal(lines, clip.startSeconds, clip.duration));
      },
    );
  }

  app.get(
    '/api/clips/:id/download',
    {
      schema: { params: clipIdParamsSchema, querystring: downloadQuerySchema },
      config: { rateLimit: false },
    },
    async (request, reply) => {
      const clipId = request.params.id;
      const check = verifyClipToken({
        clipId,
        expiresAt: request.query.exp,
        signature: request.query.sig,
        secret: cfg.signingSecret,
      });

      if (!check.ok) {
        if (check.reason === 'expired') {
          throw new AppError(CODES.LINK_EXPIRED, 'Lien de téléchargement expiré, rechargez la page.', 410);
        }
        throw new AppError(CODES.FORBIDDEN, 'Lien de téléchargement invalide.', 403);
      }

      const clip = await app.store.getClipWithOwner(clipId);
      if (!clip) throw notFound('Clip introuvable.');

      // Garde-fou : le fichier doit se trouver dans le volume média.
      const mediaRoot = path.resolve(cfg.mediaDir);
      const filePath = path.resolve(clip.filePath);
      if (filePath !== mediaRoot && !filePath.startsWith(mediaRoot + path.sep)) {
        request.log.error({ clipId, filePath }, 'chemin de clip hors du volume média');
        throw notFound('Fichier introuvable.');
      }

      let stat;
      try {
        stat = await fsp.stat(filePath);
      } catch {
        throw notFound('Fichier introuvable ou déjà nettoyé.');
      }

      const filename = `clip-${clip.jobId}-${String(clip.idx + 1).padStart(2, '0')}.mp4`;
      reply.header('Content-Type', 'video/mp4');
      reply.header('Accept-Ranges', 'bytes');
      reply.header('Cache-Control', 'private, max-age=0, no-store');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);

      // Support des requêtes Range : permet la lecture et le déplacement
      // dans le lecteur <video> du navigateur.
      const range = request.headers.range;
      const match = /^bytes=(\d*)-(\d*)$/.exec(range || '');
      if (match) {
        let start = match[1] === '' ? null : Number(match[1]);
        let end = match[2] === '' ? null : Number(match[2]);
        if (start === null) {
          // suffixe : bytes=-N
          const length = end ?? 0;
          start = Math.max(0, stat.size - length);
          end = stat.size - 1;
        } else if (end === null || end >= stat.size) {
          end = stat.size - 1;
        }
        if (start > end || start >= stat.size) {
          reply.header('Content-Range', `bytes */${stat.size}`);
          reply.code(416);
          return reply.send();
        }
        reply.code(206);
        reply.header('Content-Range', `bytes ${start}-${end}/${stat.size}`);
        reply.header('Content-Length', end - start + 1);
        return reply.send(fs.createReadStream(filePath, { start, end }));
      }

      reply.header('Content-Length', stat.size);
      return reply.send(fs.createReadStream(filePath));
    },
  );
}

// --- Utilitaires ---------------------------------------------------------

/** Charge un clip après contrôle d'appartenance. */
async function loadOwnedClip(app, request) {
  const clip = await app.store.getClipWithOwner(request.params.id);
  if (!clip) throw notFound('Clip introuvable.');
  if (clip.ownerKey !== request.identity.ownerKey) {
    request.log.warn({ clipId: request.params.id }, 'accès refusé à un clip (appartenance)');
    throw forbidden("Ce clip ne vous appartient pas.");
  }
  return clip;
}

/** Passe des temps absolus aux temps locaux du clip, bornés à sa durée. */
function toLocal(lines, clipStart, duration) {
  const span = Number(duration) || 0;
  return lines
    .map((line) => ({
      start: Math.max(0, Number(line.start) - Number(clipStart)),
      end: Math.min(span || Number(line.end), Number(line.end) - Number(clipStart)),
      text: String(line.text ?? ''),
    }))
    .filter((line) => line.end > line.start && line.text.trim())
    .map((line) => ({
      start: Number(line.start.toFixed(3)),
      end: Number(line.end.toFixed(3)),
      text: line.text,
    }));
}

/**
 * Nettoie les lignes reçues : temps croissants, sans chevauchement, dans la
 * durée du clip. Une ligne inexploitable est écartée plutôt que de faire
 * échouer toute la correction.
 */
export function sanitizeLines(lines, duration) {
  const span = Number(duration) > 0 ? Number(duration) : Infinity;
  const cleaned = [];

  for (const raw of lines ?? []) {
    const text = String(raw.text ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;

    let start = Math.max(0, Number(raw.start));
    let end = Math.min(span, Number(raw.end));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 0.08) continue;

    const previous = cleaned[cleaned.length - 1];
    if (previous && start < previous.end) start = previous.end;
    if (end - start < 0.08) continue;

    cleaned.push({ start, end, text });
  }
  return cleaned;
}

/** Ramène les bornes demandées dans la marge conservée autour de la découpe. */
export function clampBounds(clip, body) {
  const hasStart = body.startSeconds !== undefined;
  const hasEnd = body.endSeconds !== undefined;
  if (!hasStart && !hasEnd) return {};

  const start = Number(clip.startSeconds);
  const end = Number(clip.endSeconds);
  const padStart = Number(clip.padStart ?? 0);
  const padEnd = Number(clip.padEnd ?? 0);
  const MIN = 5;

  const newStart = hasStart
    ? Math.max(start - padStart, Math.min(Number(body.startSeconds), end + padEnd - MIN))
    : start;
  const newEnd = hasEnd
    ? Math.min(end + padEnd, Math.max(Number(body.endSeconds), newStart + MIN))
    : end;

  return {
    startSeconds: Number(newStart.toFixed(3)),
    endSeconds: Number(newEnd.toFixed(3)),
  };
}
