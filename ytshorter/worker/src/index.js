import fs from 'node:fs/promises';
import Redis from 'ioredis';
import { Worker } from 'bullmq';
import { config } from './config.js';
import { createLogger } from './lib/logger.js';
import { createDb } from './lib/db.js';
import { createProgressReporter } from './lib/progress.js';
import { createLlmClient } from './llm/index.js';
import { createTranscriber } from './transcribe/index.js';
import { runPipeline, cleanupFailedJob } from './pipeline.js';
import { restyleClip } from './steps/restyle.js';
import { startRetentionLoop } from './lib/retention.js';
import { PipelineError, CODES, USER_MESSAGES } from './lib/errors.js';
import { commandExists } from './lib/exec.js';

export const JOB_QUEUE_NAME = 'ytshorter-clips';

const logger = createLogger(config.logLevel, { service: 'worker' });

async function waitForDb(db) {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      await db.ping();
      return;
    } catch (err) {
      logger.warn({ attempt, err: err.message }, 'MySQL indisponible, nouvelle tentative');
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw new Error('MySQL reste injoignable');
}

async function checkTooling() {
  const checks = [
    ['ffmpeg', config.ffmpeg, ['-version']],
    ['ffprobe', config.ffprobe, ['-version']],
    ['yt-dlp', config.ytDlp, ['--version']],
  ];
  if (config.transcriber === 'whispercpp') {
    checks.push(['whisper.cpp', config.whisper.binary, ['--help']]);
  }
  for (const [label, binary, args] of checks) {
    const ok = await commandExists(binary, args);
    logger[ok ? 'info' : 'error']({ tool: label, binary }, ok ? 'outil disponible' : 'OUTIL MANQUANT');
  }
  if (config.transcriber === 'whispercpp') {
    try {
      await fs.access(config.whisper.modelPath);
      logger.info({ model: config.whisper.modelPath }, 'modèle whisper présent');
    } catch {
      logger.error(
        { model: config.whisper.modelPath },
        'modèle whisper absent : la transcription échouera (voir entrypoint)',
      );
    }
  }
}

async function main() {
  await fs.mkdir(config.mediaDir, { recursive: true });

  const db = createDb(config.mysql);
  await waitForDb(db);
  await checkTooling();

  const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  const publisher = new Redis(config.redisUrl, { maxRetriesPerRequest: null });

  const llm = createLlmClient({ config, logger });
  const transcriber = createTranscriber({ config, logger });

  logger.info(
    {
      providers: llm.providers,
      transcriber: transcriber.name,
      trackingCrop: config.trackingCrop,
      mediaDir: config.mediaDir,
      retentionDays: config.retention.days,
      keepCutsForRestyle: config.keepCutsForRestyle,
    },
    'worker prêt',
  );

  const stopRetention = startRetentionLoop({ db, config, logger });

  // Ré-encodage d'un seul clip : tâche courte, sans quota consommé.
  async function handleRestyle(bullJob) {
    const { clipId, captionStyle, focusX, layout, hookOverlay, startSeconds, endSeconds, lines } =
      bullJob.data;
    const clipLogger = logger.child({ clipId });
    try {
      await db.setClipRestyleStatus(clipId, 'processing');
      const result = await restyleClip({
        clipId,
        captionStyle,
        focusX,
        layout,
        hookOverlay,
        startSeconds,
        endSeconds,
        lines,
        db,
        config,
        logger: clipLogger,
      });
      return result;
    } catch (err) {
      const code = err instanceof PipelineError ? err.code : CODES.INTERNAL;
      clipLogger.error({ code, err: err.message }, 'échec de la re-stylisation');
      await db.setClipRestyleStatus(clipId, 'error').catch(() => {});
      throw err;
    }
  }

  const worker = new Worker(
    JOB_QUEUE_NAME,
    async (bullJob) => {
      if (bullJob.name === 'restyle-clip') return handleRestyle(bullJob);

      const job = bullJob.data;
      const jobLogger = logger.child({ jobId: job.jobId, videoId: job.youtubeVideoId });
      const progress = createProgressReporter({ db, publisher, jobId: job.jobId, logger: jobLogger });

      jobLogger.info({}, 'traitement démarré');
      try {
        const result = await runPipeline({ job, db, progress, config, logger: jobLogger, llm, transcriber });
        await bullJob.updateProgress(100);
        return result;
      } catch (err) {
        const code = err instanceof PipelineError ? err.code : CODES.INTERNAL;
        const message = err instanceof PipelineError ? err.userMessage : USER_MESSAGES[CODES.INTERNAL];
        // Journalisation complète côté serveur, message neutre côté utilisateur.
        jobLogger.error({ code, err: err.message, stack: err.stack }, 'échec du traitement');
        await progress.error({ code, message, step: 'error' });
        await cleanupFailedJob({ jobId: job.jobId, config, logger: jobLogger });
        throw err;
      }
    },
    {
      connection,
      // Concurrence 1 : une vidéo à la fois, pour tenir dans les quotas gratuits
      // et ne pas saturer le CPU du VPS avec plusieurs encodages simultanés.
      concurrency: 1,
      lockDuration: 10 * 60 * 1000,
      stalledInterval: 60 * 1000,
    },
  );

  worker.on('failed', (bullJob, err) => {
    logger.warn({ jobId: bullJob?.data?.jobId, err: err.message }, 'job en échec');
  });
  worker.on('completed', (bullJob) => {
    logger.info({ jobId: bullJob?.data?.jobId }, 'job complété');
  });

  const shutdown = async (signal) => {
    logger.info({ signal }, 'arrêt du worker');
    try {
      stopRetention();
      await worker.close();
      await connection.quit();
      await publisher.quit();
      await db.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err: err.message, stack: err.stack }, 'démarrage du worker impossible');
  process.exit(1);
});
