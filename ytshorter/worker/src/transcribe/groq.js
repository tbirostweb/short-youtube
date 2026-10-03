import fs from 'node:fs/promises';
import path from 'node:path';
import { extractFlac16k, probe } from '../lib/ffmpeg.js';
import { PipelineError, CODES } from '../lib/errors.js';
import { classifyStatus, ProviderHttpError } from '../llm/http.js';

// Transcription via l'API Groq (Whisper large v3 turbo).
// Offre gratuite à quota : beaucoup plus rapide que le CPU local.
// L'audio est converti en FLAC 16 kHz mono et découpé si nécessaire,
// car l'API limite la taille des fichiers envoyés.

const ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MAX_UPLOAD_BYTES = 24 * 1024 * 1024; // marge sous la limite de 25 Mo
const CHUNK_SECONDS = 900; // 15 minutes

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function requestTranscription({ filePath, config, offsetSeconds, logger }) {
  const buffer = await fs.readFile(filePath);
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'audio/flac' }), path.basename(filePath));
  form.append('model', config.groq.transcribeModel);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  form.append('timestamp_granularities[]', 'segment');
  if (config.whisper.language && config.whisper.language !== 'auto') {
    form.append('language', config.whisper.language);
  }

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.groq.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(15 * 60 * 1000),
    });
  } catch (err) {
    throw new ProviderHttpError(`réseau indisponible : ${err.message}`, { retryable: true });
  }

  const text = await res.text();
  if (!res.ok) throw classifyStatus(res.status, text, res.headers.get('retry-after'));

  const data = JSON.parse(text);
  const words = (data.words ?? []).map((w) => ({
    text: String(w.word ?? w.text ?? '').trim(),
    start: Number(w.start) + offsetSeconds,
    end: Number(w.end) + offsetSeconds,
  })).filter((w) => w.text && Number.isFinite(w.start) && Number.isFinite(w.end));

  logger?.debug({ words: words.length, offsetSeconds }, 'groq : segment transcrit');
  return { words, language: data.language ?? null, text: data.text ?? '' };
}

async function withRetry(fn, { attempts = 3, logger }) {
  let lastError;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const retryable = err instanceof ProviderHttpError && err.retryable;
      logger?.warn({ attempt: i, err: err.message, retryable }, 'groq : échec de transcription');
      if (!retryable || i === attempts) break;
      await sleep(err.retryAfterMs || Math.min(2000 * 2 ** (i - 1), 30000));
    }
  }
  throw lastError;
}

export function createGroqTranscriber({ config, logger }) {
  return {
    name: 'groq',
    async isAvailable() {
      return Boolean(config.groq.apiKey);
    },
    async transcribe(mediaPath, workDir, onProgress) {
      if (!config.groq.apiKey) {
        throw new PipelineError(CODES.TRANSCRIPTION_FAILED, 'GROQ_API_KEY absente.');
      }

      const info = await probe(mediaPath, config);
      const duration = info.duration || 0;
      const chunks = [];

      const fullPath = path.join(workDir, 'audio16k.flac');
      await extractFlac16k(mediaPath, fullPath, config);
      const { size } = await fs.stat(fullPath);

      if (size <= MAX_UPLOAD_BYTES) {
        chunks.push({ file: fullPath, offset: 0 });
      } else {
        // Découpage en tranches : chaque tranche reste sous la limite d'envoi.
        await fs.rm(fullPath, { force: true });
        const count = Math.max(1, Math.ceil(duration / CHUNK_SECONDS));
        for (let i = 0; i < count; i += 1) {
          const start = i * CHUNK_SECONDS;
          const file = path.join(workDir, `audio16k_${String(i).padStart(3, '0')}.flac`);
          await extractFlac16k(mediaPath, file, config, {
            start,
            duration: Math.min(CHUNK_SECONDS, Math.max(0, duration - start)),
          });
          chunks.push({ file, offset: start });
        }
        logger?.info({ chunks: chunks.length }, 'groq : audio découpé pour respecter la limite de taille');
      }

      const all = [];
      let language = null;
      let text = '';

      try {
        for (let i = 0; i < chunks.length; i += 1) {
          const chunk = chunks[i];
          const result = await withRetry(
            () =>
              requestTranscription({
                filePath: chunk.file,
                config,
                offsetSeconds: chunk.offset,
                logger,
              }),
            { attempts: config.llmAttemptsPerProvider, logger },
          );
          all.push(...result.words);
          language = language ?? result.language;
          text += (text ? ' ' : '') + (result.text ?? '');
          onProgress?.((i + 1) / chunks.length);
        }
      } catch (err) {
        if (err instanceof ProviderHttpError && err.quota) {
          throw new PipelineError(CODES.QUOTA_EXCEEDED, undefined, err);
        }
        throw new PipelineError(CODES.TRANSCRIPTION_FAILED, undefined, err);
      } finally {
        for (const chunk of chunks) await fs.rm(chunk.file, { force: true });
      }

      all.sort((a, b) => a.start - b.start);
      return { words: all, language, text: text.trim() };
    },
  };
}
