import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startServer, createClient, VALID_URL } from './helpers/server.js';

async function seedJobWithClips(ctx, client, { count = 2, series = false } = {}) {
  const { body } = await client.postJson('/api/jobs', { youtubeUrl: VALID_URL, seriesMode: series });
  const jobId = body.jobId;
  const job = ctx.store.jobs.get(jobId);
  job.status = 'done';
  job.sourceTitle = 'Ma vidéo source';
  job.seriesMode = series;

  const dir = path.join(ctx.mediaDir, jobId);
  await fs.mkdir(dir, { recursive: true });

  const clipIds = [];
  for (let i = 0; i < count; i += 1) {
    const file = path.join(dir, `clip_0${i}.mp4`);
    await fs.writeFile(file, `video-${i}`.repeat(50));
    clipIds.push(
      ctx.store.addClip({
        jobId,
        idx: i,
        startSeconds: i * 60,
        endSeconds: i * 60 + 40,
        duration: 40,
        score: 90 - i,
        hook: `Accroche ${i + 1}`,
        filePath: file,
        ytTitle: `Titre ${i + 1} #Shorts`,
        ytDescription: `Description ${i + 1}`,
        ytHashtags: ['#Shorts', '#test'],
        tiktokCaption: `Légende ${i + 1}`,
        tiktokHashtags: ['#fyp'],
      }),
    );
  }
  return { jobId, clipIds, dir };
}

test('un clip peut être marqué publié par plateforme', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const client = createClient(ctx.base);
  const { jobId, clipIds } = await seedJobWithClips(ctx, client);

  const before = await client.json(`/api/jobs/${jobId}`);
  assert.deepEqual(before.body.clips[0].published, { youtube: false, tiktok: false });

  const res = await client.postJson(`/api/clips/${clipIds[0]}/published`, { platform: 'youtube' });
  assert.equal(res.res.status, 200);
  assert.equal(res.body.published, true);

  const after = await client.json(`/api/jobs/${jobId}`);
  assert.deepEqual(after.body.clips[0].published, { youtube: true, tiktok: false });
  assert.deepEqual(after.body.clips[1].published, { youtube: false, tiktok: false });

  // On peut revenir en arrière (publication annulée, erreur de manipulation).
  await client.postJson(`/api/clips/${clipIds[0]}/published`, {
    platform: 'youtube',
    published: false,
  });
  const undone = await client.json(`/api/jobs/${jobId}`);
  assert.equal(undone.body.clips[0].published.youtube, false);
});

test('une plateforme inconnue est refusée', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const client = createClient(ctx.base);
  const { clipIds } = await seedJobWithClips(ctx, client, { count: 1 });

  const res = await client.postJson(`/api/clips/${clipIds[0]}/published`, { platform: 'instagram' });
  assert.equal(res.res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_FAILED');
});

test('on ne marque pas publié le clip d’un autre', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const alice = createClient(ctx.base);
  const mallory = createClient(ctx.base);
  const { clipIds } = await seedJobWithClips(ctx, alice, { count: 1 });

  const res = await mallory.postJson(`/api/clips/${clipIds[0]}/published`, { platform: 'tiktok' });
  assert.equal(res.res.status, 403);
});

test('l’archive regroupe tous les clips et un mémo de publication', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const client = createClient(ctx.base);
  const { jobId } = await seedJobWithClips(ctx, client, { count: 3, series: true });

  const res = await client.fetch(`/api/jobs/${jobId}/clips.zip`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/zip');
  assert.match(res.headers.get('content-disposition'), /clips-job-\d+\.zip/);

  const buffer = Buffer.from(await res.arrayBuffer());
  // Signature ZIP : "PK\x03\x04"
  assert.equal(buffer.subarray(0, 4).toString('hex'), '504b0304');

  // Les noms de fichiers apparaissent en clair dans les en-têtes ZIP.
  // Le mémo est stocké sans compression : on le relit en UTF-8 pour que les
  // accents soient comparables.
  const raw = buffer.toString('utf8');
  for (const name of ['clip-01.mp4', 'clip-02.mp4', 'clip-03.mp4', 'a-publier.txt']) {
    assert.ok(raw.includes(name), `${name} absent de l'archive`);
  }
  // Le mémo est stocké sans compression : son texte est lisible tel quel.
  assert.ok(raw.includes('Titre 1 #Shorts'), 'le mémo doit contenir les titres');
  assert.ok(raw.includes('partie 1/3'), 'le mémo doit numéroter les épisodes en mode série');
  assert.ok(raw.includes('Légende 1 #fyp'), 'la légende TikTok doit être prête à coller');
});

test('l’archive d’un autre est refusée, celle d’un job vide aussi', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const alice = createClient(ctx.base);
  const mallory = createClient(ctx.base);
  const { jobId } = await seedJobWithClips(ctx, alice, { count: 1 });

  const stolen = await mallory.fetch(`/api/jobs/${jobId}/clips.zip`);
  assert.equal(stolen.status, 403);
  await stolen.arrayBuffer();

  const { body } = await alice.postJson('/api/jobs', { youtubeUrl: VALID_URL });
  const empty = await alice.fetch(`/api/jobs/${body.jobId}/clips.zip`);
  assert.equal(empty.status, 404);
  await empty.arrayBuffer();
});

test('les fichiers nettoyés sont omis sans casser l’archive', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const client = createClient(ctx.base);
  const { jobId, dir } = await seedJobWithClips(ctx, client, { count: 2 });

  // Un des deux fichiers a disparu (rétention).
  await fs.rm(path.join(dir, 'clip_00.mp4'));

  const res = await client.fetch(`/api/jobs/${jobId}/clips.zip`);
  assert.equal(res.status, 200);
  const raw = Buffer.from(await res.arrayBuffer()).toString('utf8');
  assert.ok(!raw.includes('clip-01.mp4'), 'le fichier manquant est omis');
  assert.ok(raw.includes('clip-02.mp4'), 'le fichier présent est bien archivé');
});
