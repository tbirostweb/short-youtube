// Rapport de progression : écrit en base et publie sur Redis pour le flux SSE.
// Les étapes ont un poids fixe pour que la barre avance de façon monotone.

export const STEPS = [
  { key: 'download', from: 2, to: 20 },
  { key: 'transcribe', from: 20, to: 48 },
  { key: 'select', from: 48, to: 56 },
  // Traduction des sous-titres : étape sautée quand elle n'est pas demandée.
  { key: 'translate', from: 56, to: 62 },
  { key: 'cut', from: 62, to: 70 },
  // Recadrage et sous-titres sont incrustés dans le même encodage :
  // une seule étape, honnête sur ce qui se passe réellement.
  { key: 'render', from: 70, to: 90 },
  { key: 'metadata', from: 90, to: 98 },
  { key: 'finalize', from: 98, to: 100 },
];

const STEP_MAP = new Map(STEPS.map((s) => [s.key, s]));

export function createProgressReporter({ db, publisher, jobId, logger }) {
  let lastProgress = 0;
  let lastStep = null;

  async function emit(payload) {
    try {
      await publisher.publish(`ytshorter:job:${jobId}`, JSON.stringify(payload));
    } catch (err) {
      logger?.warn({ err: err.message }, 'publication de progression impossible');
    }
  }

  return {
    /**
     * @param {string} step  clé d'étape (voir STEPS)
     * @param {number} ratio avancement dans l'étape, 0 à 1
     */
    async step(step, ratio = 0) {
      const def = STEP_MAP.get(step);
      const bounded = Math.max(0, Math.min(1, ratio));
      const progress = def ? Math.round(def.from + (def.to - def.from) * bounded) : lastProgress;
      // Jamais de recul, et une seule écriture par palier : évite de marteler
      // MySQL et Redis à chaque ligne de progression de ffmpeg.
      if (progress < lastProgress) return;
      if (progress === lastProgress && step === lastStep) return;
      lastProgress = progress;
      lastStep = step;
      await db.updateProgress(jobId, { status: 'processing', currentStep: step, progress });
      await emit({ step, progress, status: 'processing' });
      logger?.info({ step, progress }, 'progression');
    },
    async done() {
      lastProgress = 100;
      await db.setDone(jobId);
      await emit({ step: 'done', progress: 100, status: 'done' });
    },
    async error({ code, message, step }) {
      await db.setError(jobId, { code, message, step });
      await emit({ step: step ?? 'error', progress: lastProgress, status: 'error', error: { code, message } });
    },
  };
}
