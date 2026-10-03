import { cutFile, wordsFile, linesFile, exists } from './clip-files.js';

// Un clip ne peut être re-stylisé que si sa découpe et les mots horodatés sont
// encore sur le volume média. L'api partage ce volume avec le worker : elle
// peut donc répondre tout de suite, au lieu de mettre en file une tâche vouée
// à échouer. L'interface s'en sert pour désactiver le bouton en connaissance
// de cause.

export async function canRestyle(config, jobId, idx) {
  const [hasCut, hasWords] = await Promise.all([
    exists(cutFile(config, jobId, idx)),
    exists(wordsFile(config, jobId)),
  ]);
  return hasCut && hasWords;
}

/** Les sous-titres ne sont corrigeables que si les lignes incrustées existent. */
export async function canEditSubtitles(config, jobId, idx) {
  return exists(linesFile(config, jobId, idx));
}
