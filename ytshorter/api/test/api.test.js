import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startServer, createClient, VALID_URL } from './helpers/server.js';

test('POST /api/jobs crée un job et le met en file', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const client = createClient(ctx.base);

  const { res, body } = await client.postJson('/api/jobs', {
    youtubeUrl: VALID_URL,
    language: 'fr',
    clipCount: 2,
    targetDuration: 30,
    captionStyle: 'punch',
  });

  assert.equal(res.status, 202);
  assert.match(body.jobId, /^\d+$/);
  assert.equal(ctx.queue.enqueued.length, 1);
  assert.equal(ctx.queue.enqueued[0].youtubeVideoId, 'dQw4w9WgXcQ');
});

test('POST /api/jobs rejette une URL invalide avec INVALID_URL', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const client = createClient(ctx.base);

  const { res, body } = await client.postJson('/api/jobs', { youtubeUrl: 'https://vimeo.com/12345' });
  assert.equal(res.status, 400);
  assert.equal(body.error.code, 'INVALID_URL');
  assert.equal(ctx.queue.enqueued.length, 0);
});

test('POST /api/jobs rejette des options hors bornes', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const client = createClient(ctx.base);

  const { res, body } = await client.postJson('/api/jobs', { youtubeUrl: VALID_URL, clipCount: 99 });
  assert.equal(res.status, 400);
  assert.equal(body.error.code, 'VALIDATION_FAILED');
});

test("un utilisateur ne peut pas lire le job d'un autre via l'ID", async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());

  const alice = createClient(ctx.base);
  const mallory = createClient(ctx.base);

  const { body: created } = await alice.postJson('/api/jobs', { youtubeUrl: VALID_URL });
  const jobId = created.jobId;

  const mine = await alice.json(`/api/jobs/${jobId}`);
  assert.equal(mine.res.status, 200);
  assert.equal(mine.body.id, jobId);

  const stolen = await mallory.json(`/api/jobs/${jobId}`);
  assert.equal(stolen.res.status, 403);
  assert.equal(stolen.body.error.code, 'FORBIDDEN');

  const stolenEvents = await mallory.fetch(`/api/jobs/${jobId}/events`);
  assert.equal(stolenEvents.status, 403);
  await stolenEvents.arrayBuffer();

  const unknown = await alice.json('/api/jobs/999999999');
  assert.equal(unknown.res.status, 404);
});

test('SSE émet des étapes croissantes puis un état final', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const client = createClient(ctx.base);

  const { body: created } = await client.postJson('/api/jobs', { youtubeUrl: VALID_URL });
  const jobId = created.jobId;

  const res = await client.fetch(`/api/jobs/${jobId}/events`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);

  const events = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const pump = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const chunk = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        if (chunk.startsWith(':')) continue;
        const name = /^event: (.+)$/m.exec(chunk)?.[1];
        const data = /^data: (.+)$/m.exec(chunk)?.[1];
        if (name && data) events.push({ name, data: JSON.parse(data) });
        if (name === 'done' || name === 'error') return;
      }
    }
  })();

  // Laisse le temps à l'abonnement de s'établir avant de publier.
  await new Promise((r) => setTimeout(r, 60));
  ctx.bus.publish(jobId, { step: 'download', progress: 10, status: 'processing' });
  ctx.bus.publish(jobId, { step: 'transcribe', progress: 35, status: 'processing' });
  ctx.bus.publish(jobId, { step: 'render', progress: 80, status: 'processing' });
  ctx.bus.publish(jobId, { status: 'done' });

  await pump;

  assert.equal(events[0].name, 'progress');
  assert.equal(events[0].data.status, 'queued');
  const steps = events.filter((e) => e.name === 'progress').map((e) => e.data.progress);
  for (let i = 1; i < steps.length; i += 1) {
    assert.ok(steps[i] >= steps[i - 1], 'la progression ne doit pas reculer');
  }
  assert.equal(events.at(-1).name, 'done');
  assert.equal(events.at(-1).data.progress, 100);
});

test('SSE renvoie immédiatement une erreur pour un job déjà en échec', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const client = createClient(ctx.base);

  const { body: created } = await client.postJson('/api/jobs', { youtubeUrl: VALID_URL });
  const job = ctx.store.jobs.get(created.jobId);
  job.status = 'error';
  job.currentStep = 'transcribe';
  job.errorCode = 'NO_SPEECH';
  job.errorMessage = 'Aucune parole détectée';

  const res = await client.fetch(`/api/jobs/${created.jobId}/events`);
  const text = await res.text();
  assert.match(text, /event: error/);
  assert.match(text, /NO_SPEECH/);
});

test('téléchargement : lien signé valide, lien falsifié refusé', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const client = createClient(ctx.base);

  const { body: created } = await client.postJson('/api/jobs', { youtubeUrl: VALID_URL });
  const jobId = created.jobId;

  const clipDir = path.join(ctx.mediaDir, jobId);
  await fs.mkdir(clipDir, { recursive: true });
  const filePath = path.join(clipDir, 'clip_00.mp4');
  await fs.writeFile(filePath, Buffer.from('fausse-video-mp4'));

  ctx.store.addClip({
    jobId,
    idx: 0,
    startSeconds: 10,
    endSeconds: 40,
    duration: 30,
    score: 90,
    hook: 'Une accroche',
    filePath,
    ytTitle: 'Titre #Shorts',
    ytDescription: 'Description',
    ytHashtags: ['#Shorts'],
    tiktokCaption: 'Légende',
    tiktokHashtags: ['#fyp'],
  });

  const { body: job } = await client.json(`/api/jobs/${jobId}`);
  assert.equal(job.clips.length, 1);
  const url = job.clips[0].downloadUrl;
  assert.match(url, /^\/api\/clips\/\d+\/download\?exp=\d+&sig=[A-Za-z0-9_-]+$/);
  assert.ok(!JSON.stringify(job).includes(ctx.mediaDir), 'le chemin de fichier ne doit pas fuiter');

  const ok = await client.fetch(url);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'video/mp4');
  assert.equal(await ok.text(), 'fausse-video-mp4');

  const tampered = await client.fetch(url.replace(/sig=./, 'sig=X'));
  assert.equal(tampered.status, 403);
  await tampered.arrayBuffer();

  const expired = await client.fetch(`/api/clips/${job.clips[0].id}/download?exp=1&sig=${'A'.repeat(43)}`);
  assert.equal(expired.status, 403);
  await expired.arrayBuffer();
});

test('la limitation de débit bloque la création répétée de jobs', async (t) => {
  const ctx = await startServer({ rateLimit: { window: 60000, max: 1000, jobsMax: 3, authMax: 5 } });
  t.after(() => ctx.close());
  const client = createClient(ctx.base);

  const codes = [];
  for (let i = 0; i < 5; i += 1) {
    const { res, body } = await client.postJson('/api/jobs', { youtubeUrl: VALID_URL });
    codes.push(res.status === 429 ? body.error.code : res.status);
  }
  assert.deepEqual(codes.slice(0, 3), [202, 202, 202]);
  assert.equal(codes[3], 'RATE_LIMITED');
  assert.equal(codes[4], 'RATE_LIMITED');
});

test('/health répond avec le détail des sondes', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const client = createClient(ctx.base);
  const { res, body } = await client.json('/health');
  assert.equal(res.status, 200);
  assert.deepEqual(body, { status: 'ok', db: true, redis: true });
});
