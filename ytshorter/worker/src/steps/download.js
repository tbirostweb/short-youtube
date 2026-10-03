import fs from 'node:fs/promises';
import path from 'node:path';
import { run } from '../lib/exec.js';
import { probe } from '../lib/ffmpeg.js';
import { PipelineError, CODES } from '../lib/errors.js';

// Étape 1 : récupération de la vidéo source avec yt-dlp.
//
// La fonction est volontairement isolée derrière `resolveSource` : brancher
// plus tard un envoi de fichier direct (cas d'usage « je recycle ma propre
// vidéo ») revient à fournir un autre `sourcePath` au reste du pipeline.

/**
 * Arguments cookies pour yt-dlp, si un fichier de cookies est présent.
 * Les cookies d'une session YouTube connectée permettent de télécharger
 * depuis une IP de datacenter, que YouTube bloque sinon.
 */
async function cookieArgs(config, logger) {
  const file = config.ytDlpCookiesFile;
  if (!file) return [];
  try {
    await fs.access(file);
    return ['--cookies', file];
  } catch {
    return [];
  }
}

/** Métadonnées de la vidéo, sans téléchargement du média. */
export async function fetchVideoInfo({ url, config, logger }) {
  try {
    const cookies = await cookieArgs(config, logger);
    const { stdout } = await run(
      config.ytDlp,
      ['--dump-single-json', '--no-playlist', '--no-warnings', '--socket-timeout', '30', ...cookies, url],
      { timeoutMs: 3 * 60 * 1000 },
    );
    const info = JSON.parse(stdout);
    return {
      title: info.title ?? '',
      description: (info.description ?? '').slice(0, 4000),
      duration: Number(info.duration ?? 0),
      channel: info.channel ?? info.uploader ?? '',
    };
  } catch (err) {
    logger?.error({ err: err.message }, 'yt-dlp : lecture des métadonnées impossible');
    throw new PipelineError(CODES.DOWNLOAD_FAILED, undefined, err);
  }
}

export async function downloadSource({ url, jobDir, config, logger, onProgress }) {
  const info = await fetchVideoInfo({ url, config, logger });

  const maxSeconds = config.maxVideoMinutes * 60;
  if (info.duration && info.duration > maxSeconds) {
    throw new PipelineError(
      CODES.VIDEO_TOO_LONG,
      `Cette vidéo dure ${Math.round(info.duration / 60)} minutes, la limite est de ${config.maxVideoMinutes} minutes.`,
    );
  }

  const sourcePath = path.join(jobDir, 'source.mp4');
  const cookies = await cookieArgs(config, logger);

  try {
    await run(
      config.ytDlp,
      [
        '-f', 'bv*[height<=1080]+ba/b[height<=1080]',
        '--merge-output-format', 'mp4',
        '--no-playlist',
        '--no-warnings',
        '--newline',
        '--retries', '3',
        '--fragment-retries', '3',
        '--socket-timeout', '30',
        '--max-filesize', `${config.maxSourceMb}m`,
        ...cookies,
        '-o', sourcePath,
        url,
      ],
      {
        timeoutMs: 2 * 60 * 60 * 1000,
        onStdoutLine: (line) => {
          const m = /\[download\]\s+([\d.]+)%/.exec(line);
          if (m && onProgress) onProgress(Math.min(1, Number(m[1]) / 100));
        },
      },
    );
  } catch (err) {
    logger?.error({ err: err.message }, 'yt-dlp : téléchargement impossible');
    throw new PipelineError(CODES.DOWNLOAD_FAILED, undefined, err);
  }

  try {
    await fs.access(sourcePath);
  } catch {
    throw new PipelineError(
      CODES.DOWNLOAD_FAILED,
      'Le fichier téléchargé est introuvable (vidéo trop volumineuse ou format indisponible).',
    );
  }

  const media = await probe(sourcePath, config);
  if (!media.duration) {
    throw new PipelineError(CODES.DOWNLOAD_FAILED, 'Le fichier téléchargé est illisible.');
  }
  if (media.duration > maxSeconds) {
    throw new PipelineError(
      CODES.VIDEO_TOO_LONG,
      `Cette vidéo dure ${Math.round(media.duration / 60)} minutes, la limite est de ${config.maxVideoMinutes} minutes.`,
    );
  }
  if (!media.hasAudio) {
    throw new PipelineError(CODES.NO_SPEECH, 'Cette vidéo ne contient aucune piste audio.');
  }

  return {
    sourcePath,
    title: info.title,
    description: info.description,
    duration: media.duration || info.duration,
    width: media.width,
    height: media.height,
  };
}
