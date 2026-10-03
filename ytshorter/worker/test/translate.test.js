import test from 'node:test';
import assert from 'node:assert/strict';
import {
  distributeTranslation,
  applyTranslations,
  segmentsWithWords,
  translateWords,
} from '../src/steps/translate.js';
import { createLlmClient } from '../src/llm/index.js';

const silentLogger = { warn() {}, info() {}, debug() {}, error() {} };

const WORDS = [
  { text: 'Bonjour', start: 0.0, end: 0.5 },
  { text: 'tout', start: 0.5, end: 0.8 },
  { text: 'le', start: 0.8, end: 0.9 },
  { text: 'monde.', start: 0.9, end: 1.4 },
  { text: 'Aujourd’hui', start: 2.5, end: 3.2 },
  { text: 'on', start: 3.2, end: 3.4 },
  { text: 'parle', start: 3.4, end: 3.9 },
  { text: 'de', start: 3.9, end: 4.0 },
  { text: 'montage.', start: 4.0, end: 4.7 },
];

test('un texte traduit est réparti sur la fenêtre du segment', () => {
  const words = distributeTranslation({ start: 10, end: 13 }, 'Hello everyone out there');

  assert.equal(words.length, 4);
  assert.equal(words[0].start, 10);
  assert.equal(words.at(-1).end, 13, 'le dernier mot doit finir avec le segment');
  for (let i = 0; i < words.length; i += 1) {
    assert.ok(words[i].end > words[i].start, 'durée positive');
    if (words[i + 1]) {
      assert.ok(words[i + 1].start >= words[i].end - 1e-9, 'pas de chevauchement');
    }
  }
  // Les mots longs occupent plus de temps que les mots courts.
  const durations = words.map((w) => w.end - w.start);
  assert.ok(durations[1] > durations[2], '« everyone » doit durer plus que « out »');
});

test('un segment vide ou blanc ne produit aucun mot', () => {
  assert.deepEqual(distributeTranslation({ start: 0, end: 2 }, ''), []);
  assert.deepEqual(distributeTranslation({ start: 0, end: 2 }, '   '), []);
  assert.deepEqual(distributeTranslation({ start: 0, end: 2 }, null), []);
});

test('les segments conservent leurs mots d’origine', () => {
  const segments = segmentsWithWords(WORDS);
  assert.ok(segments.length >= 2, 'le silence doit séparer les segments');
  const total = segments.reduce((sum, s) => sum + s.words.length, 0);
  assert.equal(total, WORDS.length, 'aucun mot perdu');
});

test('un segment non traduit garde sa version d’origine', () => {
  const segments = segmentsWithWords(WORDS);
  const words = applyTranslations(segments, [{ i: 0, text: 'Hello everyone.' }]);

  assert.equal(words[0].text, 'Hello', 'premier segment traduit');
  // Le second segment n'a pas été traduit : ses mots d'origine sont conservés.
  assert.ok(
    words.some((w) => w.text === 'montage.'),
    'le segment sans traduction doit rester lisible',
  );
});

test('les horodatages restent croissants après traduction', () => {
  const segments = segmentsWithWords(WORDS);
  const words = applyTranslations(
    segments,
    segments.map((_, i) => ({ i, text: `translated segment number ${i} with several words` })),
  );

  for (let i = 1; i < words.length; i += 1) {
    assert.ok(words[i].start >= words[i - 1].start - 1e-9, 'ordre chronologique conservé');
  }
  assert.ok(words[0].start >= 0);
  assert.ok(words.at(-1).end <= WORDS.at(-1).end + 1e-9, 'la traduction ne dépasse pas la source');
});

test('translateWords interroge le LLM et renvoie des mots utilisables', async () => {
  const calls = [];
  const provider = {
    name: 'faux',
    isConfigured: () => true,
    async complete({ system, user }) {
      calls.push({ system, user });
      // Répond à chaque segment demandé, dans l'ordre.
      const indices = [...user.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
      return JSON.stringify({
        segments: indices.map((i) => ({ i, text: `english line ${i}` })),
      });
    },
  };
  const llm = createLlmClient({
    config: { llmAttemptsPerProvider: 1, providerChain: [] },
    logger: silentLogger,
    providers: [provider],
  });

  const words = await translateWords({
    words: WORDS,
    targetLanguage: 'en',
    llm,
    config: { maxTranscriptChars: 45000 },
    logger: silentLogger,
  });

  assert.equal(calls.length, 1, 'une seule requête pour une transcription courte');
  assert.match(calls[0].system, /anglais/, 'la langue cible est dans les consignes');
  assert.ok(words.length > 0);
  assert.ok(words.every((w) => /english|line|\d/.test(w.text)), 'tous les mots sont traduits');
  assert.ok(words.every((w) => w.end > w.start), 'tous les mots ont une durée');
});

test('une transcription longue est traduite en plusieurs lots', async () => {
  const many = Array.from({ length: 400 }, (_, i) => ({
    text: `mot${i}`.padEnd(12, 'x'),
    start: i * 0.5,
    end: i * 0.5 + 0.4,
  }));

  let batches = 0;
  const provider = {
    name: 'faux',
    isConfigured: () => true,
    async complete({ user }) {
      batches += 1;
      const indices = [...user.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
      return JSON.stringify({ segments: indices.map((i) => ({ i, text: `line ${i}` })) });
    },
  };
  const llm = createLlmClient({
    config: { llmAttemptsPerProvider: 1, providerChain: [] },
    logger: silentLogger,
    providers: [provider],
  });

  const words = await translateWords({
    words: many,
    targetLanguage: 'en',
    llm,
    config: { maxTranscriptChars: 500 },
    logger: silentLogger,
  });

  assert.ok(batches > 1, `la traduction devrait être découpée (${batches} lot)`);
  assert.ok(words.length > 0);
});
