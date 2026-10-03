import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startServer, createClient, VALID_URL } from './helpers/server.js';

const FAKE_VIDEO = Buffer.alloc(2048, 7);

test('un fichier vidéo accepté devient une source de job', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const client = createClient(ctx.base);

  const upload = await client.postFile('/api/uploads', {
    filename: 'ma-conference.mp4',
    content: FAKE_VIDEO,
  });
  assert.equal(upload.res.status, 201);
  assert.match(upload.body.uploadId, /^[a-f0-9]{32}$/);
  assert.equal(upload.body.filename, 'ma-conference.mp4');
  assert.equal(upload.body.sizeBytes, FAKE_VIDEO.length);

  // Le fichier est bien écrit sur le volume média, sous un nom généré.
  const stored = path.join(ctx.mediaDir, 'uploads', `${upload.body.uploadId}.mp4`);
  assert.equal((await fs.stat(stored)).size, FAKE_VIDEO.length);

  const job = await client.postJson('/api/jobs', { uploadId: upload.body.uploadId, clipCount: 2 });
  assert.equal(job.res.status, 202);

  const queued = ctx.queue.enqueued[0];
  assert.equal(queued.sourceKind, 'upload');
  assert.equal(queued.uploadPath, stored);
  assert.equal(queued.sourceName, 'ma-conference.mp4');
  assert.equal(queued.youtubeUrl, null);

  const detail = await client.json(`/api/jobs/${job.body.jobId}`);
  assert.equal(detail.body.sourceKind, 'upload');
  assert.equal(detail.body.sourceName, 'ma-conference.mp4');
});

test('un même fichier ne sert qu’une fois', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const client = createClient(ctx.base);

  const upload = await client.postFile('/api/uploads', { filename: 'a.mp4', content: FAKE_VIDEO });
  const first = await client.postJson('/api/jobs', { uploadId: upload.body.uploadId });
  assert.equal(first.res.status, 202);

  const second = await client.postJson('/api/jobs', { uploadId: upload.body.uploadId });
  assert.equal(second.res.status, 409);
  assert.equal(second.body.error.code, 'CONFLICT');
});

test('le fichier d’un autre est introuvable, pas « interdit »', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const alice = createClient(ctx.base);
  const mallory = createClient(ctx.base);

  const upload = await alice.postFile('/api/uploads', { filename: 'a.mp4', content: FAKE_VIDEO });
  const stolen = await mallory.postJson('/api/jobs', { uploadId: upload.body.uploadId });

  assert.equal(stolen.res.status, 404);
  assert.equal(stolen.body.error.code, 'UPLOAD_NOT_FOUND');
});

test('les formats non vidéo sont refusés', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const client = createClient(ctx.base);

  for (const filename of ['script.sh', 'photo.png', 'archive.zip', 'sansextension']) {
    const res = await client.postFile('/api/uploads', {
      filename,
      content: FAKE_VIDEO,
      type: 'application/octet-stream',
    });
    assert.equal(res.res.status, 415, `${filename} devrait être refusé`);
    assert.equal(res.body.error.code, 'UNSUPPORTED_FILE');
  }
  const files = await fs.readdir(path.join(ctx.mediaDir, 'uploads')).catch(() => []);
  assert.equal(files.length, 0, 'aucun fichier refusé ne doit rester sur le disque');
});

test('un fichier trop volumineux est refusé et ne laisse rien sur le disque', async (t) => {
  const ctx = await startServer({
    upload: { maxMb: 0.001, allowedExtensions: ['.mp4', '.mov', '.m4v', '.webm', '.mkv'] },
  });
  t.after(() => ctx.close());
  const client = createClient(ctx.base);

  const res = await client.postFile('/api/uploads', {
    filename: 'gros.mp4',
    content: Buffer.alloc(64 * 1024, 1),
  });
  assert.equal(res.res.status, 413);
  assert.equal(res.body.error.code, 'FILE_TOO_LARGE');

  const files = await fs.readdir(path.join(ctx.mediaDir, 'uploads')).catch(() => []);
  assert.deepEqual(files, []);
});

test('un fichier vide est refusé', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const client = createClient(ctx.base);

  const res = await client.postFile('/api/uploads', { filename: 'vide.mp4', content: Buffer.alloc(0) });
  assert.equal(res.res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_FAILED');
});

test('fournir une URL et un fichier en même temps est refusé', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const client = createClient(ctx.base);

  const upload = await client.postFile('/api/uploads', { filename: 'a.mp4', content: FAKE_VIDEO });
  const res = await client.postJson('/api/jobs', {
    youtubeUrl: VALID_URL,
    uploadId: upload.body.uploadId,
  });
  assert.equal(res.res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_FAILED');
});

test('un job sans source est refusé', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const client = createClient(ctx.base);

  const res = await client.postJson('/api/jobs', { clipCount: 3 });
  assert.equal(res.res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_FAILED');
});

test('un fichier de plusieurs mégaoctets passe (la limite JSON ne s’applique pas)', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const client = createClient(ctx.base);

  // 3 Mo : bien au-delà de la limite de corps JSON de l'api (64 Ko).
  const big = Buffer.alloc(3 * 1024 * 1024, 9);
  const res = await client.postFile('/api/uploads', { filename: 'grosse.mov', content: big });

  assert.equal(res.res.status, 201);
  assert.equal(res.body.sizeBytes, big.length);

  const stored = path.join(ctx.mediaDir, 'uploads', `${res.body.uploadId}.mov`);
  assert.equal((await fs.stat(stored)).size, big.length);
});
