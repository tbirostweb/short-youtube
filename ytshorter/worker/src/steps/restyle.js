import fs from 'node:fs/promises';
import path from 'node:path';
import { renderVertical, probe } from '../lib/ffmpeg.js';
import { buildAss, wordsToLines, NO_CAPTIONS } from '../lib/ass.js';
import { buildTrackingCommands } from './tracking.js';
import { PipelineError, CODES } from '../lib/errors.js';

// Re-stylisation d'un clip déjà produit.
//
// Coût : une seule passe d'encodage sur un extrait court. Aucun téléchargement,
// aucune transcription, aucun appel LLM — donc aucun quota gratuit consommé.
// Cela suppose que la découpe (`cut_XX.mp4`) et les mots horodatés
// (`words.json`) sont encore présents : c'est le rôle de KEEP_CUTS_FOR_RESTYLE.

const pad = (n) => String(n).padStart(2, '0');

// Durée minimale d'un clip publiable, en secondes.
const MIN_DURATION = 5;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export async function restyleClip({
  clipId,
  captionStyle,
  focusX,
  layout,
  hookOverlay,
  // Nouvelles bornes, en temps de la vidéo source. Bornées à la marge
  // conservée autour de la découpe : au-delà, les images n'existent plus.
  startSeconds,
  endSeconds,
  // Sous-titres corrigés à la main, en temps absolu.
  lines,
  db,
  config,
  logger,
}) {
  const clip = await db.getClip(clipId);
  if (!clip) throw new PipelineError(CODES.INTERNAL, 'Clip introuvable.');

  const job = await db.getJob(clip.job_id);
  if (!job) throw new PipelineError(CODES.INTERNAL, 'Job introuvable.');

  // Réglage explicite, sinon celui déjà appliqué au clip, sinon celui du job.
  const pick = (asked, clipValue, jobValue) =>
    asked !== undefined && asked !== null ? asked : clipValue ?? jobValue;

  const style = pick(captionStyle, clip.caption_style, job.caption_style);
  const focus = pick(focusX, clip.focus_x, job.focus_x);
  const useLayout = pick(layout, clip.layout, job.layout ?? 'crop');
  const showHook = Boolean(
    pick(
      hookOverlay,
      clip.hook_overlay === null ? null : Boolean(clip.hook_overlay),
      Boolean(job.hook_overlay),
    ),
  );

  const jobDir = path.join(config.mediaDir, String(clip.job_id));
  const base = `clip_${pad(clip.idx)}`;
  const cutName = `cut_${pad(clip.idx)}.mp4`;
  const cutPath = path.join(jobDir, cutName);
  // Sous-titres traduits s'il y en a, originaux sinon.
  const subtitleLanguage = job.subtitle_language;
  const translatedPath =
    subtitleLanguage && subtitleLanguage !== 'source'
      ? path.join(jobDir, `words.${subtitleLanguage}.json`)
      : null;
  const wordsPath = path.join(jobDir, 'words.json');

  // Sans découpe ni transcription, il n'y a rien à ré-encoder : on le dit,
  // on ne fabrique pas un résultat dégradé en silence.
  try {
    await fs.access(cutPath);
  } catch {
    throw new PipelineError(CODES.RESTYLE_UNAVAILABLE);
  }

  let words = [];
  for (const candidate of [translatedPath, wordsPath].filter(Boolean)) {
    try {
      words = JSON.parse(await fs.readFile(candidate, 'utf8')).words ?? [];
      if (words.length) break;
    } catch {
      /* on essaie la source suivante */
    }
  }
  if (words.length === 0) throw new PipelineError(CODES.RESTYLE_UNAVAILABLE);

  // --- Bornes : ajustables dans la limite de la marge de découpe ----------
  const oldStart = Number(clip.start_seconds);
  const oldEnd = Number(clip.end_seconds);
  const padStart = Number(clip.pad_start ?? 0);
  const padEnd = Number(clip.pad_end ?? 0);

  const start =
    startSeconds === undefined || startSeconds === null
      ? oldStart
      : clamp(Number(startSeconds), oldStart - padStart, oldEnd + padEnd - MIN_DURATION);
  const end =
    endSeconds === undefined || endSeconds === null
      ? oldEnd
      : clamp(Number(endSeconds), start + MIN_DURATION, oldEnd + padEnd);

  // Position du début du clip dans le fichier de découpe.
  const trimStart = Math.max(0, padStart + (start - oldStart));
  const duration = end - start;

  // --- Sous-titres : corrigés à la main, déjà corrigés, ou déduits des mots -
  const linesPath = path.join(jobDir, `${base}.lines.json`);
  let effectiveLines = null;
  if (Array.isArray(lines) && lines.length) {
    effectiveLines = lines;
  } else {
    try {
      const stored = JSON.parse(await fs.readFile(linesPath, 'utf8'));
      if (Array.isArray(stored) && stored.length) effectiveLines = stored;
    } catch {
      /* aucune ligne enregistrée : le regroupement automatique s'applique */
    }
  }

  const burnCaptions = style !== NO_CAPTIONS;
  if (burnCaptions || showHook) {
    await fs.writeFile(
      path.join(jobDir, `${base}.ass`),
      buildAss({
        words: burnCaptions ? words : [],
        clipStart: start,
        clipEnd: end,
        style: burnCaptions ? style : 'clean',
        hook: showHook ? clip.hook : null,
        lines: burnCaptions ? effectiveLines : null,
      }),
      'utf8',
    );
  }

  // Le fichier de lignes reflète toujours ce qui vient d'être incrusté.
  await fs.writeFile(
    linesPath,
    JSON.stringify(
      effectiveLines ?? wordsToLines({ words, clipStart: start, clipEnd: end, style }),
    ),
    'utf8',
  );

  let sendcmdFile = null;
  if (config.trackingCrop && useLayout === 'crop') {
    sendcmdFile = await buildTrackingCommands({
      videoPath: cutPath,
      workDir: jobDir,
      name: base,
      config,
      logger,
    });
  }

  // On encode vers un fichier temporaire puis on remplace : le clip servi
  // n'est jamais un fichier à moitié écrit.
  const tempName = `${base}.restyle.mp4`;
  await renderVertical({
    input: cutName,
    output: tempName,
    assFile: burnCaptions || showHook ? `${base}.ass` : null,
    focusX: focus,
    sendcmdFile,
    layout: useLayout,
    cwd: jobDir,
    durationSeconds: duration,
    trimStart,
    config,
  });

  const finalPath = path.join(jobDir, `${base}.mp4`);
  await fs.rename(path.join(jobDir, tempName), finalPath);
  if (sendcmdFile) await fs.rm(path.join(jobDir, sendcmdFile), { force: true });

  const info = await probe(finalPath, config);
  await db.finishRestyle(clipId, {
    captionStyle: style,
    focusX: focus,
    layout: useLayout,
    hookOverlay: showHook,
    duration: info.duration,
    startSeconds: start,
    endSeconds: end,
    // La marge restante suit le déplacement des bornes.
    padStart: padStart + (start - oldStart),
    padEnd: padEnd - (end - oldEnd),
    subtitlesEdited: Boolean(clip.subtitles_edited) || (Array.isArray(lines) && lines.length > 0),
  });

  logger?.info(
    {
      clipId,
      style,
      focus,
      layout: useLayout,
      hook: showHook,
      start,
      end,
      duration: info.duration,
      editedLines: Array.isArray(lines) ? lines.length : 0,
    },
    'clip ré-encodé',
  );
  return {
    clipId,
    captionStyle: style,
    focusX: focus,
    layout: useLayout,
    hookOverlay: showHook,
    startSeconds: start,
    endSeconds: end,
    duration: info.duration,
  };
}
