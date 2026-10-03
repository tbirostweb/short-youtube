import fs from 'node:fs/promises';
import path from 'node:path';

// Passage de nettoyage périodique.
//
// Sans lui, le volume média d'un VPS se remplit sans limite : les découpes sont
// conservées pour la re-stylisation, et les clips vivent aussi longtemps que
// leur job. Trois cibles :
//   1. les jobs terminés plus vieux que RETENTION_DAYS, avec leurs fichiers ;
//   2. les fichiers envoyés puis jamais utilisés, plus vieux que UPLOAD_TTL_HOURS ;
//   3. les dossiers média orphelins, sans job correspondant en base.

export async function runRetention({ db, config, logger }) {
  const summary = { jobs: 0, uploads: 0, orphans: 0 };
  const mediaRoot = path.resolve(config.mediaDir);

  // 1. Jobs expirés.
  if (config.retention.days > 0) {
    const expired = await db.listExpiredJobs(config.retention.days);
    for (const jobId of expired) {
      const dir = path.resolve(path.join(mediaRoot, jobId));
      if (dir.startsWith(mediaRoot + path.sep)) {
        await fs.rm(dir, { recursive: true, force: true });
      }
      await db.deleteJob(jobId);
      summary.jobs += 1;
    }
  }

  // 2. Fichiers envoyés jamais consommés.
  if (config.retention.uploadTtlHours > 0) {
    const stale = await db.listStaleUploads(config.retention.uploadTtlHours);
    for (const upload of stale) {
      const file = path.resolve(upload.filePath);
      if (file.startsWith(mediaRoot + path.sep)) {
        await fs.rm(file, { force: true });
      }
      await db.deleteUpload(upload.id);
      summary.uploads += 1;
    }
    // Les enregistrements d'envois déjà consommés ne servent plus à rien.
    await db.deleteConsumedUploads(config.retention.uploadTtlHours);
  }

  // 3. Dossiers orphelins : un job supprimé côté base a pu laisser ses fichiers.
  let entries = [];
  try {
    entries = await fs.readdir(mediaRoot, { withFileTypes: true });
  } catch {
    return summary;
  }
  for (const entry of entries) {
    // Les dossiers de job portent l'identifiant numérique du job.
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    if (await db.jobExists(entry.name)) continue;
    await fs.rm(path.join(mediaRoot, entry.name), { recursive: true, force: true });
    summary.orphans += 1;
  }

  if (summary.jobs || summary.uploads || summary.orphans) {
    logger?.info(summary, 'passage de rétention terminé');
  } else {
    logger?.debug(summary, 'passage de rétention : rien à supprimer');
  }
  return summary;
}

/** Démarre le passage périodique et renvoie une fonction d'arrêt. */
export function startRetentionLoop({ db, config, logger }) {
  const intervalMs = Math.max(5, config.retention.intervalMinutes) * 60 * 1000;
  const tick = () => {
    runRetention({ db, config, logger }).catch((err) => {
      logger?.warn({ err: err.message }, 'passage de rétention en échec');
    });
  };
  tick(); // un premier passage au démarrage
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
