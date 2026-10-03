import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeHashtags,
  ensureShortsTag,
  clampTitle,
  normalizeMetadata,
} from '../src/steps/metadata.js';

test('les hashtags sont normalisés, dédoublonnés et plafonnés', () => {
  assert.deepEqual(
    normalizeHashtags(['#Sport', 'sport', '  #Vélo de route ', '###fitness', '', '!!!', '#Été2024']),
    ['#Sport', '#Véloderoute', '#fitness', '#Été2024'],
  );
  assert.deepEqual(normalizeHashtags(null), []);
  assert.equal(normalizeHashtags(Array.from({ length: 20 }, (_, i) => `#t${i}`)).length, 8);
});

test('le titre YouTube contient #Shorts et tient en 100 caractères', () => {
  assert.equal(ensureShortsTag('Un titre simple'), 'Un titre simple #Shorts');
  assert.equal(ensureShortsTag('Déjà taggé #shorts ici'), 'Déjà taggé #shorts ici');

  const long = 'a'.repeat(150);
  const result = ensureShortsTag(long);
  assert.ok(result.length <= 100, `longueur ${result.length}`);
  assert.match(result, /#Shorts$/);
});

test('clampTitle ne coupe pas au milieu d’un mot', () => {
  const title = clampTitle('les grandes idees ne meurent jamais vraiment ici', 30);
  assert.ok(title.length <= 30);
  assert.ok(!title.endsWith(' '));
  assert.equal(title, 'les grandes idees ne meurent');
});

test('normalizeMetadata met en forme la sortie du LLM', () => {
  const out = normalizeMetadata({
    youtube_shorts: {
      title: '  Le secret des marathoniens  ',
      description: ' Deux lignes\nde description ',
      hashtags: ['#course', 'course', '#marathon'],
    },
    tiktok: {
      caption: '  Une légende '.repeat(30),
      hashtags: ['#fyp', '#pourtoi', '#running'],
    },
  });

  assert.equal(out.ytTitle, 'Le secret des marathoniens #Shorts');
  assert.equal(out.ytDescription, 'Deux lignes\nde description');
  assert.deepEqual(out.ytHashtags, ['#course', '#marathon']);
  assert.ok(out.tiktokCaption.length <= 150);
  assert.deepEqual(out.tiktokHashtags, ['#fyp', '#pourtoi', '#running']);
});
