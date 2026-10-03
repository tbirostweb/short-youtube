import test from 'node:test';
import assert from 'node:assert/strict';
import { messages, pageMeta, availableLocales } from '../src/i18n/messages.js';

test('toutes les langues couvrent exactement les mêmes clés', () => {
  const reference = Object.keys(messages.fr).sort();
  for (const [code, table] of Object.entries(messages)) {
    const keys = Object.keys(table).sort();
    assert.deepEqual(keys, reference, `la langue "${code}" ne couvre pas les mêmes clés`);
  }
});

test('aucune traduction n’est vide', () => {
  for (const [code, table] of Object.entries(messages)) {
    for (const [key, value] of Object.entries(table)) {
      assert.equal(typeof value, 'string', `${code}.${key} doit être une chaîne`);
      assert.ok(value.trim().length > 0, `${code}.${key} est vide`);
    }
  }
});

test('les variables d’interpolation sont les mêmes dans toutes les langues', () => {
  const placeholders = (text) => (text.match(/\{(\w+)\}/g) ?? []).sort().join(',');
  for (const key of Object.keys(messages.fr)) {
    const reference = placeholders(messages.fr[key]);
    for (const [code, table] of Object.entries(messages)) {
      assert.equal(placeholders(table[key]), reference, `${code}.${key} : variables différentes`);
    }
  }
});

test('chaque route a un titre et une description dans chaque langue', () => {
  const routes = ['home', 'job', 'results', 'library', 'notFound'];
  for (const [code, table] of Object.entries(pageMeta)) {
    for (const route of routes) {
      assert.ok(table[route], `${code} : métadonnées manquantes pour la route ${route}`);
      assert.ok(table[route].title.length > 0, `${code}.${route} : titre vide`);
      assert.ok(table[route].description.length > 0, `${code}.${route} : description vide`);
    }
  }
});

test('les langues proposées existent bien', () => {
  for (const item of availableLocales) {
    assert.ok(messages[item.code], `la langue proposée "${item.code}" n’a pas de dictionnaire`);
  }
});

test('les codes d’erreur de l’api ont tous un message', () => {
  // Doit rester synchronisé avec api/src/lib/errors.js et worker/src/lib/errors.js.
  const codes = [
    'INVALID_URL', 'VIDEO_TOO_LONG', 'DOWNLOAD_FAILED', 'NO_SPEECH', 'TRANSCRIPTION_FAILED',
    'QUOTA_EXCEEDED', 'PROVIDER_ERROR', 'INTERNAL', 'NOT_FOUND', 'FORBIDDEN', 'UNAUTHORIZED',
    'RATE_LIMITED', 'VALIDATION_FAILED', 'LINK_EXPIRED', 'CONFLICT', 'UNSUPPORTED_FILE',
    'FILE_TOO_LARGE', 'UPLOAD_NOT_FOUND', 'RESTYLE_IN_PROGRESS', 'RESTYLE_UNAVAILABLE', 'NETWORK',
  ];
  for (const code of codes) {
    for (const [lang, table] of Object.entries(messages)) {
      assert.ok(table[`error.${code}`], `${lang} : message manquant pour ${code}`);
    }
  }
});
