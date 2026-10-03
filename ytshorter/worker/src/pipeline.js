import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveSource } from './steps/source.js';
import { selectMoments } from './steps/select.js';
import { cutClips, renderClips } from './steps/render.js';
import { generateMetadata } from './steps/metadata.js';
import { translateWords } from './steps/translate.js';
import { mapWithConcurrency } from './lib/async.js';
import { cleanIntermediates, removeJobDir } from './steps/cleanup.js';
import { PipelineError, CODES } from './lib/errors.js';

/**
 * Pipeline complet pour un job.
 * Chaque étape publie sa progression ; toute erreur remonte avec un code
 * exploitable par l'interface.
 */
export async function runPipeline({ job, db, progress, config, logger, llm, transcriber }) {
  const jobDir = path.join(config.mediaDir, String(job.jobId));
  await fs.mkdir(jobDir, { recursive: true });

  // Un job relancé repart proprement : pas de clips en double.
  await db.deleteClips(job.jobId);

  // --- 1. Récupération de la source (URL YouTube ou fichier envoyé) -------
  await progress.step('download', 0);
  const source = await resolveSource({
    job,
    jobDir,
    config,
    logger,
    onProgress: (ratio) => progress.step('download', ratio),
  });
  await db.setSourceInfo(job.jobId, { title: source.title, duration: source.duration });
  logger.info({ duration: source.duration, title: source.title }, 'source téléchargée');

  // --- 2. Transcription ---------------------------------------------------
  await progress.step('transcribe', 0);
  const transcript = await transcriber.transcribe(source.sourcePath, jobDir, (ratio) =>
    progress.step('transcribe', ratio),
  );

  if (!transcript.words || transcript.words.length < 10) {
    throw new PipelineError(CODES.NO_SPEECH);
  }
  // La transcription vit sur le volume média, pas en base.
  await fs.writeFile(
    path.join(jobDir, 'words.json'),
    JSON.stringify({ language: transcript.language, words: transcript.words }),
    'utf8',
  );
  logger.info({ words: transcript.words.length, language: transcript.language }, 'transcription terminée');

  // --- 3. Sélection des moments ------------------------------------------
  await progress.step('select', 0);
  const selected = await selectMoments({
    words: transcript.words,
    videoTitle: source.title,
    videoDescription: source.description,
    videoDuration: source.duration,
    clipCount: job.clipCount,
    targetDuration: job.targetDuration,
    seriesMode: Boolean(job.seriesMode),
    llm,
    config,
    logger,
    onProgress: (ratio) => progress.step('select', ratio),
  });
  logger.info({ clips: selected.length }, 'extraits sélectionnés');

  // --- 3 bis. Traduction des sous-titres (optionnelle) --------------------
  // Traduire seulement les passages retenus, pas la vidéo entière : c'est dix
  // fois moins de texte envoyé au fournisseur, donc dix fois moins de quota.
  let subtitleWords = transcript.words;
  const wantsTranslation =
    job.subtitleLanguage &&
    job.subtitleLanguage !== 'source' &&
    job.subtitleLanguage !== transcript.language;

  if (wantsTranslation) {
    await progress.step('translate', 0);
    const inClips = transcript.words.filter((word) =>
      selected.some((clip) => word.end > clip.start && word.start < clip.end),
    );
    subtitleWords = await translateWords({
      words: inClips,
      targetLanguage: job.subtitleLanguage,
      llm,
      config,
      logger,
      onProgress: (ratio) => progress.step('translate', ratio),
    });
    await fs.writeFile(
      path.join(jobDir, `words.${job.subtitleLanguage}.json`),
      JSON.stringify({ language: job.subtitleLanguage, words: subtitleWords }),
      'utf8',
    );
    logger.info(
      { from: transcript.language, to: job.subtitleLanguage, words: subtitleWords.length },
      'sous-titres traduits',
    );
  }

  // --- 4. Découpe ---------------------------------------------------------
  await progress.step('cut', 0);
  const cuts = await cutClips({
    clips: selected,
    sourcePath: source.sourcePath,
    jobDir,
    sourceDuration: source.duration,
    config,
    logger,
    onProgress: (ratio) => progress.step('cut', ratio),
  });

  // --- 5 et 6. Recadrage vertical + sous-titres, une seule passe ----------
  await progress.step('render', 0);
  const finals = await renderClips({
    cuts,
    jobDir,
    words: subtitleWords,
    captionStyle: job.captionStyle,
    focusX: job.focusX,
    layout: job.layout ?? 'crop',
    hookOverlay: Boolean(job.hookOverlay),
    config,
    logger,
    onProgress: (ratio) => progress.step('render', ratio),
  });

  // --- 7. Métadonnées par clip -------------------------------------------
  // Un appel LLM par clip, indépendants et limités par le réseau : on les lance
  // en parallèle borné (concurrence 3) au lieu de les enchaîner. Le plafond
  // évite de marteler le quota gratuit. Les clips sont ensuite insérés en base
  // dans l'ordre.
  await progress.step('metadata', 0);
  let metadataDone = 0;
  const metadatas = await mapWithConcurrency(finals, 3, async (clip, index) => {
    const meta = await generateMetadata({
      clip,
      videoTitle: source.title,
      language: job.language,
      llm,
      logger,
      series: job.seriesMode
        ? {
            index: index + 1,
            total: finals.length,
            // L'accroche de l'épisode suivant sert de teaser.
            nextHook: finals[index + 1]?.hook ?? null,
          }
        : null,
    });
    metadataDone += 1;
    await progress.step('metadata', metadataDone / finals.length);
    return meta;
  });

  const created = [];
  for (let i = 0; i < finals.length; i += 1) {
    const clip = finals[i];
    const clipId = await db.insertClip({
      jobId: job.jobId,
      idx: i,
      startSeconds: clip.start,
      endSeconds: clip.end,
      padStart: clip.padStart ?? 0,
      padEnd: clip.padEnd ?? 0,
      score: clip.score,
      hook: clip.hook,
      filePath: clip.filePath,
      duration: clip.duration,
      ...metadatas[i],
    });
    created.push(clipId);
  }

  // --- 8. Nettoyage -------------------------------------------------------
  await progress.step('finalize', 0);
  await cleanIntermediates(jobDir, {
    keep: config.keepIntermediates,
    // Les découpes servent à re-styliser un clip sans refaire le pipeline.
    keepCuts: config.keepCutsForRestyle,
    logger,
  });
  await progress.done();

  logger.info({ clips: created.length }, 'job terminé');
  return { clipIds: created };
}

/** Nettoyage après échec : on ne laisse pas de fichiers orphelins. */
export async function cleanupFailedJob({ jobId, config, logger }) {
  await removeJobDir(path.join(config.mediaDir, String(jobId)), logger);
}
