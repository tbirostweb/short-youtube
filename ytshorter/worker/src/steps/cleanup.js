import fs from 'node:fs/promises';
import path from 'node:path';

// Étape 8 : nettoyage. Les fichiers intermédiaires ne survivent pas au job.

const INTERMEDIATE_PATTERNS = [
  /^source\.mp4$/,
  /^source\.[a-z0-9]+$/, // fichiers partiels laissés par yt-dlp
  /^cut_\d+\.mp4$/,
  /^audio16k.*$/,
  /^transcript\.json$/,
  /^transcript\.(txt|srt|vtt)$/,
  /\.sendcmd$/,
  /\.track\.json$/,
  /\.part$/,
  /\.ytdl$/,
];

export async function cleanIntermediates(jobDir, { keep = false, keepCuts = false, logger } = {}) {
  if (keep) {
    logger?.info({}, 'nettoyage désactivé (KEEP_INTERMEDIATES)');
    return;
  }
  const patterns = keepCuts
    ? INTERMEDIATE_PATTERNS.filter((re) => re.source !== '^cut_\\d+\\.mp4$')
    : INTERMEDIATE_PATTERNS;

  let entries = [];
  try {
    entries = await fs.readdir(jobDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (patterns.some((re) => re.test(entry))) {
      await fs.rm(path.join(jobDir, entry), { force: true, recursive: false });
    }
  }
  logger?.info({ jobDir, keepCuts }, 'fichiers intermédiaires supprimés');
}

/** Supprime tout le dossier d'un job (utilisé quand le job échoue). */
export async function removeJobDir(jobDir, logger) {
  try {
    await fs.rm(jobDir, { recursive: true, force: true });
    logger?.info({ jobDir }, 'dossier du job supprimé');
  } catch (err) {
    logger?.warn({ err: err.message }, 'suppression du dossier du job impossible');
  }
}
