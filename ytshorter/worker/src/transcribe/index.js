import { createWhisperCppTranscriber } from './whispercpp.js';
import { createGroqTranscriber } from './groq.js';
import { PipelineError, CODES } from '../lib/errors.js';

// Interface unique : transcribe(mediaPath, workDir) -> { words: [{text,start,end}] }
// Deux implémentations interchangeables, choisies par TRANSCRIBER.
// Si l'implémentation à quota échoue faute de crédit, on bascule
// automatiquement sur whisper.cpp (sans quota) quand il est disponible.
// Les moteurs ne renvoient pas la langue sous la même forme : whisper.cpp
// donne un code ISO ("fr"), l'API Groq un nom complet ("french"). Le pipeline
// compare cette valeur à la langue de sous-titres demandée : sans
// normalisation, il déclencherait une traduction du français vers le français.
const LANGUAGE_CODES = {
  french: 'fr', francais: 'fr', français: 'fr',
  english: 'en', anglais: 'en',
  spanish: 'es', espanol: 'es', español: 'es', espagnol: 'es',
  german: 'de', deutsch: 'de', allemand: 'de',
  italian: 'it', italiano: 'it', italien: 'it',
  portuguese: 'pt', portugues: 'pt', português: 'pt', portugais: 'pt',
};

export function normalizeLanguage(value) {
  if (!value || typeof value !== 'string') return null;
  const cleaned = value.trim().toLowerCase();
  if (/^[a-z]{2}$/.test(cleaned)) return cleaned;
  if (LANGUAGE_CODES[cleaned]) return LANGUAGE_CODES[cleaned];
  // "fr-FR" ou "en_US"
  const prefix = cleaned.split(/[-_]/)[0];
  return /^[a-z]{2}$/.test(prefix) ? prefix : null;
}

export function createTranscriber({ config, logger }) {
  const whispercpp = createWhisperCppTranscriber({ config, logger });
  const groq = createGroqTranscriber({ config, logger });

  const primary = config.transcriber === 'groq' ? groq : whispercpp;
  const fallback = config.transcriber === 'groq' ? whispercpp : null;

  return {
    name: primary.name,
    async transcribe(mediaPath, workDir, onProgress) {
      const withCode = (result) => ({ ...result, language: normalizeLanguage(result.language) });
      try {
        return withCode(await primary.transcribe(mediaPath, workDir, onProgress));
      } catch (err) {
        const quota = err instanceof PipelineError && err.code === CODES.QUOTA_EXCEEDED;
        if (quota && fallback && (await fallback.isAvailable())) {
          logger?.warn(
            { from: primary.name, to: fallback.name },
            'quota de transcription atteint : bascule sur le moteur local',
          );
          return withCode(await fallback.transcribe(mediaPath, workDir, onProgress));
        }
        throw err;
      }
    },
  };
}
