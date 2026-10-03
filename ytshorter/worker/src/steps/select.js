import { renderPrompt } from '../lib/prompts.js';
import { selectionSchema } from '../lib/llm-schemas.js';
import { PipelineError, CODES } from '../lib/errors.js';

// Étape 3 : sélection des meilleurs passages par un LLM gratuit.
// Toutes les fonctions de mise en forme et de nettoyage sont pures :
// elles sont testables sans appeler le moindre fournisseur.

/** Bornes de durée acceptées pour un extrait, dérivées de la durée cible. */
export function durationBounds(targetDuration) {
  const target = Number(targetDuration) || 45;
  return {
    minSeconds: Math.max(12, Math.round(target * 0.7)),
    maxSeconds: Math.min(90, Math.max(target + 5, Math.round(target * 1.35))),
  };
}

/** Regroupe les mots en segments courts, base des lignes envoyées au LLM. */
export function wordsToSegments(words, { maxSeconds = 8, maxChars = 160, maxGap = 0.8 } = {}) {
  const segments = [];
  let current = null;

  for (const word of words) {
    if (!current) {
      current = { start: word.start, end: word.end, text: word.text };
      continue;
    }
    const gap = word.start - current.end;
    const tooLong = word.end - current.start > maxSeconds;
    const tooWide = current.text.length + 1 + word.text.length > maxChars;
    // Une ponctuation forte termine naturellement un segment.
    const sentenceEnd = /[.!?…]$/.test(current.text) && word.end - current.start > 2.5;

    if (tooLong || tooWide || gap > maxGap || sentenceEnd) {
      segments.push(current);
      current = { start: word.start, end: word.end, text: word.text };
    } else {
      current.text += ` ${word.text}`;
      current.end = word.end;
    }
  }
  if (current) segments.push(current);
  return segments;
}

