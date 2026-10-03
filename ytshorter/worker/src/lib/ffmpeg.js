import path from 'node:path';
import { run } from './exec.js';

// Enveloppe autour de ffmpeg / ffprobe. Toutes les commandes sont réelles et
// exécutées sans shell (pas d'interpolation, pas d'injection possible).

/** Lit les caractéristiques d'un fichier média. */
export async function probe(file, config) {
  const { stdout } = await run(
    config.ffprobe,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
    { timeoutMs: 60000 },
  );
  const data = JSON.parse(stdout);
  const video = (data.streams || []).find((s) => s.codec_type === 'video');
  const audio = (data.streams || []).find((s) => s.codec_type === 'audio');
  const duration = Number(data.format?.duration ?? video?.duration ?? 0);
  return {
    duration: Number.isFinite(duration) ? duration : 0,
    width: video ? Number(video.width) : 0,
    height: video ? Number(video.height) : 0,
    hasAudio: Boolean(audio),
    sizeBytes: Number(data.format?.size ?? 0),
  };
}

/** Extrait un WAV 16 kHz mono : format d'entrée attendu par whisper.cpp. */
export async function extractWav16k(input, output, config) {
  await run(
    config.ffmpeg,
    ['-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', output],
    { timeoutMs: 30 * 60 * 1000 },
  );
  return output;
}

/** Extrait un FLAC 16 kHz mono : compact, sans perte, accepté par l'API Groq. */
export async function extractFlac16k(input, output, config, { start, duration } = {}) {
  const args = ['-y'];
  if (start !== undefined) args.push('-ss', String(start));
  args.push('-i', input);
  if (duration !== undefined) args.push('-t', String(duration));
  args.push('-vn', '-ac', '1', '-ar', '16000', '-c:a', 'flac', '-compression_level', '8', output);
  await run(config.ffmpeg, args, { timeoutMs: 30 * 60 * 1000 });
  return output;
}

/**
 * Coupe précise avec ré-encodage (l'option -ss après -i garantit une coupe
 * à l'image près, contrairement à la coupe par copie de flux).
 */
export async function cutClip({ input, output, start, end, config, onProgress }) {
  const total = Math.max(0.1, end - start);
  await run(
    config.ffmpeg,
    [
      '-y',
      '-ss', start.toFixed(3),
      '-to', end.toFixed(3),
      '-i', input,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      output,
    ],
    {
      timeoutMs: 60 * 60 * 1000,
      onStderrLine: onProgress ? makeTimeParser(total, onProgress) : undefined,
    },
  );
  return output;
}

/**
 * Construit la chaîne de filtres vidéo verticale.
 *
 * Deux mises en page :
 *
 *  - `crop` (défaut) : recadrage 9:16 autour du point de focus. L'image remplit
 *    tout l'écran, mais ce qui sort du cadre est perdu.
 *  - `blur` : la vidéo entière est conservée, centrée, sur un fond constitué
 *    d'elle-même agrandie, floutée et assombrie. Indispensable quand le sujet
 *    ne tient pas dans un cadre vertical (plan large, deux interlocuteurs,
 *    slides). Aucune information n'est perdue.
 *
 * Dans les deux cas, les sous-titres sont incrustés dans la même passe.
 * Les virgules internes aux expressions sont échappées pour le parseur de
 * filtres ffmpeg. `sendcmdFile` active le recadrage suivi : la position x est
 * alors pilotée image par image (mise en page `crop` uniquement).
 */
