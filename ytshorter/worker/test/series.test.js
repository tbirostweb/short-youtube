import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSelection, selectMoments } from '../src/steps/select.js';
import { generateMetadata } from '../src/steps/metadata.js';
import { createLlmClient } from '../src/llm/index.js';

const silentLogger = { warn() {}, info() {}, debug() {}, error() {} };
const config = { maxTranscriptChars: 45000, llmAttemptsPerProvider: 1, providerChain: [] };

function makeWords(count, step = 0.5) {
  return Array.from({ length: count }, (_, i) => ({
    text: `mot${i}`,
    start: i * step,
    end: i * step + step * 0.9,
  }));
}

/** Fournisseur factice qui renvoie une réponse fixe et retient les prompts. */
function fakeLlm(responses) {
  const calls = [];
  const provider = {
    name: 'faux',
    model: 'faux-1',
    isConfigured: () => true,
    async complete(payload) {
      calls.push(payload);
      return responses.shift();
    },
  };
  return { calls, llm: createLlmClient({ config, logger: silentLogger, providers: [provider] }) };
}

test('en mode série, les extraits sortent dans l’ordre de la vidéo', () => {
  const words = makeWords(1200);
  const raw = [
    { start: 400, end: 440, score: 70, hook: 'troisieme', transcript: 't' },
    { start: 100, end: 140, score: 95, hook: 'premier', transcript: 't' },
    { start: 250, end: 290, score: 85, hook: 'deuxieme', transcript: 't' },
  ];
  const options = { words, videoDuration: 600, minSeconds: 32, maxSeconds: 61, clipCount: 3 };

  // Hors mode série : le meilleur score d'abord.
  const parScore = sanitizeSelection({ clips: raw, ...options });
  assert.deepEqual(parScore.map((c) => c.hook), ['premier', 'deuxieme', 'troisieme']);

  // Les scores étant ici alignés sur l'ordre, on vérifie avec un ordre inversé.
  const inverse = [
    { start: 400, end: 440, score: 95, hook: 'fin', transcript: 't' },
    { start: 100, end: 140, score: 70, hook: 'debut', transcript: 't' },
  ];
  assert.deepEqual(
    sanitizeSelection({ clips: inverse, ...options }).map((c) => c.hook),
    ['fin', 'debut'],
    'sans mode série : par score décroissant',
  );
  assert.deepEqual(
    sanitizeSelection({ clips: inverse, ...options, chronological: true }).map((c) => c.hook),
    ['debut', 'fin'],
    'en mode série : ordre chronologique',
  );
});

test('le mode série ajoute ses consignes au prompt de sélection', async () => {
  const reply = JSON.stringify({
    clips: [
      { start: 100, end: 140, score: 90, hook: 'a', transcript: 't' },
      { start: 200, end: 240, score: 80, hook: 'b', transcript: 't' },
    ],
  });

  const sans = fakeLlm([reply]);
  await selectMoments({
    words: makeWords(600), videoTitle: 'T', videoDescription: '', videoDuration: 300,
    clipCount: 2, targetDuration: 40, seriesMode: false,
    llm: sans.llm, config, logger: silentLogger,
  });
  assert.ok(!/MODE SÉRIE/.test(sans.calls[0].system), 'pas de consignes série par défaut');

  const avec = fakeLlm([reply]);
  await selectMoments({
    words: makeWords(600), videoTitle: 'T', videoDescription: '', videoDuration: 300,
    clipCount: 2, targetDuration: 40, seriesMode: true,
    llm: avec.llm, config, logger: silentLogger,
  });
  assert.match(avec.calls[0].system, /MODE SÉRIE/);
  assert.match(avec.calls[0].system, /ordre chronologique/);
});

test('les métadonnées d’un épisode annoncent le suivant', async () => {
  const reply = JSON.stringify({
    youtube_shorts: { title: 'Partie 1/3 — Le début', description: 'd', hashtags: ['#Shorts'] },
    tiktok: { caption: 'c', hashtags: ['#fyp'] },
  });
  const { calls, llm } = fakeLlm([reply]);

  await generateMetadata({
    clip: { start: 0, end: 40, hook: 'accroche', transcript: 't' },
    videoTitle: 'Ma vidéo',
    language: 'fr',
    llm,
    logger: silentLogger,
    series: { index: 1, total: 3, nextHook: 'la révélation finale' },
  });

  assert.match(calls[0].system, /MODE SÉRIE/);
  assert.match(calls[0].system, /Partie 1\/3/, 'le rang de l’épisode est imposé');
  assert.match(calls[0].system, /la révélation finale/, 'l’accroche suivante sert de teaser');
  assert.match(calls[0].system, /s'abonner/);
});

test('le dernier épisode ne promet pas de suite', async () => {
  const reply = JSON.stringify({
    youtube_shorts: { title: 'Partie 3/3', description: 'd', hashtags: [] },
    tiktok: { caption: 'c', hashtags: [] },
  });
  const { calls, llm } = fakeLlm([reply]);

  await generateMetadata({
    clip: { start: 0, end: 40, hook: 'fin', transcript: 't' },
    videoTitle: 'Ma vidéo', language: 'fr', llm, logger: silentLogger,
    series: { index: 3, total: 3, nextHook: null },
  });

  assert.match(calls[0].system, /dernier épisode/);
  assert.ok(!/partie suivante porte sur/.test(calls[0].system));
});

test('sans mode série, aucune consigne de série ne fuite dans le prompt', async () => {
  const reply = JSON.stringify({
    youtube_shorts: { title: 't', description: 'd', hashtags: [] },
    tiktok: { caption: 'c', hashtags: [] },
  });
  const { calls, llm } = fakeLlm([reply]);

  await generateMetadata({
    clip: { start: 0, end: 40, hook: 'h', transcript: 't' },
    videoTitle: 'V', language: 'fr', llm, logger: silentLogger,
  });

  assert.ok(!/MODE SÉRIE/.test(calls[0].system));
  assert.ok(!/Partie/.test(calls[0].system));
});