/** Met les segments au format "[début-fin] texte". */
export function formatTranscriptLines(segments) {
  return segments
    .map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`)
    .join('\n');
}

/** Découpe les segments en fenêtres respectant la taille maximale de prompt. */
export function splitIntoWindows(segments, maxChars) {
  const windows = [];
  let current = [];
  let size = 0;
  for (const segment of segments) {
    const line = segment.text.length + 24;
    if (size + line > maxChars && current.length > 0) {
      windows.push(current);
      current = [];
      size = 0;
    }
    current.push(segment);
    size += line;
  }
  if (current.length) windows.push(current);
  return windows;
}

/** Cale une borne sur le début de mot le plus proche (dans une fenêtre donnée). */
function snapToWordStart(words, time, tolerance = 2.5) {
  let best = null;
  let bestDelta = Infinity;
  for (const word of words) {
    const delta = Math.abs(word.start - time);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = word;
    }
    if (word.start > time + tolerance) break;
  }
  return best && bestDelta <= tolerance ? best.start : time;
}

function snapToWordEnd(words, time, tolerance = 2.5) {
  let best = null;
  let bestDelta = Infinity;
  for (const word of words) {
    const delta = Math.abs(word.end - time);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = word;
    }
    if (word.end > time + tolerance) break;
  }
  return best && bestDelta <= tolerance ? best.end : time;
}

/** Texte réellement prononcé dans un intervalle. */
export function transcriptForRange(words, start, end) {
  return words
    .filter((w) => w.end > start && w.start < end)
    .map((w) => w.text)
    .join(' ')
    .trim();
}

/**
 * Nettoie la sortie du LLM : bornes valides, durées dans les clous,
 * alignement sur les mots, suppression des chevauchements, tri par score.
 */
export function sanitizeSelection({
  clips,
  words,
  videoDuration,
  minSeconds,
  maxSeconds,
  clipCount,
  // En mode série, l'ordre de publication est l'ordre de la vidéo : la
  // sélection reste faite au score, mais le rendu final est chronologique.
  chronological = false,
}) {
  const cleaned = [];

  for (const raw of clips ?? []) {
    let start = Number(raw.start);
    let end = Number(raw.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (end <= start) continue;

    start = Math.max(0, Math.min(start, videoDuration));
    end = Math.max(0, Math.min(end, videoDuration));
    // Un extrait proposé hors de la vidéo se réduit à rien une fois borné :
    // on l'écarte au lieu d'en fabriquer un artificiellement.
    if (end - start < 5) continue;

    start = snapToWordStart(words, start);
    end = snapToWordEnd(words, end);

    // Petite marge avant/après pour ne pas couper une attaque de voix.
    start = Math.max(0, start - 0.15);
    end = Math.min(videoDuration, end + 0.25);

    if (end - start > maxSeconds) end = start + maxSeconds;
    if (end - start < minSeconds) {
      end = Math.min(videoDuration, start + minSeconds);
      if (end - start < minSeconds) start = Math.max(0, end - minSeconds);
    }
    if (end - start < 5) continue; // trop court pour être publiable

    const score = Math.max(0, Math.min(100, Math.round(Number(raw.score) || 0)));
    cleaned.push({
      start,
      end,
      score,
      hook: String(raw.hook ?? '').slice(0, 300),
      transcript: String(raw.transcript ?? '').trim() || transcriptForRange(words, start, end),
    });
  }

  cleaned.sort((a, b) => b.score - a.score || a.start - b.start);

  const kept = [];
  for (const clip of cleaned) {
    const overlaps = kept.some((k) => clip.start < k.end - 0.25 && clip.end > k.start + 0.25);
    if (overlaps) continue;
    kept.push(clip);
    if (kept.length >= clipCount) break;
  }
  return chronological ? kept.sort((a, b) => a.start - b.start) : kept;
}

/**
 * Sélection complète : prépare le prompt, interroge le LLM (avec bascule de
 * fournisseur gérée par le client), valide et nettoie la sortie.
 */
export async function selectMoments({
  words,
  videoTitle,
  videoDescription,
  videoDuration,
  clipCount,
  targetDuration,
  seriesMode = false,
  llm,
  config,
  logger,
  onProgress,
}) {
  const { minSeconds, maxSeconds } = durationBounds(targetDuration);
  const segments = wordsToSegments(words);
  if (segments.length === 0) throw new PipelineError(CODES.NO_SPEECH);

  const windows = splitIntoWindows(segments, config.maxTranscriptChars);
  logger?.info({ segments: segments.length, windows: windows.length }, 'sélection : transcription préparée');

  const collected = [];
  for (let i = 0; i < windows.length; i += 1) {
    const window = windows[i];
    const windowDuration = window[window.length - 1].end - window[0].start;
    // Chaque fenêtre reçoit un quota proportionnel à sa durée, plus une marge.
    const share = videoDuration > 0 ? windowDuration / videoDuration : 1;
    const want = windows.length === 1 ? clipCount : Math.max(1, Math.ceil(clipCount * share) + 1);

    // Le bloc de consignes « série » vit dans son propre fichier éditable.
    const seriesInstructions = seriesMode
      ? await renderPrompt('selection.series', { clipCount: want })
      : '';

    const system = await renderPrompt('selection.system', {
      clipCount: want,
      minSeconds,
      maxSeconds,
      videoDuration: Math.round(videoDuration),
      seriesInstructions,
    });
    const user = await renderPrompt('selection.user', {
      videoTitle: videoTitle || 'inconnu',
      videoDescription: (videoDescription || '').slice(0, 1500) || 'aucune',
      videoDuration: Math.round(videoDuration),
      clipCount: want,
      targetDuration,
      minSeconds,
      maxSeconds,
      transcript: formatTranscriptLines(window),
    });

    const { data, provider } = await llm.completeJson({
      system,
      user,
      schema: selectionSchema,
      temperature: 0.6,
      maxOutputTokens: 8192,
    });
    logger?.info({ provider, window: i + 1, clips: data.clips?.length ?? 0 }, 'sélection : réponse du LLM');
    collected.push(...(data.clips ?? []));
    onProgress?.((i + 1) / windows.length);
  }

  const selected = sanitizeSelection({
    clips: collected,
    words,
    videoDuration,
    minSeconds,
    maxSeconds,
    clipCount,
    chronological: seriesMode,
  });

  if (selected.length === 0) {
    throw new PipelineError(
      CODES.PROVIDER_ERROR,
      "Aucun extrait exploitable n'a pu être sélectionné dans cette vidéo.",
    );
  }
  return selected;
}
