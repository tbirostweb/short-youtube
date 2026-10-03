import test from 'node:test';
import assert from 'node:assert/strict';
import { mapWithConcurrency } from '../src/lib/async.js';

test('les résultats gardent l’ordre d’entrée', async () => {
  const res = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => n * 10);
  assert.deepEqual(res, [10, 20, 30, 40, 50]);
});

test('la concurrence ne dépasse jamais la limite', async () => {
  let active = 0;
  let max = 0;
  await mapWithConcurrency(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
    active += 1;
    max = Math.max(max, active);
    await new Promise((r) => setTimeout(r, 5));
    active -= 1;
  });
  assert.ok(max <= 3, `concurrence observée ${max}`);
  assert.ok(max >= 2, 'la parallélisation devrait être effective');
});

test('une liste vide ne fait rien', async () => {
  assert.deepEqual(await mapWithConcurrency([], 3, async () => 1), []);
});

test('une limite supérieure au nombre d’éléments est bornée', async () => {
  const res = await mapWithConcurrency([1, 2], 100, async (n) => n);
  assert.deepEqual(res, [1, 2]);
});

test('une erreur dans une tâche se propage', async () => {
  await assert.rejects(
    () => mapWithConcurrency([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('boom');
      return n;
    }),
    /boom/,
  );
});
