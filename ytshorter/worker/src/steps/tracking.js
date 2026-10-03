import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../lib/exec.js';

// Module optionnel : recadrage avec suivi du sujet.
//
// Le script Python détecte les visages, lisse la position horizontale et
// réinitialise le lissage à chaque changement de plan. Le résultat est
// converti en fichier de commandes `sendcmd` qui pilote la position x du
// filtre crop image par image, dans la même passe d'encodage.
//
// Tout échec (script absent, OpenCV manquant, aucun visage) est sans
// conséquence : le pipeline retombe sur le recadrage centré ajustable.

const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'python',
  'track_crop.py',
);

/** Convertit des positions de sujet en fichier de commandes ffmpeg sendcmd. */
export function buildSendcmd(keyframes, { width, height, step = 0.2 }) {
  // ffmpeg tronque la largeur de recadrage à l'entier inférieur : on aligne
  // le calcul dessus pour que x + w ne dépasse jamais la largeur de l'image.
  const cropW = Math.floor(Math.min((height * 9) / 16, width));
  const maxX = Math.max(0, width - cropW);
  const lines = [];

  keyframes.forEach((kf, index) => {
    const start = Number(kf.t);
    const next = keyframes[index + 1];
    const end = next ? Number(next.t) : start + step;
    const x = Math.floor(Math.max(0, Math.min(maxX, Number(kf.cx) - cropW / 2)));
    lines.push(`${start.toFixed(3)}-${end.toFixed(3)} [enter] crop@dyn x ${x};`);
  });

  return lines.join('\n') + '\n';
}

export async function buildTrackingCommands({ videoPath, workDir, name, config, logger }) {
  const jsonPath = path.join(workDir, `${name}.track.json`);
  try {
    await run(
      config.python,
      [SCRIPT, '--input', videoPath, '--output', jsonPath, '--sample-fps', '5'],
      { timeoutMs: 20 * 60 * 1000 },
    );
    const data = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
    if (!Array.isArray(data.keyframes) || data.keyframes.length === 0) {
      logger?.warn({}, 'suivi : aucune position exploitable, recadrage centré');
      return null;
    }

    // Garde-fou de qualité : un suivi médiocre est pire qu'un cadre fixe.
    // On accepte soit un visage vu assez souvent, soit une saillance très
    // constante. Entre les deux, le recadrage centré reste préférable.
    const faceRatio = Number(data.face_ratio ?? 0);
    const usableRatio = Number(data.usable_ratio ?? 0);
    if (!(faceRatio >= 0.15 || usableRatio >= 0.7)) {
      logger?.info(
        { faceRatio, usableRatio, methods: data.method_counts },
        'suivi : sujet trop peu identifiable, recadrage centré',
      );
      return null;
    }

    const cmdPath = path.join(workDir, `${name}.sendcmd`);
    await fs.writeFile(
      cmdPath,
      buildSendcmd(data.keyframes, {
        width: data.width,
        height: data.height,
        step: 1 / (data.sample_fps || 5),
      }),
      'utf8',
    );
    logger?.info(
      {
        keyframes: data.keyframes.length,
        faceRatio,
        usableRatio,
        shots: data.shots,
        travel: data.travel,
      },
      'suivi : recadrage dynamique activé',
    );
    return path.basename(cmdPath);
  } catch (err) {
    logger?.warn({ err: err.message }, 'suivi indisponible : repli sur le recadrage centré');
    return null;
  } finally {
    await fs.rm(jsonPath, { force: true });
  }
}
