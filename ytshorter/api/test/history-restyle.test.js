import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startServer, createClient, VALID_URL } from './helpers/server.js';

/** Crée un job terminé avec un clip et ses fichiers sur le volume média. */
async function seedFinishedJob(ctx, client, { withCuts = true } = {}) {
  const { body } = await client.postJson('/api/jobs', { youtubeUrl: VALID_URL });
  const jobId = body.jobId;
  const job = ctx.store.jobs.get(jobId);
  job.status = 'done';
  job.currentStep = 'done';
  job.progress = 100;
  job.sourceTitle = 'Ma vidéo';

  const dir = path.join(ctx.mediaDir, jobId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'clip_00.mp4'), 'video');
  if (withCuts) {
    await fs.writeFile(path.join(dir, 'cut_00.mp4'), 'cut');
    await fs.writeFile(
      path.join(dir, 'words.json'),
      JSON.stringify({ words: [{ text: 'bonjour', start: 0, end: 1 }] }),
    );
  }

  const clipId = ctx.store.addClip({
    jobId,
    idx: 0,
    startSeconds: 0,
    endSeconds: 30,
    duration: 30,
    score: 90,
    hook: 'Accroche',
    filePath: path.join(dir, 'clip_00.mp4'),
    ytTitle: 'Titre #Shorts',
  });
  return { jobId, clipId, dir };
}

test('l’historique ne montre que les jobs du demandeur', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const alice = createClient(ctx.base);
  const mallory = createClient(ctx.base);

  await alice.postJson('/api/jobs', { youtubeUrl: VALID_URL });
  await alice.postJson('/api/jobs', { youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' });
  await mallory.postJson('/api/jobs', { youtubeUrl: VALID_URL });

  const mine = await alice.json('/api/jobs');
  assert.equal(mine.res.status, 200);
  assert.equal(mine.body.total, 2);
  assert.equal(mine.body.jobs.length, 2);
  for (const job of mine.body.jobs) {
    assert.equal(job.status, 'queued');
    assert.ok(job.id);
    // L'historique ne divulgue ni chemin de fichier ni clé de propriétaire.
    assert.equal(job.ownerKey, undefined);
    assert.equal(job.filePath, undefined);
  }

  const others = await mallory.json('/api/jobs');
  assert.equal(others.body.total, 1);
});

test('l’historique est paginé', async (t) => {
  const ctx = await startServer({ rateLimit: { window: 60000, max: 1000, jobsMax: 20, authMax: 5, restyleMax: 20 } });
  t.after(() => ctx.close());
  const client = createClient(ctx.base);

  for (let i = 0; i < 5; i += 1) await client.postJson('/api/jobs', { youtubeUrl: VALID_URL });

  const page1 = await client.json('/api/jobs?limit=2&offset=0');
  const page2 = await client.json('/api/jobs?limit=2&offset=2');
  assert.equal(page1.body.jobs.length, 2);
  assert.equal(page2.body.jobs.length, 2);
  assert.equal(page1.body.total, 5);
  assert.notEqual(page1.body.jobs[0].id, page2.body.jobs[0].id);

  const tooBig = await client.json('/api/jobs?limit=500');
  assert.equal(tooBig.res.status, 400);
  assert.equal(tooBig.body.error.code, 'VALIDATION_FAILED');
});

test('supprimer un job efface ses fichiers, et seulement les siens', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const alice = createClient(ctx.base);
  const mallory = createClient(ctx.base);

  const { jobId, dir } = await seedFinishedJob(ctx, alice);

  const stolen = await mallory.fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
  assert.equal(stolen.status, 403);
  await stolen.arrayBuffer();
  assert.ok(await fs.stat(dir), 'le dossier ne doit pas avoir bougé');

  const res = await alice.fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
  assert.equal(res.status, 204);
  await assert.rejects(() => fs.stat(dir), 'le dossier du job doit être supprimé');

  const after = await alice.json(`/api/jobs/${jobId}`);
  assert.equal(after.res.status, 404);
});

