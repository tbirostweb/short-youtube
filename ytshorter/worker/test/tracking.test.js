import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, commandExists } from '../src/lib/exec.js';
import { buildSendcmd, buildTrackingCommands } from '../src/steps/tracking.js';

const FFMPEG = process.env.FFMPEG_BIN || 'ffmpeg';
const PYTHON = process.env.PYTHON_BIN || 'python3';
const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'python',
  'track_crop.py',
);

const hasFfmpeg = await commandExists(FFMPEG, ['-version']);
const hasOpenCv = await run(PYTHON, ['-c', 'import cv2, numpy'], { timeoutMs: 30000 })
  .then(() => true)
  .catch(() => false);

const skip = !hasFfmpeg
  ? 'ffmpeg absent de cette machine'
  : !hasOpenCv
    ? `OpenCV absent pour ${PYTHON} (PYTHON_BIN=/chemin/vers/python pour le tester)`
    : false;

/** Vidéo synthétique : un carré clair qui se déplace selon `xExpr`. */
async function makeMovingBox(dir, name, { xExpr, seconds = 4, bg = 'black' }) {
  const file = path.join(dir, name);
  await run(
    FFMPEG,
    [
      '-y',
      '-f', 'lavfi', '-i', `color=c=${bg}:s=640x360:r=25`,
      '-f', 'lavfi', '-i', 'color=c=white:s=140x140:r=25',
      '-filter_complex', `[0][1]overlay=x='${xExpr}':y=110`,
      '-t', String(seconds),
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      file,
    ],
    { timeoutMs: 120000 },
  );
  return file;
}

async function track(videoPath, dir, extraArgs = []) {
  const out = path.join(dir, 'track.json');
  await run(PYTHON, [SCRIPT, '--input', videoPath, '--output', out, '--sample-fps', '5', ...extraArgs], {
    timeoutMs: 300000,
  });
  return JSON.parse(await fs.readFile(out, 'utf8'));
}

test('le suivi accompagne un sujet qui traverse l’image', { skip }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ytsh-track-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  // Le carré part à gauche (x=20) et finit à droite (x=460) en 4 secondes.
  const video = await makeMovingBox(dir, 'pan.mp4', { xExpr: '20+t*110' });
  const data = await track(video, dir);

  assert.equal(data.width, 640);
  assert.ok(data.keyframes.length >= 15, `trop peu de positions : ${data.keyframes.length}`);
  assert.ok(data.usable_ratio > 0.5, `sujet rarement trouvé : ${data.usable_ratio}`);

  const positions = data.keyframes.map((k) => k.cx);
  const lowest = Math.min(...positions);
  const last = positions.at(-1);
  // Le sujet part à gauche puis finit à droite : le cadre doit faire le trajet.
  assert.ok(lowest < 260, `le cadre n’est jamais allé chercher le sujet à gauche : ${lowest}`);
  assert.ok(last > 420, `le cadre devrait finir à droite avec le sujet : ${last}`);
  assert.ok(data.travel > 200, `déplacement cumulé trop faible : ${data.travel}`);

  // Le mouvement doit rester régulier : aucun saut brutal entre deux positions.
  const maxSpeed = 0.35 * 640 / 5; // --max-speed par défaut, à 5 images/s
  for (let i = 1; i < data.keyframes.length; i += 1) {
    const jump = Math.abs(data.keyframes[i].cx - data.keyframes[i - 1].cx);
    assert.ok(jump <= maxSpeed + 1, `saut de ${jump.toFixed(1)} px entre deux positions`);
  }
});

test('un sujet immobile ne fait pas trembler le cadre', { skip }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ytsh-track-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const video = await makeMovingBox(dir, 'fixe.mp4', { xExpr: '250' });
  const data = await track(video, dir);

  const positions = data.keyframes.map((k) => k.cx);
  const spread = Math.max(...positions) - Math.min(...positions);
  assert.ok(spread < 40, `le cadre bouge de ${spread.toFixed(1)} px sur un plan fixe`);
  assert.ok(data.travel < 60, `déplacement cumulé trop élevé : ${data.travel}`);
});

