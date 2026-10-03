import fs from 'node:fs/promises';
import path from 'node:path';
import { probe } from '../lib/ffmpeg.js';
import { PipelineError, CODES } from '../lib/errors.js';
import { downloadSource } from './download.js';
import { parseYoutubeUrl } from '../lib/youtube.js';

// Résolution de la source du job. Deux voies, une seule sortie :
// le reste du pipeline ne connaît qu'un `sourcePath`.
//
//   - youtube : téléchargement par yt-dlp ;
//   - upload  : fichier envoyé par l'utilisateur, déplacé dans le dossier du job.
//
// La voie "upload" est celle à privilégier pour recycler son propre contenu :
// elle ne dépend pas du téléchargement YouTube.

/** Contrôles communs aux deux sources. */
async function inspectSource(sourcePath, config) {
  const media = await probe(sourcePath, config).catch(() => null);
  if (!media || !media.duration) {
    throw new PipelineError(
      CODES.DOWNLOAD_FAILED,
      "Ce fichier n'est pas une vidéo lisible.",
    );
  }
  const maxSeconds = config.maxVideoMinutes * 60;
  if (media.duration > maxSeconds) {
    throw new PipelineError(
      CODES.VIDEO_TOO_LONG,
      `Cette vidéo dure ${Math.round(media.duration / 60)} minutes, la limite est de ${config.maxVideoMinutes} minutes.`,
    );
  }
  if (!media.hasAudio) {
    throw new PipelineError(CODES.NO_SPEECH, 'Cette vidéo ne contient aucune piste audio.');
  }
  return media;
}

/** Déplace le fichier envoyé dans le dossier du job, puis le contrôle. */
export async function useUploadedSource({ uploadPath, sourceName, jobDir, config, logger }) {
  if (!uploadPath) {
    throw new PipelineError(CODES.DOWNLOAD_FAILED, 'Fichier envoyé introuvable.');
  }
  try {
    await fs.access(uploadPath);
  } catch {
    throw new PipelineError(
      CODES.DOWNLOAD_FAILED,
      'Le fichier envoyé a expiré ou a déjà été nettoyé. Renvoyez-le.',
    );
  }

  const extension = path.extname(uploadPath).toLowerCase() || '.mp4';
  const target = path.join(jobDir, `source${extension}`);

  try {
    await fs.rename(uploadPath, target);
  } catch (err) {
    // rename échoue entre deux systèmes de fichiers : on recopie.
    if (err.code !== 'EXDEV') throw err;
    await fs.copyFile(uploadPath, target);
    await fs.rm(uploadPath, { force: true });
  }

  const media = await inspectSource(target, config);
  logger?.info({ duration: media.duration, name: sourceName }, 'fichier envoyé pris en charge');

  return {
    sourcePath: target,
    // Le nom du fichier sert de titre : c'est la seule information disponible.
    title: String(sourceName || path.basename(target)).replace(/\.[^.]+$/, '').slice(0, 200),
    description: '',
    duration: media.duration,
    width: media.width,
    height: media.height,
  };
}

/** Point d'entrée unique du pipeline. */
export async function resolveSource({ job, jobDir, config, logger, onProgress }) {
  if (job.sourceKind === 'upload') {
    const source = await useUploadedSource({
      uploadPath: job.uploadPath,
      sourceName: job.sourceName,
      jobDir,
      config,
      logger,
    });
    onProgress?.(1);
    return source;
  }

  // Défense en profondeur : l'api a déjà validé l'URL, le worker la revalide
  // avant de la passer à yt-dlp. Aucune chaîne arbitraire n'atteint la commande.
  const parsed = parseYoutubeUrl(job.youtubeUrl);
  if (!parsed) {
    throw new PipelineError(CODES.INVALID_URL, "L'URL du job n'est pas une vidéo YouTube valide.");
  }
  return downloadSource({ url: parsed.url, jobDir, config, logger, onProgress });
}