test('un job en cours ne peut pas être supprimé', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const client = createClient(ctx.base);

  const { body } = await client.postJson('/api/jobs', { youtubeUrl: VALID_URL });
  ctx.store.jobs.get(body.jobId).status = 'processing';

  const res = await client.json(`/api/jobs/${body.jobId}`, { method: 'DELETE' });
  assert.equal(res.res.status, 409);
  assert.equal(res.body.error.code, 'CONFLICT');
});

test('re-styliser un clip met une tâche en file sans toucher aux quotas', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const client = createClient(ctx.base);

  const { jobId, clipId } = await seedFinishedJob(ctx, client);

  const detail = await client.json(`/api/jobs/${jobId}`);
  assert.equal(detail.body.clips[0].restylable, true);
  assert.equal(detail.body.clips[0].restyleStatus, 'idle');

  const res = await client.postJson(`/api/clips/${clipId}/restyle`, { captionStyle: 'boxed', focusX: 0.2 });
  assert.equal(res.res.status, 202);
  assert.equal(res.body.status, 'queued');

  assert.equal(ctx.queue.restyled.length, 1);
  assert.deepEqual(ctx.queue.restyled[0], {
    clipId,
    jobId,
    captionStyle: 'boxed',
    focusX: 0.2,
    layout: undefined,
    hookOverlay: undefined,
  });
  // Aucune génération complète n'a été relancée.
  assert.equal(ctx.queue.enqueued.length, 1);

  const during = await client.json(`/api/jobs/${jobId}`);
  assert.equal(during.body.clips[0].restyleStatus, 'queued');

  const again = await client.json(`/api/clips/${clipId}/restyle`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ captionStyle: 'clean' }),
  });
  assert.equal(again.res.status, 409);
  assert.equal(again.body.error.code, 'RESTYLE_IN_PROGRESS');
});

test('sans fichiers de découpe, la re-stylisation est refusée avec un motif clair', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const client = createClient(ctx.base);

  const { jobId, clipId } = await seedFinishedJob(ctx, client, { withCuts: false });

  const detail = await client.json(`/api/jobs/${jobId}`);
  assert.equal(detail.body.clips[0].restylable, false, 'l’interface doit pouvoir désactiver le bouton');

  const res = await client.postJson(`/api/clips/${clipId}/restyle`, { captionStyle: 'clean' });
  assert.equal(res.res.status, 410);
  assert.equal(res.body.error.code, 'RESTYLE_UNAVAILABLE');
  assert.equal(ctx.queue.restyled.length, 0);
});

test('on ne re-stylise pas le clip d’un autre', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const alice = createClient(ctx.base);
  const mallory = createClient(ctx.base);

  const { clipId } = await seedFinishedJob(ctx, alice);

  const res = await mallory.postJson(`/api/clips/${clipId}/restyle`, { captionStyle: 'clean' });
  assert.equal(res.res.status, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
  assert.equal(ctx.queue.restyled.length, 0);
});

test('une demande de re-stylisation vide est rejetée', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const client = createClient(ctx.base);
  const { clipId } = await seedFinishedJob(ctx, client);

  const res = await client.postJson(`/api/clips/${clipId}/restyle`, {});
  assert.equal(res.res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_FAILED');

  const bad = await client.postJson(`/api/clips/${clipId}/restyle`, { captionStyle: 'inexistant' });
  assert.equal(bad.res.status, 400);

  const badLayout = await client.postJson(`/api/clips/${clipId}/restyle`, { layout: 'diagonal' });
  assert.equal(badLayout.res.status, 400);
});

test('la mise en page seule suffit à demander un ré-encodage', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const client = createClient(ctx.base);
  const { clipId } = await seedFinishedJob(ctx, client);

  const res = await client.postJson(`/api/clips/${clipId}/restyle`, {
    layout: 'blur',
    hookOverlay: true,
  });
  assert.equal(res.res.status, 202);
  assert.equal(ctx.queue.restyled[0].layout, 'blur');
  assert.equal(ctx.queue.restyled[0].hookOverlay, true);
});