test('une coupe de plan replace le cadre immédiatement', { skip }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ytsh-track-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  // Deux plans très différents, collés : sujet à gauche puis à droite.
  const a = await makeMovingBox(dir, 'a.mp4', { xExpr: '40', seconds: 2, bg: 'black' });
  const b = await makeMovingBox(dir, 'b.mp4', { xExpr: '460', seconds: 2, bg: 'navy' });
  const list = path.join(dir, 'list.txt');
  await fs.writeFile(list, `file '${a}'\nfile '${b}'\n`);
  const joined = path.join(dir, 'coupe.mp4');
  await run(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined], {
    timeoutMs: 120000,
  });

  const data = await track(joined, dir);
  assert.ok(data.shots >= 2, `la coupe n’a pas été détectée (${data.shots} plan)`);

  // Après la coupe (2 s), le cadre doit être à droite très vite : un
  // repositionnement instantané, pas un panoramique de deux secondes.
  const justAfter = data.keyframes.find((k) => k.t >= 2.0 && k.t <= 2.5);
  assert.ok(justAfter, 'aucune position juste après la coupe');
  assert.ok(
    justAfter.cx > 350,
    `le cadre traîne encore à ${justAfter.cx} px après la coupe`,
  );
});

test('sans sujet identifiable, le cadre ne suit pas le bruit', { skip }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ytsh-track-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const video = path.join(dir, 'bruit.mp4');
  await run(
    FFMPEG,
    [
      '-y', '-f', 'lavfi', '-i', 'nullsrc=s=640x360:r=25',
      '-vf', 'geq=random(1)*255:128:128', '-t', '3',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', video,
    ],
    { timeoutMs: 180000 },
  );

  const data = await track(video, dir);
  // Sur du bruit uniforme, l'énergie n'est pas concentrée : rien à suivre.
  assert.ok(
    data.usable_ratio < 0.5,
    `le bruit a été pris pour un sujet (${data.usable_ratio})`,
  );
  const positions = data.keyframes.map((k) => k.cx);
  const spread = Math.max(...positions) - Math.min(...positions);
  assert.ok(spread < 80, `le cadre erre de ${spread.toFixed(1)} px sur du bruit`);
});

test('l’intégration Node produit un fichier de commandes exploitable', { skip }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ytsh-track-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const video = await makeMovingBox(dir, 'clip_00.mp4', { xExpr: '20+t*110' });
  const name = await buildTrackingCommands({
    videoPath: video,
    workDir: dir,
    name: 'clip_00',
    config: { python: PYTHON, trackingCrop: true },
  });

  assert.equal(name, 'clip_00.sendcmd');
  const content = await fs.readFile(path.join(dir, name), 'utf8');
  const lines = content.trim().split('\n');
  assert.ok(lines.length > 10);
  for (const line of lines) {
    assert.match(line, /^\d+\.\d{3}-\d+\.\d{3} \[enter\] crop@dyn x \d+;$/);
  }
  // Le fichier de suivi intermédiaire est nettoyé.
  const left = await fs.readdir(dir);
  assert.ok(!left.includes('clip_00.track.json'));
});

test('un suivi inutilisable est écarté au profit du recadrage centré', { skip }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ytsh-track-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  // Image quasi vide : aucun sujet, aucune raison de piloter le cadre.
  const video = path.join(dir, 'vide.mp4');
  await run(
    FFMPEG,
    ['-y', '-f', 'lavfi', '-i', 'color=c=gray:s=640x360:r=25', '-t', '2',
     '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', video],
    { timeoutMs: 120000 },
  );

  const name = await buildTrackingCommands({
    videoPath: video,
    workDir: dir,
    name: 'clip_00',
    config: { python: PYTHON, trackingCrop: true },
  });
  assert.equal(name, null, 'le suivi devrait être écarté');
});

test('un script ou un interpréteur absent ne casse pas le rendu', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ytsh-track-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const name = await buildTrackingCommands({
    videoPath: path.join(dir, 'inexistant.mp4'),
    workDir: dir,
    name: 'clip_00',
    config: { python: '/interpreteur/qui/nexiste/pas', trackingCrop: true },
  });
  assert.equal(name, null, 'le repli centré doit être silencieux et sans erreur');
});

test('les commandes de suivi restent dans les limites de l’image', () => {
  const cmd = buildSendcmd(
    [
      { t: 0, cx: 0 },
      { t: 0.2, cx: 960 },
      { t: 0.4, cx: 1920 },
    ],
    { width: 1920, height: 1080, step: 0.2 },
  );
  const lines = cmd.trim().split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^0\.000-0\.200 \[enter\] crop@dyn x 0;$/);
  assert.match(lines[1], /crop@dyn x 656;$/);
  assert.match(lines[2], /crop@dyn x 1313;$/);
});
