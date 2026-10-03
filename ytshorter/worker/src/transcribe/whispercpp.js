import fs from 'node:fs/promises';
import path from 'node:path';
import { run } from '../lib/exec.js';
import { extractWav16k } from '../lib/ffmpeg.js';
import { PipelineError, CODES } from '../lib/errors.js';

// Transcription auto-hébergée avec whisper.cpp.
// Aucun compte, aucune clé, aucun quota : c'est l'implémentation par défaut.
// Les horodatages au mot proviennent de l'alignement DTW (`--dtw`).

const DTW_PRESETS = new Set([
  'tiny', 'tiny.en', 'base', 'base.en', 'small', 'small.en',
  'medium', 'medium.en', 'large.v1', 'large.v2', 'large.v3',
]);

/** Déduit le préréglage DTW à partir du nom du modèle ggml. */
export function dtwPresetFromModelPath(modelPath) {
  const name = path.basename(String(modelPath));
  const m = /^ggml-([a-z0-9.\-]+?)(?:-(?:q\d_\d|tdrz))?\.bin$/i.exec(name);
  if (!m) return null;
  let preset = m[1].toLowerCase();
  // ggml-large-v3.bin -> préréglage "large.v3"
  preset = preset.replace(/^large-(v\d)$/, 'large.$1');
  return DTW_PRESETS.has(preset) ? preset : null;
}

/**
 * Normalise la sortie JSON de whisper.cpp (--output-json-full) en mots horodatés.
 * Les tokens sont des morceaux de mots : un nouveau mot commence à chaque token
 * précédé d'une espace. Les timings viennent de `t_dtw` (unités de 10 ms) quand
 * il est disponible, sinon des offsets du token (millisecondes).
 *
 * @returns {{ words: Array<{text:string,start:number,end:number}>, language: string|null, text: string }}
 */
export function normalizeWhisperJson(json) {
  const segments = Array.isArray(json?.transcription) ? json.transcription : [];
  const words = [];
  let fullText = '';

  for (const segment of segments) {
    const segStart = (segment?.offsets?.from ?? 0) / 1000;
    const segEnd = (segment?.offsets?.to ?? 0) / 1000;
    fullText += segment?.text ?? '';

    const tokens = Array.isArray(segment?.tokens) ? segment.tokens : [];
    if (tokens.length === 0) {
      // Repli : pas de tokens, on répartit les mots du segment uniformément.
      const pieces = String(segment?.text ?? '').trim().split(/\s+/).filter(Boolean);
      const span = Math.max(0.001, segEnd - segStart);
      pieces.forEach((piece, i) => {
        words.push({
          text: piece,
          start: segStart + (span * i) / pieces.length,
          end: segStart + (span * (i + 1)) / pieces.length,
        });
      });
      continue;
    }

    for (const token of tokens) {
      const raw = token?.text ?? '';
      // Tokens spéciaux de whisper : [_BEG_], [_TT_123], <|...|>
      if (!raw || /^\s*(\[_|<\|)/.test(raw)) continue;

      const startMs =
        Number.isFinite(token.t_dtw) && token.t_dtw >= 0
          ? token.t_dtw * 10
          : (token?.offsets?.from ?? segment?.offsets?.from ?? 0);
      const endMs = token?.offsets?.to ?? startMs;

      const startsNewWord = /^\s/.test(raw) || words.length === 0;
      const cleaned = raw.trim();
      if (!cleaned) continue;

      if (startsNewWord) {
        words.push({ text: cleaned, start: startMs / 1000, end: endMs / 1000 });
      } else {
        const last = words[words.length - 1];
        last.text += cleaned;
        last.end = Math.max(last.end, endMs / 1000);
      }
    }
  }

  // Cohérence des bornes : un mot ne peut pas finir avant de commencer,
  // et la fin est bornée par le début du mot suivant.
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    if (!(w.end > w.start)) w.end = w.start + 0.12;
    const next = words[i + 1];
    if (next && next.start < w.start) next.start = w.end;
    if (next && w.end > next.start) w.end = next.start;
    if (!(w.end > w.start)) w.end = w.start + 0.05;
  }

  return {
    words,
    language: json?.result?.language ?? null,
    text: fullText.trim(),
  };
}

export function createWhisperCppTranscriber({ config, logger }) {
  return {
    name: 'whispercpp',
    async isAvailable() {
      try {
        await fs.access(config.whisper.modelPath);
        return true;
      } catch {
        return false;
      }
    },
    /**
     * @param {string} mediaPath fichier source (vidéo ou audio)
     * @param {string} workDir   dossier de travail du job
     */
    async transcribe(mediaPath, workDir, onProgress) {
      const wavPath = path.join(workDir, 'audio16k.wav');
      const outBase = path.join(workDir, 'transcript');

      await extractWav16k(mediaPath, wavPath, config);
      onProgress?.(0.1);

      const args = [
        '-m', config.whisper.modelPath,
        '-f', wavPath,
        '-t', String(config.whisper.threads),
        '-oj', '-ojf',
        '-of', outBase,
        '-np', // pas d'impression de progression bavarde
      ];

      const dtw = dtwPresetFromModelPath(config.whisper.modelPath);
      if (dtw) {
        args.push('--dtw', dtw);
      } else {
        logger?.warn(
          { model: config.whisper.modelPath },
          "préréglage DTW introuvable pour ce modèle : horodatage au token sans alignement DTW",
        );
      }
      if (config.whisper.language && config.whisper.language !== 'auto') {
        args.push('-l', config.whisper.language);
      } else {
        args.push('-l', 'auto');
      }

      logger?.info({ model: config.whisper.modelPath, dtw }, 'whisper.cpp : transcription en cours');

      try {
        await run(config.whisper.binary, args, {
          timeoutMs: 6 * 60 * 60 * 1000,
          onStderrLine: (line) => logger?.debug({ line }, 'whisper'),
        });
      } catch (err) {
        throw new PipelineError(CODES.TRANSCRIPTION_FAILED, undefined, err);
      } finally {
        await fs.rm(wavPath, { force: true });
      }

      onProgress?.(0.95);

      let parsed;
      try {
        parsed = JSON.parse(await fs.readFile(`${outBase}.json`, 'utf8'));
      } catch (err) {
        throw new PipelineError(CODES.TRANSCRIPTION_FAILED, 'Sortie whisper.cpp illisible.', err);
      }

      return normalizeWhisperJson(parsed);
    },
  };
}
