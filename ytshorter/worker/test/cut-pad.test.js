import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run, commandExists } from '../src/lib/exec.js';
import { probe } from '../src/lib/ffmpeg.js';
import { cutClips, renderClips } from '../src/steps/render.js';

const FFMPEG = process.env.FFMPEG_BIN || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_BIN || 'ffprobe';
const hasFfmpeg = await commandExists(FFMPEG, ['-version']);
const skip = hasFfmpeg ? false : 'ffmpeg absent de cette machine';

// Le rendu incruste toujours les sous-titres : sans libass, il n'y a rien à
// vérifier. Le test s'ignore alors plutôt que d'être simulé.
const hasAssFilter = hasFfmpeg
  ? await run(FFMPEG, ['-hide_banner', '-filters'], { timeoutMs: 30000 })
      .then(({ stdout }) => /^\s*\S+\s+ass\s/m.test(stdout))
      .catch(() => false)
  : false;
const renderSkip = skip || (hasAssFilter ? false : 'ffmpeg local compilé sans libass');

const config = {
  ffmpeg: FFMPEG,
  ffprobe: FFPROBE,
  trackingCrop: false,
  cutPadSeconds: 2,
  render: { normalizeAudio: false, fadeOutSeconds: 0 },
};

async function makeSource(dir, seconds = 20) {
  const file = path.join(dir, 'source.mp4');
  await run(
    FFMPEG,
    [
      '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25',
      '-f', 'lavfi', '-i', 'sine=frequency=440',
      '-t', String(seconds),
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
      file,
    ],
    { timeoutMs: 180000 },
  );
  return file;
}

test('la découpe conserve une marge de part et d’autre', { skip }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ytsh-pad-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const source = await makeSource(dir);
  const cuts = await cutClips({
    clips: [
      { start: 6, end: 12, score: 90, hook: 'a' },
      // Extrait collé au début : la marge avant est limitée par la source.
      { start: 0.5, end: 5, score: 80, hook: 'b' },
      // Extrait collé à la fin : la marge après l'est aussi.
      { start: 15, end: 19.5, score: 70, hook: 'c' },
    ],
    sourcePath: source,
    jobDir: dir,
    sourceDuration: 20,
    config,
  });

  assert.deepEqual(
    cuts.map((c) => [c.padStart, c.padEnd]),
    [
      [2, 2],
      [0.5, 2],
      [2, 0.5],
    ],
    'la marge ne peut pas dépasser les bornes de la source',
  );

  // Le fichier de découpe dure bien clip + marges.
  const first = await probe(cuts[0].cutPath, config);
  assert.ok(Math.abs(first.duration - 10) < 0.3, `durée de découpe : ${first.duration}`);
});

test('le clip rendu a la durée demandée malgré la marge', { skip: renderSkip }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ytsh-pad-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const source = await makeSource(dir);
  const cuts = await cutClips({
    clips: [{ start: 6, end: 12, score: 90, hook: 'Accroche' }],
    sourcePath: source,
    jobDir: dir,
    sourceDuration: 20,
    config,
  });

  const [clip] = await renderClips({
    cuts,
    jobDir: dir,
    words: [{ text: 'Bonjour', start: 6.2, end: 7.0 }],
    captionStyle: 'punch',
    focusX: 0.5,
    layout: 'crop',
    config,
  });

  // La marge sert à l'ajustement ultérieur : elle ne doit pas se retrouver
  // dans le clip livré.
  assert.ok(Math.abs(clip.duration - 6) < 0.3, `durée du clip livré : ${clip.duration}`);
  assert.equal(clip.width, 1080);
  assert.equal(clip.height, 1920);

  // Les lignes incrustées sont enregistrées pour permettre leur correction.
  const lines = JSON.parse(await fs.readFile(path.join(dir, 'clip_00.lines.json'), 'utf8'));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, 'Bonjour');
  // Temps absolus : ils survivent à un déplacement des bornes.
  assert.ok(lines[0].start >= 6 && lines[0].end <= 12, `hors du clip : ${JSON.stringify(lines[0])}`);
});

test('sans marge configurée, la découpe reste exacte', { skip }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ytsh-pad-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const source = await makeSource(dir, 12);
  const cuts = await cutClips({
    clips: [{ start: 4, end: 9, score: 90, hook: 'a' }],
    sourcePath: source,
    jobDir: dir,
    sourceDuration: 12,
    config: { ...config, cutPadSeconds: 0 },
  });

  assert.deepEqual([cuts[0].padStart, cuts[0].padEnd], [0, 0]);
  const info = await probe(cuts[0].cutPath, config);
  assert.ok(Math.abs(info.duration - 5) < 0.2);
});

test('sans sous-titres, aucun fichier ASS n’est produit', { skip }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ytsh-nosub-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const source = await makeSource(dir, 12);
  const cuts = await cutClips({
    clips: [{ start: 2, end: 8, score: 90, hook: 'Accroche' }],
    sourcePath: source,
    jobDir: dir,
    sourceDuration: 12,
    config,
  });

  const [clip] = await renderClips({
    cuts,
    jobDir: dir,
    words: [{ text: 'Bonjour', start: 2.2, end: 3.0 }],
    captionStyle: 'none',
    focusX: 0.5,
    layout: 'crop',
    hookOverlay: false,
    config,
  });

  // Le clip est bien rendu, mais sans incrustation.
  assert.equal(clip.width, 1080);
  assert.equal(clip.height, 1920);
  const files = await fs.readdir(dir);
  assert.ok(!files.includes('clip_00.ass'), `un ASS a été écrit : ${files}`);

  // Les lignes restent enregistrées : l'export SRT doit rester possible.
  assert.ok(files.includes('clip_00.lines.json'));
  const lines = JSON.parse(await fs.readFile(path.join(dir, 'clip_00.lines.json'), 'utf8'));
  assert.equal(lines[0].text, 'Bonjour');
});
