import { renderPrompt } from '../lib/prompts.js';
import { translationSchema } from '../lib/llm-schemas.js';
import { wordsToSegments } from './select.js';

// Traduction des sous-titres.
//
// Traduire mot à mot est impossible : l'ordre des mots change d'une langue à
// l'autre. La traduction se fait donc par segment — une unité de sens de
// quelques secondes — puis le texte traduit est réparti sur la durée du
// segment d'origine, proportionnellement à la longueur des mots. Le karaoké
// reste synchronisé avec la voix, ce qui est tout ce qu'on demande à un
// sous-titre traduit.

const LANGUAGE_NAMES = {
  fr: 'français',
  en: 'anglais',
  es: 'espagnol',
  de: 'allemand',
  it: 'italien',
  pt: 'portugais',
};

/**
 * Répartit un texte traduit sur la fenêtre temporelle d'un segment.
 * @returns {Array<{text:string,start:number,end:number}>}
 */
export function distributeTranslation(segment, translatedText) {
  const pieces = String(translatedText ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (pieces.length === 0) return [];

  const span = Math.max(0.2, segment.end - segment.start);
  const totalChars = pieces.reduce((sum, word) => sum + word.length, 0) || pieces.length;

  const out = [];
  let cursor = segment.start;
  for (const piece of pieces) {
    const share = (piece.length || 1) / totalChars;
    const duration = Math.max(0.08, span * share);
    const end = Math.min(segment.end, cursor + duration);
    out.push({ text: piece, start: cursor, end: end > cursor ? end : cursor + 0.08 });
    cursor = end;
  }
  // Le dernier mot va jusqu'au bout du segment : pas de blanc en fin de phrase.
  out[out.length - 1].end = segment.end;
  return out;
}

/** Applique une liste de traductions indexées à des segments. */
export function applyTranslations(segments, translations) {
  const byIndex = new Map();
  for (const item of translations ?? []) {
    if (Number.isInteger(item?.i)) byIndex.set(item.i, item.text);
  }

  const words = [];
  segments.forEach((segment, index) => {
    const translated = byIndex.get(index);
    if (translated && String(translated).trim()) {
      words.push(...distributeTranslation(segment, translated));
    } else {
      // Segment non traduit : on garde l'original plutôt que de perdre la ligne.
      words.push(...(segment.words ?? [{ text: segment.text, start: segment.start, end: segment.end }]));
    }
  });
  return words;
}

/** Regroupe les mots en segments en conservant les mots d'origine. */
export function segmentsWithWords(words) {
  const segments = wordsToSegments(words);
  let cursor = 0;
  for (const segment of segments) {
    segment.words = [];
    while (cursor < words.length && words[cursor].start < segment.end - 1e-6) {
      if (words[cursor].end > segment.start - 1e-6) segment.words.push(words[cursor]);
      cursor += 1;
    }
    // Un mot peut chevaucher la frontière : on recule d'un cran si besoin.
    if (cursor > 0 && words[cursor - 1].end > segment.end) cursor -= 1;
  }
  return segments;
}

/**
 * Traduit les mots horodatés vers `targetLanguage`.
 * Les fenêtres de traduction respectent la taille maximale de prompt.
 */
export async function translateWords({
  words,
  targetLanguage,
  llm,
  config,
  logger,
  onProgress,
}) {
  const segments = segmentsWithWords(words);
  if (segments.length === 0) return words;

  const language = LANGUAGE_NAMES[targetLanguage] ?? targetLanguage;
  const system = await renderPrompt('translate.system', { language });

  // Découpage en lots : un prompt trop long dégrade la qualité et peut
  // dépasser le contexte des petits modèles gratuits.
  const batches = [];
  let current = [];
  let size = 0;
  segments.forEach((segment, index) => {
    const line = `${index}. ${segment.text}`;
    if (size + line.length > config.maxTranscriptChars && current.length > 0) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push({ index, segment, line });
    size += line.length;
  });
  if (current.length) batches.push(current);

  const translations = [];
  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i];
    const user = await renderPrompt('translate.user', {
      language,
      segments: batch.map((item) => item.line).join('\n'),
    });

    const { data, provider } = await llm.completeJson({
      system,
      user,
      schema: translationSchema,
      temperature: 0.3,
      maxOutputTokens: 8192,
    });
    logger?.info(
      { provider, batch: i + 1, segments: data.segments?.length ?? 0 },
      'traduction : lot reçu',
    );
    translations.push(...(data.segments ?? []));
    onProgress?.((i + 1) / batches.length);
  }

  return applyTranslations(segments, translations);
}
