// Génération des sous-titres karaoké au format ASS.
//
// Les couleurs ASS s'écrivent &HAABBGGRR (alpha, bleu, vert, rouge).
// En karaoké, un mot est affiché en SecondaryColour tant qu'il n'est pas
// prononcé, puis passe en PrimaryColour quand sa balise \k est écoulée :
// PrimaryColour est donc la couleur de surbrillance.

export const CAPTION_PRESETS = {
  // Gros titre percutant, majuscules, surbrillance jaune.
  punch: {
    label: 'Punch',
    fontName: 'DejaVu Sans',
    fontSize: 92,
    bold: -1,
    primary: '&H0000E5FF',
    secondary: '&H00FFFFFF',
    outline: '&H00000000',
    back: '&H80000000',
    borderStyle: 1,
    outlineWidth: 6,
    shadow: 2,
    marginV: 360,
    uppercase: true,
    maxCharsPerLine: 18,
    maxLines: 2,
  },
  // Plus sobre, casse d'origine, surbrillance cyan.
  clean: {
    label: 'Clean',
    fontName: 'DejaVu Sans',
    fontSize: 74,
    bold: -1,
    primary: '&H00FFE500',
    secondary: '&H00FFFFFF',
    outline: '&H00000000',
    back: '&H80000000',
    borderStyle: 1,
    outlineWidth: 4,
    shadow: 1,
    marginV: 300,
    uppercase: false,
    maxCharsPerLine: 26,
    maxLines: 3,
  },
  // Bandeau opaque derrière le texte, très lisible sur fond clair.
  boxed: {
    label: 'Boxed',
    fontName: 'DejaVu Sans',
    fontSize: 70,
    bold: -1,
    primary: '&H00FFFFFF',
    secondary: '&H00B4B4B4',
    outline: '&H00000000',
    back: '&HA0000000',
    borderStyle: 3,
    outlineWidth: 8,
    shadow: 0,
    marginV: 280,
    uppercase: false,
    maxCharsPerLine: 24,
    maxLines: 2,
  },
};

// Style du bandeau d'accroche affiché en tête de clip. Volontairement distinct
// des sous-titres : c'est un titre, pas une réplique.
export const HOOK_STYLE = {
  fontSize: 64,
  primary: '&H00FFFFFF',
  outline: '&H00000000',
  back: '&HB0000000',
  marginV: 180,
  maxCharsPerLine: 26,
  maxLines: 3,
};

export const DEFAULT_PRESET = 'punch';

// Style « aucun » : les sous-titres ne sont pas incrustés dans l'image. La
// transcription reste produite (elle sert à choisir les extraits) et les
// lignes restent exportables en SRT/VTT.
export const NO_CAPTIONS = 'none';

