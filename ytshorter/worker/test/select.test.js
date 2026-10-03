import test from 'node:test';
import assert from 'node:assert/strict';
import {
  durationBounds,
  wordsToSegments,
  formatTranscriptLines,
  splitIntoWindows,
  sanitizeSelection,
  transcriptForRange,
} from '../src/steps/select.js';

function makeWords(count, { start = 0, step = 0.4 } = {}) {
  return Array.from({ length: count }, (_, i) => ({
    text: `mot${i}`,
    start: start + i * step,
    end: start + i * step + step * 0.9,
  }));
}

test('les bornes de durée encadrent la durée cible', () => {
  assert.deepEqual(durationBounds(45), { minSeconds: 31, maxSeconds: 61 });
  const short = durationBounds(15);
  assert.ok(short.minSeconds >= 12 && short.maxSeconds > short.minSeconds);
  assert.ok(durationBounds(90).maxSeconds <= 90);
});

test('les mots sont regroupés en segments courts', () => {
  const words = makeWords(60);
  const segments = wordsToSegments(words, { maxSeconds: 5, maxChars: 60 });
  assert.ok(segments.length > 1);
  for (const s of segments) {
    assert.ok(s.end - s.start <= 5.5, 'segment trop long');
    assert.ok(s.text.length <= 70);
  }
});

test('un silence long coupe le segment', () => {
  const words = [
    { text: 'un', start: 0, end: 0.4 },
    { text: 'deux', start: 0.5, end: 0.9 },
    { text: 'trois', start: 5, end: 5.4 },
  ];
  const segments = wordsToSegments(words);
  assert.equal(segments.length, 2);
  assert.equal(segments[1].text, 'trois');
});

test('les lignes de transcription sont au format [début-fin] texte', () => {
  const lines = formatTranscriptLines([{ start: 12.34, end: 18.9, text: 'bonjour à tous' }]);
  assert.equal(lines, '[12.3-18.9] bonjour à tous');
});

test('les fenêtres respectent la taille maximale du prompt', () => {
  const segments = Array.from({ length: 200 }, (_, i) => ({
    start: i * 5,
    end: i * 5 + 5,
    text: 'x'.repeat(100),
  }));
  const windows = splitIntoWindows(segments, 5000);
  assert.ok(windows.length > 1);
  for (const w of windows) {
    const size = w.reduce((acc, s) => acc + s.text.length + 24, 0);
    assert.ok(size <= 5000 + 124, 'fenêtre trop grande');
  }
  assert.equal(windows.flat().length, segments.length, 'aucun segment perdu');
});

test('sanitizeSelection borne, trie, tronque et supprime les chevauchements', () => {
  const words = makeWords(400, { step: 0.5 }); // 0 -> 200 s
  const clips = sanitizeSelection({
    clips: [
      { start: 10, end: 50, score: 60, hook: 'moyen', transcript: 'a' },
      { start: 12, end: 55, score: 95, hook: 'meilleur', transcript: 'b' }, // chevauche
      { start: 100, end: 140, score: 80, hook: 'bon', transcript: 'c' },
      { start: 500, end: 600, score: 99, hook: 'hors bornes', transcript: 'd' },
    ],
    words,
    videoDuration: 200,
    minSeconds: 32,
    maxSeconds: 61,
    clipCount: 3,
  });

  assert.equal(clips.length, 2, 'le chevauchement de moindre score est écarté');
  assert.equal(clips[0].hook, 'meilleur', 'tri par score décroissant');
  for (const clip of clips) {
    assert.ok(clip.start >= 0 && clip.end <= 200, 'bornes dans la vidéo');
    assert.ok(clip.end - clip.start >= 31, 'durée minimale respectée');
    assert.ok(clip.end - clip.start <= 61.5, 'durée maximale respectée');
  }
});

test('sanitizeSelection ignore les extraits inexploitables', () => {
  const words = makeWords(100);
  const clips = sanitizeSelection({
    clips: [
      { start: 'abc', end: 20, score: 90, hook: '', transcript: '' },
      { start: 30, end: 10, score: 90, hook: '', transcript: '' },
      { start: null, end: null, score: 10, hook: '', transcript: '' },
    ],
    words,
    videoDuration: 40,
    minSeconds: 15,
    maxSeconds: 60,
    clipCount: 3,
  });
  assert.equal(clips.length, 0);
});

test('sanitizeSelection tronque au nombre de clips demandé', () => {
  const words = makeWords(1200, { step: 0.5 });
  const raw = Array.from({ length: 10 }, (_, i) => ({
    start: i * 60,
    end: i * 60 + 40,
    score: 50 + i,
    hook: `h${i}`,
    transcript: 't',
  }));
  const clips = sanitizeSelection({
    clips: raw,
    words,
    videoDuration: 600,
    minSeconds: 32,
    maxSeconds: 61,
    clipCount: 3,
  });
  assert.equal(clips.length, 3);
  assert.deepEqual(clips.map((c) => c.hook), ['h9', 'h8', 'h7']);
});

test('la transcription est reconstruite depuis les mots quand elle manque', () => {
  const words = [
    { text: 'bonjour', start: 1, end: 1.5 },
    { text: 'tout', start: 1.6, end: 1.9 },
    { text: 'le', start: 2, end: 2.2 },
    { text: 'monde', start: 2.3, end: 2.8 },
  ];
  assert.equal(transcriptForRange(words, 1.5, 2.5), 'tout le monde');
  const [clip] = sanitizeSelection({
    clips: [{ start: 1, end: 8, score: 10, hook: 'h', transcript: '   ' }],
    words,
    videoDuration: 10,
    minSeconds: 5,
    maxSeconds: 60,
    clipCount: 1,
  });
  assert.match(clip.transcript, /bonjour tout le monde/);
});
