import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAss,
  groupWordsIntoCards,
  formatAssTime,
  escapeAssText,
  CAPTION_PRESETS,
  NO_CAPTIONS,
} from '../src/lib/ass.js';

const words = [
  { text: 'Voici', start: 10.0, end: 10.4 },
  { text: 'la', start: 10.4, end: 10.55 },
  { text: 'chose', start: 10.55, end: 11.0 },
  { text: 'la', start: 11.0, end: 11.15 },
  { text: 'plus', start: 11.15, end: 11.4 },
  { text: 'importante', start: 11.4, end: 12.2 },
  // silence d'une seconde : nouvelle carte attendue
  { text: 'Écoutez', start: 13.2, end: 13.9 },
  { text: 'bien', start: 13.9, end: 14.3 },
];

test('formatAssTime respecte le format H:MM:SS.CC', () => {
  assert.equal(formatAssTime(0), '0:00:00.00');
  assert.equal(formatAssTime(3.456), '0:00:03.46');
  assert.equal(formatAssTime(61.5), '0:01:01.50');
  assert.equal(formatAssTime(3725.25), '1:02:05.25');
  assert.equal(formatAssTime(-5), '0:00:00.00');
});

test('escapeAssText neutralise les caractères de balisage', () => {
  assert.equal(escapeAssText('a{b}c'), 'a(b)c');
  assert.equal(escapeAssText('back\\slash'), 'back\\\\slash');
  assert.equal(escapeAssText(' multi\nligne '), 'multi ligne');
});

test('les mots sont regroupés en cartes, coupées sur les silences', () => {
  const cards = groupWordsIntoCards(words, CAPTION_PRESETS.punch);
  assert.ok(cards.length >= 2, 'un silence long doit créer une nouvelle carte');
  const last = cards.at(-1);
  assert.equal(last.words[0].text, 'ÉCOUTEZ', 'le préréglage punch met en majuscules');
});

test('buildAss produit un fichier ASS karaoké valide et recalé sur le clip', () => {
  const ass = buildAss({ words, clipStart: 10, clipEnd: 15, style: 'punch' });

  assert.match(ass, /^\[Script Info\]/);
  assert.match(ass, /PlayResX: 1080/);
  assert.match(ass, /PlayResY: 1920/);
  assert.match(ass, /^Style: Karaoke,DejaVu Sans,92,/m);
  assert.match(ass, /^\[Events\]/m);

  const dialogues = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
  assert.ok(dialogues.length >= 2);

  // Le temps est local au clip : le premier mot commence à 0.
  assert.match(dialogues[0], /^Dialogue: 0,0:00:00\.00,/);
  // Chaque mot porte une balise de karaoké \k en centisecondes.
  assert.match(dialogues[0], /\{\\k\d+\}VOICI/);
  const tags = dialogues[0].match(/\\k(\d+)/g) ?? [];
  assert.ok(tags.length >= 3, 'chaque mot doit avoir sa propre balise \\k');
});

test('les mots hors du clip sont ignorés', () => {
  const ass = buildAss({ words, clipStart: 13, clipEnd: 15, style: 'clean' });
  assert.ok(!ass.includes('Voici'), 'les mots antérieurs au clip ne doivent pas apparaître');
  assert.ok(ass.includes('Écoutez'), 'le préréglage clean conserve la casse');
});

test('une transcription vide produit un fichier sans dialogue mais valide', () => {
  const ass = buildAss({ words: [], clipStart: 0, clipEnd: 10, style: 'boxed' });
  assert.match(ass, /\[Events\]/);
  assert.equal(ass.split('\n').filter((l) => l.startsWith('Dialogue:')).length, 0);
});

test('les trois préréglages sont utilisables', () => {
  for (const style of Object.keys(CAPTION_PRESETS)) {
    const ass = buildAss({ words, clipStart: 10, clipEnd: 15, style });
    assert.match(ass, /^Style: Karaoke,/m, `préréglage ${style}`);
  }
});

test('l’accroche est incrustée en bandeau sur les premières secondes', () => {
  const ass = buildAss({
    words,
    clipStart: 10,
    clipEnd: 15,
    style: 'punch',
    hook: 'Le détail que personne ne remarque',
  });

  const dialogues = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
  const hook = dialogues[0];

  assert.match(ass, /^Style: Hook,/m, 'un style distinct des sous-titres');
  assert.match(hook, /^Dialogue: 1,0:00:00\.00,0:00:02\.40,Hook,/, 'affichée dès la première image');
  assert.match(hook, /\{\\fad\(220,320\)\}/, 'apparition et disparition en fondu');
  assert.match(hook, /Le détail que personne ne/);
  // Le karaoké reste présent et indépendant.
  assert.ok(dialogues.slice(1).every((d) => d.includes(',Karaoke,')));
});

test('sans accroche demandée, aucun bandeau n’est ajouté', () => {
  const ass = buildAss({ words, clipStart: 10, clipEnd: 15, style: 'punch' });
  assert.ok(!ass.split('\n').some((l) => l.startsWith('Dialogue: 1,')));

  const vide = buildAss({ words, clipStart: 10, clipEnd: 15, style: 'punch', hook: '   ' });
  assert.ok(!vide.split('\n').some((l) => l.startsWith('Dialogue: 1,')));
});

test('une accroche trop longue est coupée sur un mot entier', () => {
  const long = 'Cette accroche est délibérément beaucoup trop longue pour tenir dans le bandeau prévu à cet effet en haut du clip';
  const ass = buildAss({ words, clipStart: 10, clipEnd: 15, style: 'punch', hook: long });
  const hook = ass.split('\n').find((l) => l.startsWith('Dialogue: 1,'));

  const text = hook.split(',,0,0,0,,')[1].replace('{\\fad(220,320)}', '');
  const lines = text.split('\\N');
  assert.ok(lines.length <= 3, `trop de lignes : ${lines.length}`);
  for (const line of lines) {
    assert.ok(line.length <= 26, `ligne trop longue : « ${line} »`);
    assert.ok(!line.endsWith(' '));
  }
  // Aucun mot n'est coupé en deux.
  assert.ok(long.includes(lines[0]), 'la première ligne doit être un préfixe exact');
});

test('l’accroche ne dépasse jamais la durée du clip', () => {
  const ass = buildAss({
    words: [{ text: 'court', start: 0, end: 0.5 }],
    clipStart: 0,
    clipEnd: 1.5,
    style: 'punch',
    hook: 'Accroche',
    hookSeconds: 5,
  });
  const hook = ass.split('\n').find((l) => l.startsWith('Dialogue: 1,'));
  assert.match(hook, /,0:00:01\.50,/, "l'accroche s'arrête avec le clip");
});

test('le style « aucun » n’est pas un préréglage de rendu', () => {
  // 'none' est traité en amont (aucun fichier ASS n'est produit) : il ne doit
  // pas se retrouver dans la table des préréglages.
  assert.equal(CAPTION_PRESETS.none, undefined);
  assert.equal(NO_CAPTIONS, 'none');
});
