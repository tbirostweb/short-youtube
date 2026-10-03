import { computed, ref, watchEffect } from 'vue';
import { messages, availableLocales, pageMeta } from './messages.js';

const STORAGE_KEY = 'ytshorter.locale';
const FALLBACK = 'fr';

function detectLocale() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && messages[stored]) return stored;
  } catch {
    /* stockage indisponible (navigation privée) */
  }
  const nav = (navigator.language || FALLBACK).slice(0, 2).toLowerCase();
  return messages[nav] ? nav : FALLBACK;
}

export const locale = ref(detectLocale());

watchEffect(() => {
  document.documentElement.lang = locale.value;
  try {
    localStorage.setItem(STORAGE_KEY, locale.value);
  } catch {
    /* sans conséquence */
  }
});

/**
 * Traduction simple avec interpolation {clé} et pluriel « singulier | pluriel »
 * choisi par la variable `count`.
 */
export function t(key, params = {}) {
  const table = messages[locale.value] ?? messages[FALLBACK];
  let text = table[key] ?? messages[FALLBACK][key] ?? key;

  if (text.includes('|') && params.count !== undefined) {
    const forms = text.split('|').map((s) => s.trim());
    text = Number(params.count) <= 1 ? forms[0] : forms[1] ?? forms[0];
  }
  return text.replace(/\{(\w+)\}/g, (_, name) =>
    params[name] === undefined ? `{${name}}` : String(params[name]),
  );
}

export function setLocale(code) {
  if (messages[code]) locale.value = code;
}

export function useI18n() {
  return { t, locale, setLocale, availableLocales: computed(() => availableLocales) };
}

/** Applique le titre et la description de page (référencement et onglet). */
export function applyPageMeta(routeName) {
  const table = pageMeta[locale.value] ?? pageMeta[FALLBACK];
  const meta = table[routeName] ?? table.home;
  document.title = meta.title;
  let tag = document.querySelector('meta[name="description"]');
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute('name', 'description');
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', meta.description);
}

/** Traduit un code d'erreur d'API en message lisible. */
export function translateError(error) {
  if (!error) return '';
  const key = `error.${error.code ?? 'INTERNAL'}`;
  const table = messages[locale.value] ?? messages[FALLBACK];
  if (table[key]) return t(key);
  // Code inconnu : on affiche le message du serveur, déjà destiné à l'utilisateur.
  return error.message || t('error.INTERNAL');
}
