import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYoutubeUrl } from '../src/lib/youtube.js';
import { createProgressReporter, STEPS } from '../src/lib/progress.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test('la validation d’URL du worker se comporte comme celle de l’api', () => {
  assert.equal(parseYoutubeUrl('https://youtu.be/dQw4w9WgXcQ').id, 'dQw4w9WgXcQ');
  assert.equal(parseYoutubeUrl('https://example.com/watch?v=dQw4w9WgXcQ'), null);
});

test('les deux copies du module youtube.js restent identiques', async () => {
  const workerCopy = await fs.readFile(path.join(here, '..', 'src', 'lib', 'youtube.js'), 'utf8');
  const apiCopy = await fs.readFile(
    path.join(here, '..', '..', 'api', 'src', 'lib', 'youtube.js'),
    'utf8',
  );
  // Seule la ligne de commentaire qui désigne l'autre copie peut différer.
  const strip = (text) => text.replace(/^\/\/ Ce module est dupliqué.*$\n^\/\/ pour.*$\n/ms, '');
  assert.equal(strip(workerCopy), strip(apiCopy), 'les copies ont divergé : resynchronisez-les');
});

test('les paliers de progression couvrent 0 à 100 sans trou ni recul', () => {
  assert.equal(STEPS[0].from, 2);
  assert.equal(STEPS.at(-1).to, 100);
  for (let i = 1; i < STEPS.length; i += 1) {
    assert.equal(STEPS[i].from, STEPS[i - 1].to, `palier ${STEPS[i].key} discontinu`);
    assert.ok(STEPS[i].to > STEPS[i].from);
  }
});

test('le rapporteur de progression n’émet jamais de recul et publie l’état final', async () => {
  const published = [];
  const written = [];
  const reporter = createProgressReporter({
    db: {
      async updateProgress(id, payload) {
        written.push(payload);
      },
      async setDone() {
        written.push({ status: 'done' });
      },
      async setError(id, payload) {
        written.push(payload);
      },
    },
    publisher: {
      async publish(channel, payload) {
        published.push(JSON.parse(payload));
      },
    },
    jobId: '42',
  });

  await reporter.step('download', 0);
  await reporter.step('download', 0.5);
  await reporter.step('download', 0.5); // doublon : ignoré
  await reporter.step('download', 0.2); // recul : ignoré
  await reporter.step('transcribe', 0);
  await reporter.step('render', 1);
  await reporter.done();

  const values = published.map((p) => p.progress);
  for (let i = 1; i < values.length; i += 1) {
    assert.ok(values[i] >= values[i - 1], 'progression non monotone');
  }
  assert.deepEqual(values, [2, 11, 20, 90, 100]);
  assert.equal(published.at(-1).status, 'done');

  await reporter.error({ code: 'NO_SPEECH', message: 'Aucune parole', step: 'transcribe' });
  assert.equal(published.at(-1).status, 'error');
  assert.equal(published.at(-1).error.code, 'NO_SPEECH');
});
