import fs from 'node:fs/promises';
import path from 'node:path';
import { cutClip, renderVertical, probe } from '../lib/ffmpeg.js';
import { buildAss, wordsToLines, NO_CAPTIONS } from '../lib/ass.js';
import { buildTrackingCommands } from './tracking.js';

// Étapes 4 à 6 : découpe, puis recadrage vertical + sous-titres incrustés
// dans une seule passe d'encodage.

const pad = (n) => String(n).padStart(2, '0');

/**
 * Découpe précise de chaque extrait, avec ré-encodage.
 *
 * Chaque découpe déborde volontairement de quelques secondes de part et
 * d'autre. Cette marge ne coûte presque rien en disque et change tout à
 * l'usage : elle permet de rattraper après coup un extrait qui commence une
 * seconde trop tard, sans conserver la vidéo source ni tout relancer.
 */
export async function cutClips({
  clips,
  sourcePath,
  jobDir,
  sourceDuration = 0,
  config,
  logger,
  onProgress,
}) {
  const cuts = [];
  const padSeconds = Math.max(0, config.cutPadSeconds ?? 0);

  for (let i = 0; i < clips.length; i += 1) {
    const clip = clips[i];
    const padStart = Math.min(padSeconds, clip.start);
    const padEnd = sourceDuration
      ? Math.min(padSeconds, Math.max(0, sourceDuration - clip.end))
      : padSeconds;

    const output = path.join(jobDir, `cut_${pad(i)}.mp4`);
    await cutClip({
      input: sourcePath,
      output,
      start: clip.start - padStart,
      end: clip.end + padEnd,
      config,
      onProgress: (ratio) => onProgress?.((i + ratio) / clips.length),
    });
    logger?.info({ idx: i, start: clip.start, end: clip.end, padStart, padEnd }, 'extrait découpé');
    cuts.push({ ...clip, idx: i, cutPath: output, padStart, padEnd });
    onProgress?.((i + 1) / clips.length);
  }
  return cuts;
}

/**
 * Recadrage 9:16 + incrustation des sous-titres karaoké, une seule passe.
 * Le fichier ASS et le fichier de commandes de suivi sont référencés par un
 * nom simple grâce au `cwd` positionné sur le dossier du job.
 */
export async function renderClips({
  cuts,
  jobDir,
  words,
  captionStyle,
  focusX,
  layout = 'crop',
  hookOverlay = false,
  config,
  logger,
  onProgress,
}) {
  const finals = [];

  for (let i = 0; i < cuts.length; i += 1) {
    const cut = cuts[i];
    const base = `clip_${pad(i)}`;
    const assName = `${base}.ass`;
    const finalName = `${base}.mp4`;

    // Style « aucun » : pas de fichier ASS, donc pas de filtre d'incrustation.
    // L'accroche, elle, reste affichable si elle a été demandée.
    const burnCaptions = captionStyle !== NO_CAPTIONS;
    if (burnCaptions || hookOverlay) {
      const ass = buildAss({
        words: burnCaptions ? words : [],
        clipStart: cut.start,
        clipEnd: cut.end,
        style: burnCaptions ? captionStyle : 'clean',
        hook: hookOverlay ? cut.hook : null,
      });
      await fs.writeFile(path.join(jobDir, assName), ass, 'utf8');
    }

    // Les lignes réellement incrustées sont écrites à côté du clip : c'est ce
    // que l'interface propose de corriger, donc exactement ce qui est à l'écran.
    await fs.writeFile(
      path.join(jobDir, `${base}.lines.json`),
      JSON.stringify(
        wordsToLines({
          words,
          clipStart: cut.start,
          clipEnd: cut.end,
          style: burnCaptions ? captionStyle : 'clean',
        }),
      ),
      'utf8',
    );

    const sendcmdFile = await maybeTrack({
      cutPath: cut.cutPath,
      jobDir,
      base,
      layout,
      config,
      logger,
    });

    await renderVertical({
      input: path.basename(cut.cutPath),
      output: finalName,
      assFile: burnCaptions || hookOverlay ? assName : null,
      focusX,
      sendcmdFile,
      layout,
      cwd: jobDir,
      durationSeconds: cut.end - cut.start,
      trimStart: cut.padStart ?? 0,
      config,
      onProgress: (ratio) => onProgress?.((i + ratio) / cuts.length),
    });

    const finalPath = path.join(jobDir, finalName);
    const info = await probe(finalPath, config);
    logger?.info(
      { idx: i, width: info.width, height: info.height, duration: info.duration, layout },
      'clip vertical encodé',
    );

    finals.push({
      ...cut,
      filePath: finalPath,
      duration: info.duration,
      width: info.width,
      height: info.height,
    });
    onProgress?.((i + 1) / cuts.length);
  }

  return finals;
}

/**
 * Décide s'il faut lancer le suivi du sujet.
 *
 * Inutile en mise en page « fond flou » (rien n'est recadré), et inutile sur
 * une source déjà verticale ou plus étroite que 9:16 : la fenêtre de recadrage
 * couvre alors toute la largeur, il n'y a nulle part où la déplacer.
 */
async function maybeTrack({ cutPath, jobDir, base, layout, config, logger }) {
  if (!config.trackingCrop || layout !== 'crop') return null;

  try {
    const info = await probe(cutPath, config);
    if (info.width && info.height && info.width / info.height <= 9 / 16 + 0.01) {
      logger?.info({ width: info.width, height: info.height }, 'source déjà verticale : suivi inutile');
      return null;
    }
  } catch {
    /* si la sonde échoue, on laisse le suivi tenter sa chance */
  }

  return buildTrackingCommands({ videoPath: cutPath, workDir: jobDir, name: base, config, logger });
}
