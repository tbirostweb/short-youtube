import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWhisperJson, dtwPresetFromModelPath } from '../src/transcribe/whispercpp.js';

test('le préréglage DTW est déduit du nom du modèle', () => {
  assert.equal(dtwPresetFromModelPath('/models/ggml-base.bin'), 'base');
  assert.equal(dtwPresetFromModelPath('/models/ggml-small.en.bin'), 'small.en');
  assert.equal(dtwPresetFromModelPath('/models/ggml-large-v3.bin'), 'large.v3');
  assert.equal(dtwPresetFromModelPath('/models/ggml-base-q5_0.bin'), 'base');
  assert.equal(dtwPresetFromModelPath('/models/modele-perso.bin'), null);
});

test('les tokens whisper.cpp sont recomposés en mots horodatés', () => {
  const json = {
    result: { language: 'fr' },
    transcription: [
      {
        offsets: { from: 0, to: 2000 },
        text: ' Bonjour tout le monde',
        tokens: [
          { text: '[_BEG_]', offsets: { from: 0, to: 0 }, t_dtw: -1 },
          { text: ' Bon', offsets: { from: 0, to: 300 }, t_dtw: 5 },
          { text: 'jour', offsets: { from: 300, to: 500 }, t_dtw: 25 },
          { text: ' tout', offsets: { from: 500, to: 800 }, t_dtw: 52 },
          { text: ' le', offsets: { from: 800, to: 1000 }, t_dtw: 80 },
          { text: ' monde', offsets: { from: 1000, to: 2000 }, t_dtw: 101 },
        ],
      },
    ],
  };

  const { words, language } = normalizeWhisperJson(json);
  assert.equal(language, 'fr');
  assert.deepEqual(words.map((w) => w.text), ['Bonjour', 'tout', 'le', 'monde']);

  // t_dtw est exprimé en unités de 10 ms.
  assert.equal(words[0].start, 0.05);
  assert.equal(words[1].start, 0.52);
  assert.equal(words[3].start, 1.01);

  for (let i = 0; i < words.length; i += 1) {
    assert.ok(words[i].end > words[i].start, 'un mot doit avoir une durée positive');
    if (words[i + 1]) {
      assert.ok(words[i].end <= words[i + 1].start + 1e-9, 'pas de chevauchement entre mots');
    }
  }
});

test('sans tokens, les mots du segment sont répartis uniformément', () => {
  const { words } = normalizeWhisperJson({
    transcription: [{ offsets: { from: 1000, to: 3000 }, text: ' un deux quatre', tokens: [] }],
  });
  assert.deepEqual(words.map((w) => w.text), ['un', 'deux', 'quatre']);
  assert.equal(words[0].start, 1);
  assert.ok(Math.abs(words.at(-1).end - 3) < 1e-6);
});

test('une transcription vide ne casse pas la normalisation', () => {
  assert.deepEqual(normalizeWhisperJson({}), { words: [], language: null, text: '' });
  assert.deepEqual(normalizeWhisperJson(null).words, []);
});

test('la langue détectée est ramenée à un code ISO', async () => {
  const { normalizeLanguage } = await import('../src/transcribe/index.js');

  assert.equal(normalizeLanguage('fr'), 'fr');
  assert.equal(normalizeLanguage('FR'), 'fr');
  // L'API Groq renvoie le nom complet de la langue.
  assert.equal(normalizeLanguage('french'), 'fr');
  assert.equal(normalizeLanguage('English'), 'en');
  assert.equal(normalizeLanguage('português'), 'pt');
  assert.equal(normalizeLanguage('fr-FR'), 'fr');
  assert.equal(normalizeLanguage('en_US'), 'en');
  assert.equal(normalizeLanguage(''), null);
  assert.equal(normalizeLanguage(null), null);
  assert.equal(normalizeLanguage('klingon'), null);
});