export function buildVerticalFilter({
  focusX = 0.5,
  assFile,
  sendcmdFile = null,
  layout = 'crop',
  fadeOut = 0,
  durationSeconds = 0,
}) {
  // Les chaînes nommées se séparent par un point-virgule ; les filtres d'une
  // même chaîne, par une virgule. `parts` porte la chaîne finale.
  const chains = [];
  const parts = [];

  if (layout === 'blur') {
    // La vidéo source alimente deux branches : le fond flou et l'image nette.
    chains.push('split=2[bgsrc][fgsrc]');
    chains.push(
      '[bgsrc]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,' +
        'gblur=sigma=32,eq=brightness=-0.10:saturation=0.85[bg]',
    );
    chains.push('[fgsrc]scale=1080:1920:force_original_aspect_ratio=decrease[fg]');
    parts.push('[bg][fg]overlay=(W-w)/2:(H-h)/2');
    parts.push('setsar=1');
  } else {
    const cropW = "min(ih*9/16\\,iw)";
    const focus = Math.max(0, Math.min(1, Number(focusX) || 0));
    const x = `clip(iw*${focus.toFixed(4)}-(${cropW})/2\\,0\\,iw-(${cropW}))`;

    if (sendcmdFile) parts.push(`sendcmd=f=${escapeFilterPath(sendcmdFile)}`);
    parts.push(`crop@dyn=w='${cropW}':h=ih:x='${x}':y=0`);
    parts.push('scale=1080:1920:force_original_aspect_ratio=increase');
    parts.push('crop=1080:1920');
    parts.push('setsar=1');
  }

  // Les sous-titres viennent avant le fondu : ils s'effacent avec l'image
  // plutôt que de disparaître d'un coup.
  if (assFile) parts.push(`ass=${escapeFilterPath(assFile)}`);

  // Pas de fondu d'ouverture : sur un format court, deux dixièmes de seconde
  // de noir au début, c'est deux dixièmes de seconde d'accroche perdue.
  // Un fondu de fermeture, en revanche, évite la coupure brutale.
  if (fadeOut > 0 && durationSeconds > fadeOut + 0.3) {
    parts.push(`fade=t=out:st=${(durationSeconds - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}`);
  }

  chains.push(parts.join(','));
  return chains.join(';');
}

// Cible de loudness des plateformes courtes (YouTube, TikTok, Instagram).
const TARGET_LUFS = -14;
const TARGET_TP = -1.5;
const TARGET_LRA = 11;
// En dessous, le passage est considéré comme silencieux : le normaliser n'a
// aucun sens et ferait remonter du bruit de fond à plein volume.
const SILENCE_LUFS = -60;

/**
 * Mesure la loudness d'un fichier (première passe de `loudnorm`).
 *
 * Deux raisons de mesurer avant de normaliser :
 *
 *  1. la normalisation en deux passes est linéaire — elle applique un gain
 *     constant — là où la passe unique compresse dynamiquement et « pompe » ;
 *  2. sur un passage totalement silencieux, `loudnorm` produit des valeurs
 *     non numériques qui font échouer l'encodage. Mesurer permet de détecter
 *     ce cas et de ne rien appliquer du tout.
 *
 * @returns {Promise<object|null>} mesures, ou null si silence ou échec.
 */
export async function measureLoudness(input, config, { cwd, trimStart = 0, durationSeconds = 0 } = {}) {
  try {
    const { stderr } = await run(
      config.ffmpeg,
      [
        '-hide_banner',
        ...(trimStart > 0 ? ['-ss', trimStart.toFixed(3)] : []),
        '-i', input,
        ...(durationSeconds > 0 ? ['-t', durationSeconds.toFixed(3)] : []),
        '-af', `loudnorm=I=${TARGET_LUFS}:TP=${TARGET_TP}:LRA=${TARGET_LRA}:print_format=json`,
        '-vn',
        '-f', 'null',
        '-',
      ],
      { cwd, timeoutMs: 15 * 60 * 1000 },
    );

    // Le rapport JSON est imprimé en fin de flux d'erreur standard.
    const start = stderr.lastIndexOf('{');
    const end = stderr.lastIndexOf('}');
    if (start === -1 || end <= start) return null;

    const measured = JSON.parse(stderr.slice(start, end + 1));
    const inputI = Number.parseFloat(measured.input_i);
    if (!Number.isFinite(inputI) || inputI <= SILENCE_LUFS) return null;

    const numbers = ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset'];
    for (const key of numbers) {
      if (!Number.isFinite(Number.parseFloat(measured[key]))) return null;
    }
    return measured;
  } catch {
    // Mesure impossible : on préfère un clip non normalisé à un clip absent.
    return null;
  }
}

