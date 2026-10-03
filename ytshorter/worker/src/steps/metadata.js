import { renderPrompt } from '../lib/prompts.js';
import { metadataSchema } from '../lib/llm-schemas.js';

// Étape 7 : métadonnées de publication par clip, dans la langue choisie.

const LANGUAGE_NAMES = {
  fr: 'français',
  en: 'anglais',
  es: 'espagnol',
  de: 'allemand',
  it: 'italien',
  pt: 'portugais',
};

/** Normalise une liste de hashtags : # en tête, sans espace ni ponctuation. */
export function normalizeHashtags(list, { max = 8 } = {}) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const cleaned = String(raw)
      .trim()
      .replace(/^#+/, '')
      .replace(/[^\p{L}\p{N}_]/gu, '');
    if (!cleaned) continue;
    const tag = `#${cleaned}`;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}

/** Coupe proprement un titre trop long, sans casser un mot. */
export function clampTitle(title, max = 100) {
  const text = String(title ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

/** Garantit la présence de #Shorts dans le titre YouTube, sans dépasser 100 caractères. */
export function ensureShortsTag(title) {
  const text = clampTitle(title, 100);
  if (/#shorts/i.test(text)) return text;
  const withTag = `${clampTitle(text, 100 - 8)} #Shorts`.replace(/\s+/g, ' ').trim();
  return withTag.slice(0, 100);
}

export function normalizeMetadata(raw) {
  return {
    ytTitle: ensureShortsTag(raw.youtube_shorts?.title ?? ''),
    ytDescription: String(raw.youtube_shorts?.description ?? '').trim(),
    ytHashtags: normalizeHashtags(raw.youtube_shorts?.hashtags, { max: 6 }),
    tiktokCaption: String(raw.tiktok?.caption ?? '').replace(/\s+/g, ' ').trim().slice(0, 150),
    tiktokHashtags: normalizeHashtags(raw.tiktok?.hashtags, { max: 8 }),
  };
}

export async function generateMetadata({
  clip,
  videoTitle,
  language,
  llm,
  logger,
  // Contexte de série : rang de l'épisode et accroche du suivant, pour que
  // chaque partie donne une raison concrète de revenir.
  series = null,
}) {
  const seriesInstructions = series
    ? await renderPrompt('metadata.series', {
        partIndex: series.index,
        partTotal: series.total,
        nextTeaser: series.nextHook
          ? `La partie suivante porte sur : « ${series.nextHook} ». ` +
            "Termine la description en l'annonçant sans la résumer entièrement."
          : "C'est le dernier épisode : invite à revoir la série depuis le début.",
      })
    : '';

  const system = await renderPrompt('metadata.system', {
    language: LANGUAGE_NAMES[language] ?? language,
    seriesInstructions,
  });
  const user = await renderPrompt('metadata.user', {
    videoTitle: videoTitle || 'inconnu',
    hook: clip.hook || '',
    duration: Math.round(clip.end - clip.start),
    transcript: (clip.transcript || '').slice(0, 6000),
  });

  const { data, provider } = await llm.completeJson({
    system,
    user,
    schema: metadataSchema,
    temperature: 0.8,
    // Large : un modèle de raisonnement dépense des tokens avant de répondre,
    // et une réponse tronquée est un JSON invalide.
    maxOutputTokens: 4096,
  });
  logger?.debug({ provider }, 'métadonnées générées');
  return normalizeMetadata(data);
}
