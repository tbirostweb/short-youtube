import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run, commandExists } from '../src/lib/exec.js';
import { useUploadedSource, resolveSource } from '../src/steps/source.js';
import { CODES } from '../src/lib/errors.js';

const FFMPEG = process.env.FFMPEG_BIN || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_BIN || 'ffprobe';
const hasFfmpeg = await commandExists(FFMPEG, ['-version']);
const skip = hasFfmpeg ? false : 'ffmpeg absent de cette machine';

const config = (dir) => ({
  mediaDir: dir,
  ffmpeg: FFMPEG,
  ffprobe: FFPROBE,
  maxVideoMinutes: 90,
});

async function makeUpload(dir, { withAudio = true, seconds = 3, extension = '.mp4' } = {}) {
  const file = path.join(dir, `envoi${extension}`);
  const args = ['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=15'];
  if (withAudio) args.push('-f', 'lavfi', '-i', 'sine=frequency=440');
  args.push('-t', String(seconds), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p');
  if (withAudio) args.push('-c:a', 'aac');
  args.push(file);
  await run(FFMPEG, args, { timeoutMs: 120000 });
  return file;
}

test('un fichier envoyé devient la source du job', { skip }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ytsh-source-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const jobDir = path.join(dir, '7');
  await fs.mkdir(jobDir, { recursive: true });
  const uploadPath = await makeUpload(dir);

  const source = await useUploadedSource({
    uploadPath,
    sourceName: 'Ma conférence 2024.mp4',
    jobDir,
    config: config(dir),
  });

  assert.equal(source.sourcePath, path.join(jobDir, 'source.mp4'));
  assert.ok(await fs.stat(source.sourcePath));
  // Le fichier est déplacé, pas dupliqué : le volume ne double pas.
  await assert.rejects(() => fs.stat(uploadPath));
  // Le nom du fichier sert de titre, sans son extension.
  assert.equal(source.title, 'Ma conférence 2024');
  assert.ok(Math.abs(source.duration - 3) < 0.3);
  assert.equal(source.width, 320);
});

test('resolveSource route selon le type de source', { skip }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ytsh-source-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const jobDir = path.join(dir, '8');
  await fs.mkdir(jobDir, { recursive: true });
  const uploadPath = await makeUpload(dir, { extension: '.mkv' });

  const source = await resolveSource({
    job: { sourceKind: 'upload', uploadPath, sourceName: 'clip.mkv' },
    jobDir,
    config: config(dir),
  });
  assert.equal(path.extname(source.sourcePath), '.mkv', 'l’extension d’origine est conservée');
});

test('une source YouTube invalide est refusée avant tout appel à yt-dlp', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ytsh-source-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  await assert.rejects(
    () =>
      resolveSource({
        job: { sourceKind: 'youtube', youtubeUrl: 'https://evil.example/watch?v=dQw4w9WgXcQ' },
        jobDir: dir,
        config: { ...config(dir), ytDlp: '/bin/false' },
      }),
    (err) => err.code === CODES.INVALID_URL,
  );
});

test('un fichier sans piste audio remonte NO_SPEECH', { skip }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ytsh-source-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const jobDir = path.join(dir, '9');
  await fs.mkdir(jobDir, { recursive: true });
  const uploadPath = await makeUpload(dir, { withAudio: false });

  await assert.rejects(
    () => useUploadedSource({ uploadPath, sourceName: 'muet.mp4', jobDir, config: config(dir) }),
    (err) => err.code === CODES.NO_SPEECH,
  );
});

test('une vidéo plus longue que la limite remonte VIDEO_TOO_LONG', { skip }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ytsh-source-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const jobDir = path.join(dir, '10');
  await fs.mkdir(jobDir, { recursive: true });
  const uploadPath = await makeUpload(dir, { seconds: 5 });

  await assert.rejects(
    () =>
      useUploadedSource({
        uploadPath,
        sourceName: 'longue.mp4',
        jobDir,
        // 0,05 minute = 3 secondes : la vidéo de 5 s dépasse.
        config: { ...config(dir), maxVideoMinutes: 0.05 },
      }),
    (err) => err.code === CODES.VIDEO_TOO_LONG,
  );
});

test('un fichier envoyé disparu est signalé clairement', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ytsh-source-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  await assert.rejects(
    () =>
      useUploadedSource({
        uploadPath: path.join(dir, 'absent.mp4'),
        sourceName: 'absent.mp4',
        jobDir: dir,
        config: config(dir),
      }),
    (err) => err.code === CODES.DOWNLOAD_FAILED && /expiré|nettoyé/.test(err.message),
  );
});