/** H:MM:SS.CC — format d'horodatage ASS. */
export function formatAssTime(seconds) {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const cs = Math.round((total - Math.floor(total)) * 100);
  const cs2 = cs === 100 ? 99 : cs;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs2).padStart(2, '0')}`;
}

/** Échappe les caractères qui ont un sens dans le format ASS. */
export function escapeAssText(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/\r?\n/g, ' ')
    .trim();
}

/**
 * Regroupe les mots en cartes de sous-titres.
 * Une nouvelle carte démarre quand la carte courante est pleine,
 * qu'un silence dépasse `maxGap`, ou que la durée maximale est atteinte.
 */
export function groupWordsIntoCards(words, preset, { maxGap = 0.7, maxDuration = 3.5 } = {}) {
  const cards = [];
  let current = null;
  const capacity = preset.maxCharsPerLine * preset.maxLines;

  for (const word of words) {
    const text = preset.uppercase ? word.text.toUpperCase() : word.text;
    const entry = { text, start: word.start, end: word.end };

    if (!current) {
      current = { words: [entry], chars: text.length, start: entry.start, end: entry.end };
      continue;
    }

    const gap = entry.start - current.end;
    const wouldOverflow = current.chars + 1 + text.length > capacity;
    const tooLong = entry.end - current.start > maxDuration;

    if (wouldOverflow || tooLong || gap > maxGap) {
      cards.push(current);
      current = { words: [entry], chars: text.length, start: entry.start, end: entry.end };
    } else {
      current.words.push(entry);
      current.chars += 1 + text.length;
      current.end = Math.max(current.end, entry.end);
    }
  }
  if (current) cards.push(current);
  return cards;
}

/**
 * Met le texte d'accroche en forme : lignes courtes, longueur bornée, coupe
 * sur un mot entier. Une accroche tronquée au milieu d'un mot fait amateur.
 */
export function layoutHook(text, { maxCharsPerLine, maxLines }) {
  const cleaned = escapeAssText(String(text ?? '')).replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';

  const words = cleaned.split(' ');
  const lines = [[]];
  let length = 0;
  for (const word of words) {
    const candidate = length === 0 ? word.length : length + 1 + word.length;
    if (candidate > maxCharsPerLine && lines[lines.length - 1].length > 0) {
      if (lines.length >= maxLines) break;
      lines.push([word]);
      length = word.length;
    } else {
      lines[lines.length - 1].push(word);
      length = candidate;
    }
  }
  return lines
    .filter((line) => line.length)
    .map((line) => line.join(' '))
    .join('\\N');
}

/** Répartit les mots d'une carte sur plusieurs lignes (retour \N). */
function layoutCardLines(card, preset) {
  const lines = [[]];
  let lineLength = 0;
  for (const word of card.words) {
    const candidate = lineLength === 0 ? word.text.length : lineLength + 1 + word.text.length;
    if (candidate > preset.maxCharsPerLine && lines[lines.length - 1].length > 0) {
      lines.push([word]);
      lineLength = word.text.length;
    } else {
      lines[lines.length - 1].push(word);
      lineLength = candidate;
    }
  }
  return lines;
}

/**
 * Convertit des mots horodatés en lignes de sous-titres.
 * C'est exactement le découpage qui sera incrusté : l'interface d'édition
 * travaille sur ces lignes, donc sur ce que la personne voit à l'écran.
 *
 * Les temps renvoyés sont **absolus** (temps de la vidéo source) : une ligne
 * corrigée à la main survit ainsi à un ajustement des bornes du clip.
 *
 * @returns {Array<{start:number,end:number,text:string}>}
 */
export function wordsToLines({ words, clipStart, clipEnd, style = DEFAULT_PRESET }) {
  // Les lignes servent à l'édition : elles conservent la casse d'origine.
  // La mise en majuscules est un effet de style, appliqué au rendu.
  const preset = { ...(CAPTION_PRESETS[style] ?? CAPTION_PRESETS[DEFAULT_PRESET]), uppercase: false };
  const local = toLocalWords({ words, clipStart, clipEnd });
  return groupWordsIntoCards(local, preset).map((card) => ({
    start: Number((card.start + clipStart).toFixed(3)),
    end: Number((card.end + clipStart).toFixed(3)),
    text: card.words.map((w) => w.text).join(' '),
  }));
}

/**
 * Répartit le texte d'une ligne sur sa fenêtre temporelle, proportionnellement
 * à la longueur des mots. Sert à réintégrer un texte corrigé à la main sans
 * perdre la synchronisation du karaoké.
 */
export function lineToWords(line) {
  const pieces = String(line.text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (pieces.length === 0) return [];

  const span = Math.max(0.2, line.end - line.start);
  const totalChars = pieces.reduce((sum, word) => sum + word.length, 0) || pieces.length;

  const out = [];
  let cursor = line.start;
  for (const piece of pieces) {
    const duration = Math.max(0.08, span * ((piece.length || 1) / totalChars));
    const end = Math.min(line.end, cursor + duration);
    out.push({ text: piece, start: cursor, end: end > cursor ? end : cursor + 0.08 });
    cursor = end;
  }
  out[out.length - 1].end = line.end;
  return out;
}

/** Mots du clip, ramenés au temps local et bornés au clip. */
function toLocalWords({ words, clipStart, clipEnd }) {
  const duration = clipEnd - clipStart;
  return (words ?? [])
    .filter((w) => w.end > clipStart && w.start < clipEnd)
    .map((w) => ({
      text: escapeAssText(w.text),
      start: Math.max(0, w.start - clipStart),
      end: Math.min(duration, w.end - clipStart),
    }))
    .filter((w) => w.text && w.end > w.start);
}

/**
 * Construit le contenu d'un fichier ASS pour un clip.
 *
 * @param {object} options
 * @param {Array<{text:string,start:number,end:number}>} options.words mots horodatés,
 *        exprimés dans le temps de la vidéo source
 * @param {number} options.clipStart début du clip dans la source (secondes)
 * @param {number} options.clipEnd   fin du clip dans la source (secondes)
 * @param {string} options.style     clé de préréglage (voir CAPTION_PRESETS)
 * @returns {string} contenu du fichier .ass
 */
export function buildAss({
  words,
  clipStart,
  clipEnd,
  style = DEFAULT_PRESET,
  playResX = 1080,
  playResY = 1920,
  // Accroche incrustée en tête de clip : le premier écran décide si la
  // personne reste. L'afficher en texte, en haut, la fait lire même en muet.
  hook = null,
  hookSeconds = 2.4,
  // Lignes imposées (sous-titres corrigés à la main), en temps absolu.
  // Quand elles sont fournies, elles remplacent le regroupement automatique :
  // les retours à la ligne choisis par la personne sont respectés tels quels.
  lines = null,
}) {
  const preset = CAPTION_PRESETS[style] ?? CAPTION_PRESETS[DEFAULT_PRESET];
  const duration = clipEnd - clipStart;

  // Mots du clip, replacés dans le temps local et bornés au clip.
  const local = toLocalWords({ words, clipStart, clipEnd });

  const header = [
    '[Script Info]',
    '; Généré par ytshorter',
    'ScriptType: v4.00+',
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour,' +
      ' Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline,' +
      ' Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    [
      'Style: Karaoke',
      preset.fontName,
      preset.fontSize,
      preset.primary,
      preset.secondary,
      preset.outline,
      preset.back,
      preset.bold,
      0,
      0,
      0,
      100,
      100,
      0,
      0,
      preset.borderStyle,
      preset.outlineWidth,
      preset.shadow,
      2, // alignement bas-centre
      60,
      60,
      preset.marginV,
      1,
    ].join(','),
    [
      'Style: Hook',
      preset.fontName,
      HOOK_STYLE.fontSize,
      HOOK_STYLE.primary,
      HOOK_STYLE.primary,
      HOOK_STYLE.outline,
      HOOK_STYLE.back,
      -1,
      0,
      0,
      0,
      100,
      100,
      0,
      0,
      3, // bandeau opaque derrière le texte
      12,
      0,
      8, // alignement haut-centre
      70,
      70,
      HOOK_STYLE.marginV,
      1,
    ].join(','),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const events = [];

  const hookText = hook ? layoutHook(hook, HOOK_STYLE) : '';
  if (hookText) {
    const end = Math.min(duration, Math.max(1.2, hookSeconds));
    // Fondu court : le bandeau apparaît et disparaît sans clignoter.
    events.push(
      `Dialogue: 1,${formatAssTime(0)},${formatAssTime(end)},Hook,,0,0,0,,{\\fad(220,320)}${hookText}`,
    );
  }

  const cards = Array.isArray(lines) && lines.length
    ? lines
        // Les lignes hors du clip sont écartées, celles à cheval sont bornées.
        .filter((line) => Number(line.end) > clipStart && Number(line.start) < clipEnd)
        .map((line) => {
          const pieces = lineToWords({
            start: Math.max(0, Number(line.start) - clipStart),
            end: Math.min(duration, Number(line.end) - clipStart),
            text: preset.uppercase ? String(line.text ?? '').toUpperCase() : line.text,
          }).map((w) => ({ ...w, text: escapeAssText(w.text) }));
          return pieces.length
            ? { words: pieces, start: pieces[0].start, end: pieces.at(-1).end }
            : null;
        })
        .filter(Boolean)
    : groupWordsIntoCards(local, preset);

  const cardEvents = cards.map((card) => {
    const lines = layoutCardLines(card, preset);
    const rendered = lines
      .map((line) =>
        line
          .map((word, index) => {
            const isLast = index === line.length - 1 && line === lines[lines.length - 1];
            const nextWord = nextWordOf(card, word);
            const until = isLast || !nextWord ? card.end : nextWord.start;
            const cs = Math.max(1, Math.round((until - word.start) * 100));
            return `{\\k${cs}}${word.text}`;
          })
          .join(' '),
      )
      .join('\\N');

    return `Dialogue: 0,${formatAssTime(card.start)},${formatAssTime(card.end + 0.08)},Karaoke,,0,0,0,,${rendered}`;
  });

  return `${header.join('\n')}\n${[...events, ...cardEvents].join('\n')}\n`;
}

function nextWordOf(card, word) {
  const i = card.words.indexOf(word);
  return i >= 0 ? card.words[i + 1] : null;
}