/**
 * Chaîne de filtres audio.
 *
 * La normalisation aligne le volume sur -14 LUFS : sans elle, deux clips issus
 * de la même vidéo sortent à des volumes très différents selon le passage.
 * Elle n'est appliquée que si la mesure a réussi et que le son n'est pas un
 * silence. Un fondu d'ouverture très court supprime le claquement de la coupe ;
 * le fondu de fermeture accompagne celui de l'image.
 */
export function buildAudioFilter({ measured = null, fadeOut = 0, durationSeconds = 0 }) {
  const parts = [];

  if (measured) {
    parts.push(
      [
        `loudnorm=I=${TARGET_LUFS}`,
        `TP=${TARGET_TP}`,
        `LRA=${TARGET_LRA}`,
        `measured_I=${measured.input_i}`,
        `measured_TP=${measured.input_tp}`,
        `measured_LRA=${measured.input_lra}`,
        `measured_thresh=${measured.input_thresh}`,
        `offset=${measured.target_offset}`,
        'linear=true',
        'print_format=summary',
      ].join(':'),
    );
    // loudnorm travaille en 192 kHz : on revient au débit de sortie.
    parts.push('aresample=44100');
  }

  parts.push('afade=t=in:st=0:d=0.05');
  if (fadeOut > 0 && durationSeconds > fadeOut + 0.3) {
    parts.push(`afade=t=out:st=${(durationSeconds - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}`);
  }
  return parts.join(',');
}

/**
 * Recadrage + sous-titres en une seule passe d'encodage.
 * `cwd` est le dossier du job : les fichiers sont référencés par leur nom
 * simple, ce qui évite tout échappement de chemin dans le graphe de filtres.
 */
export async function renderVertical({
  input,
  output,
  assFile,
  focusX,
  sendcmdFile,
  layout = 'crop',
  cwd,
  durationSeconds,
  // Rognage dans le fichier d'entrée : la découpe est conservée avec une marge
  // de sécurité de part et d'autre, ce qui permet de déplacer les bornes du
  // clip après coup sans avoir gardé la vidéo source.
  trimStart = 0,
  config,
  onProgress,
}) {
  const fadeOut = config.render?.fadeOutSeconds ?? 0;
  const filter = buildVerticalFilter({
    focusX,
    assFile,
    sendcmdFile,
    layout,
    fadeOut,
    durationSeconds,
  });
  // Première passe : mesure de la loudness (rapide, audio seul).
  const measured =
    config.render?.normalizeAudio === false
      ? null
      : await measureLoudness(input, config, { cwd, trimStart, durationSeconds });
  const audioFilter = buildAudioFilter({ measured, fadeOut, durationSeconds });

  const seek = trimStart > 0 ? ['-ss', trimStart.toFixed(3)] : [];
  const limit = durationSeconds > 0 ? ['-t', durationSeconds.toFixed(3)] : [];

  await run(
    config.ffmpeg,
    [
      '-y',
      ...seek,
      '-i', input,
      ...limit,
      '-vf', filter,
      '-af', audioFilter,
      '-r', '30',
      '-c:v', 'libx264',
      '-preset', config.render?.preset ?? 'veryfast',
      '-crf', String(config.render?.crf ?? 21),
      '-pix_fmt', 'yuv420p',
      '-profile:v', 'high',
      // Un intervalle d'images clés court : les plateformes ré-encodent, et
      // un GOP long dégrade le premier plan après leur transcodage.
      '-g', '60',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '44100',
      '-movflags', '+faststart',
      output,
    ],
    {
      cwd,
      timeoutMs: 60 * 60 * 1000,
      onStderrLine: onProgress ? makeTimeParser(durationSeconds, onProgress) : undefined,
    },
  );
  return path.join(cwd ?? '.', output);
}

// Les chemins passés à un filtre ffmpeg doivent échapper \ : et '
function escapeFilterPath(p) {
  return String(p).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

// Convertit les lignes "time=00:00:12.34" de ffmpeg en ratio d'avancement.
function makeTimeParser(totalSeconds, onProgress) {
  const total = Number(totalSeconds) > 0 ? Number(totalSeconds) : 0;
  return (line) => {
    const m = /time=\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(line);
    if (!m || !total) return;
    const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    onProgress(Math.max(0, Math.min(1, seconds / total)));
  };
}
