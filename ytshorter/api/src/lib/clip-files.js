import fsp from 'node:fs/promises';
import path from 'node:path';

// Fichiers d'un clip sur le volume média, partagé avec le worker.
// L'api lit ces fichiers ; elle n'y écrit jamais : le worker en reste seul
// propriétaire, ce qui évite toute course pendant un ré-encodage.

const pad = (n) => String(n).padStart(2, '0');

/** Chemin d'un fichier du job, refusé s'il sort du volume média. */
export function jobFilePath(config, jobId, filename) {
  const mediaRoot = path.resolve(config.mediaDir);
  const target = path.resolve(path.join(mediaRoot, String(jobId), filename));
  return target.startsWith(mediaRoot + path.sep) ? target : null;
}

export async function exists(file) {
  if (!file) return false;
  try {
    await fsp.access(file);
    return true;
  } catch {
    return false;
  }
}

export const cutFile = (config, jobId, idx) => jobFilePath(config, jobId, `cut_${pad(idx)}.mp4`);
export const linesFile = (config, jobId, idx) =>
  jobFilePath(config, jobId, `clip_${pad(idx)}.lines.json`);
export const wordsFile = (config, jobId) => jobFilePath(config, jobId, 'words.json');

/**
 * Lignes de sous-titres réellement incrustées, en temps absolu.
 * @returns {Promise<Array<{start:number,end:number,text:string}>|null>}
 */
export async function readLines(config, jobId, idx) {
  const file = linesFile(config, jobId, idx);
  if (!file) return null;
  try {
    const parsed = JSON.parse(await fsp.readFile(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Formate un temps en horodatage SRT (00:00:01,500). */
export function formatSrtTime(seconds) {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const ms = Math.round((total - Math.floor(total)) * 1000);
  const pad2 = (n) => String(n).padStart(2, '0');
  return `${pad2(h)}:${pad2(m)}:${pad2(s)},${String(ms === 1000 ? 999 : ms).padStart(3, '0')}`;
}

/**
 * Construit un fichier SRT à partir de lignes en temps local.
 * Utile pour publier la vidéo sans sous-titres incrustés, ou pour retoucher
 * les sous-titres dans un autre outil.
 */
export function buildSrt(lines) {
  return (
    lines
      .filter((line) => line.end > line.start && String(line.text ?? '').trim())
      .map((line, index) =>
        [
          index + 1,
          `${formatSrtTime(line.start)} --> ${formatSrtTime(line.end)}`,
          String(line.text).trim(),
        ].join('\n'),
      )
      .join('\n\n') + '\n'
  );
}

/** Même contenu au format WebVTT, attendu par les lecteurs web. */
export function buildVtt(lines) {
  const body = lines
    .filter((line) => line.end > line.start && String(line.text ?? '').trim())
    .map((line) =>
      [
        `${formatSrtTime(line.start).replace(',', '.')} --> ${formatSrtTime(line.end).replace(',', '.')}`,
        String(line.text).trim(),
      ].join('\n'),
    )
    .join('\n\n');
  return `WEBVTT\n\n${body}\n`;
}
