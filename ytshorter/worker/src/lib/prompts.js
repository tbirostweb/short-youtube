import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROMPT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'prompts');
const cache = new Map();

/** Charge un gabarit de prompt (fichier texte éditable) et le met en cache. */
export async function loadPrompt(name) {
  if (cache.has(name)) return cache.get(name);
  const text = await fs.readFile(path.join(PROMPT_DIR, `${name}.txt`), 'utf8');
  cache.set(name, text);
  return text;
}

/** Remplace les {variables} du gabarit. Une variable absente devient une chaîne vide. */
export function fillTemplate(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    values[key] === undefined || values[key] === null ? '' : String(values[key]),
  );
}

export async function renderPrompt(name, values) {
  return fillTemplate(await loadPrompt(name), values);
}
