import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cleanIntermediates, removeJobDir } from '../src/steps/cleanup.js';

const FILES = [
  'source.mp4',
  'source.mkv',
  'cut_00.mp4',
  'cut_01.mp4',
  'clip_00.mp4',
  'clip_00.ass',
  'clip_00.sendcmd',
  'transcript.json',
  'words.json',
  'audio16k.wav',
];

async function makeJobDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ytsh-clean-'));
  for (const name of FILES) await fs.writeFile(path.join(dir, name), 'x');
  return dir;
}

test('le nettoyage retire les intermédiaires et garde les livrables', async (t) => {
  const dir = await makeJobDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  await cleanIntermediates(dir);
  const left = (await fs.readdir(dir)).sort();

  assert.deepEqual(left, ['clip_00.ass', 'clip_00.mp4', 'words.json']);
});

test('avec keepCuts, les découpes survivent pour la re-stylisation', async (t) => {
  const dir = await makeJobDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  await cleanIntermediates(dir, { keepCuts: true });
  const left = (await fs.readdir(dir)).sort();

  assert.deepEqual(left, ['clip_00.ass', 'clip_00.mp4', 'cut_00.mp4', 'cut_01.mp4', 'words.json']);
  assert.ok(!left.includes('source.mp4'), 'la source doit toujours partir');
});

test('KEEP_INTERMEDIATES conserve tout', async (t) => {
  const dir = await makeJobDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  await cleanIntermediates(dir, { keep: true });
  assert.equal((await fs.readdir(dir)).length, FILES.length);
});

test('un job en échec voit son dossier entier disparaître', async (t) => {
  const dir = await makeJobDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  await removeJobDir(dir);
  await assert.rejects(() => fs.stat(dir));
});

test('nettoyer un dossier inexistant ne lève pas', async () => {
  await cleanIntermediates('/chemin/qui/nexiste/pas');
  await removeJobDir('/chemin/qui/nexiste/pas');
});
