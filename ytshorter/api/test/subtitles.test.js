import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startServer, createClient, VALID_URL } from './helpers/server.js';
import { sanitizeLines, clampBounds } from '../src/routes/clips.js';
import { buildSrt, buildVtt, formatSrtTime } from '../src/lib/clip-files.js';

// Le clip couvre [30, 70] dans la source, avec 2,5 s de marge de chaque côté.
const LINES = [
  { start: 30.2, end: 32.0, text: 'Bonjour tout le monde' },
  { start: 32.4, end: 34.5, text: 'Voici le sujet du jour' },
];

async function seedClip(ctx, client, { withLines = true, withCuts = true } = {}) {
  const { body } = await client.postJson('/api/jobs', { youtubeUrl: VALID_URL });
  const jobId = body.jobId;
  const job = ctx.store.jobs.get(jobId);
  job.status = 'done';
  job.progress = 100;

  const dir = path.join(ctx.mediaDir, jobId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'clip_00.mp4'), 'video');
  if (withCuts) {
    await fs.writeFile(path.join(dir, 'cut_00.mp4'), 'cut');
    await fs.writeFile(path.join(dir, 'words.json'), JSON.stringify({ words: [] }));
  }
  if (withLines) {
    await fs.writeFile(path.join(dir, 'clip_00.lines.json'), JSON.stringify(LINES));
  }

  const clipId = ctx.store.addClip({
    jobId,
    idx: 0,
    startSeconds: 30,
    endSeconds: 70,
    padStart: 2.5,
    padEnd: 2.5,
    duration: 40,
    score: 90,
    hook: 'Accroche',
    filePath: path.join(dir, 'clip_00.mp4'),
  });
  return { jobId, clipId, dir };
}

test('les sous-titres incrustés sont lisibles en temps local', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const client = createClient(ctx.base);
  const { clipId } = await seedClip(ctx, client);

  const { res, body } = await client.json(`/api/clips/${clipId}/subtitles`);
  assert.equal(res.status, 200);
  assert.equal(body.duration, 40);
  // Le clip commence à 30 s dans la source : la première ligne est à 0,2 s.
  assert.deepEqual(body.lines, [
    { start: 0.2, end: 2, text: 'Bonjour tout le monde' },
    { start: 2.4, end: 4.5, text: 'Voici le sujet du jour' },
  ]);
});

test('les capacités d’édition sont annoncées avec le clip', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const client = createClient(ctx.base);
  const { jobId } = await seedClip(ctx, client);

  const { body } = await client.json(`/api/jobs/${jobId}`);
  const clip = body.clips[0];
  assert.equal(clip.restylable, true);
  assert.equal(clip.subtitlesEditable, true);
  assert.deepEqual(clip.adjustable, { before: 2.5, after: 2.5 });
  assert.equal(clip.subtitlesEdited, false);
});

test('sans lignes enregistrées, l’édition est annoncée impossible', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const client = createClient(ctx.base);
  const { jobId, clipId } = await seedClip(ctx, client, { withLines: false });

  const { body } = await client.json(`/api/jobs/${jobId}`);
  assert.equal(body.clips[0].subtitlesEditable, false);

  const read = await client.json(`/api/clips/${clipId}/subtitles`);
  assert.equal(read.res.status, 410);
  assert.equal(read.body.error.code, 'SUBTITLES_UNAVAILABLE');
});

test('une correction de sous-titres déclenche un ré-encodage', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const client = createClient(ctx.base);
  const { clipId } = await seedClip(ctx, client);

  const { res, body } = await client.json(`/api/clips/${clipId}/subtitles`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      lines: [
        { start: 0.2, end: 2.0, text: 'Bonjour à toutes et à tous' },
        { start: 2.4, end: 4.5, text: 'Voici le sujet du jour' },
      ],
    }),
  });

  assert.equal(res.status, 202);
  assert.equal(body.lines, 2);
  assert.equal(ctx.queue.restyled.length, 1);

  // Le worker reçoit des temps absolus : ils survivent à un changement de bornes.
  assert.deepEqual(ctx.queue.restyled[0].lines, [
    { start: 30.2, end: 32, text: 'Bonjour à toutes et à tous' },
    { start: 32.4, end: 34.5, text: 'Voici le sujet du jour' },
  ]);

  const { body: job } = await client.json(`/api/jobs/${ctx.queue.restyled[0].jobId}`);
  assert.equal(job.clips[0].restyleStatus, 'queued');
});

test('on ne corrige pas les sous-titres d’un autre', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const alice = createClient(ctx.base);
  const mallory = createClient(ctx.base);
  const { clipId } = await seedClip(ctx, alice);

  const read = await mallory.json(`/api/clips/${clipId}/subtitles`);
  assert.equal(read.res.status, 403);

  const write = await mallory.json(`/api/clips/${clipId}/subtitles`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lines: [{ start: 0, end: 1, text: 'pirate' }] }),
  });
  assert.equal(write.res.status, 403);
  assert.equal(ctx.queue.restyled.length, 0);
});

test('les lignes invalides sont rejetées par le schéma', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const client = createClient(ctx.base);
  const { clipId } = await seedClip(ctx, client);

  const cases = [
    { lines: [] },
    { lines: [{ start: 0, end: 1 }] },
    { lines: [{ start: 0, end: 1, text: '' }] },
    { lines: [{ start: 0, end: 1, text: 'x'.repeat(400) }] },
    { lines: Array.from({ length: 400 }, () => ({ start: 0, end: 1, text: 'trop' })) },
    { lines: 'pas un tableau' },
  ];
  for (const payload of cases) {
    const res = await client.json(`/api/clips/${clipId}/subtitles`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(res.res.status, 400, JSON.stringify(payload).slice(0, 40));
  }
});

test('export SRT et VTT', async (t) => {
  const ctx = await startServer();
  t.after(() => ctx.close());
  const client = createClient(ctx.base);
  const { clipId } = await seedClip(ctx, client);

  const srt = await client.fetch(`/api/clips/${clipId}/subtitles.srt`);
  assert.equal(srt.status, 200);
  assert.match(srt.headers.get('content-type'), /x-subrip/);
  assert.match(srt.headers.get('content-disposition'), /attachment; filename=".*\.srt"/);
  const text = await srt.text();
  assert.equal(
    text,
    '1\n00:00:00,200 --> 00:00:02,000\nBonjour tout le monde\n\n' +
      '2\n00:00:02,400 --> 00:00:04,500\nVoici le sujet du jour\n',
  );

  const vtt = await client.fetch(`/api/clips/${clipId}/subtitles.vtt`);
  assert.equal(vtt.status, 200);
  const vttText = await vtt.text();
  assert.match(vttText, /^WEBVTT\n/);
  assert.match(vttText, /00:00:00\.200 --> 00:00:02\.000/);
});

test('la position dans la file est annoncée tant que le job attend', async (t) => {
  const ctx = await startServer({ rateLimit: { window: 60000, max: 1000, jobsMax: 10, authMax: 5, restyleMax: 20 } });
  t.after(() => ctx.close());
  const client = createClient(ctx.base);

  const first = await client.postJson('/api/jobs', { youtubeUrl: VALID_URL });
  const second = await client.postJson('/api/jobs', { youtubeUrl: VALID_URL });

  const one = await client.json(`/api/jobs/${first.body.jobId}`);
  const two = await client.json(`/api/jobs/${second.body.jobId}`);
  assert.equal(one.body.queuePosition, 1);
  assert.equal(two.body.queuePosition, 2);

  // Une fois le traitement démarré, la position n'a plus de sens.
  ctx.store.jobs.get(first.body.jobId).status = 'processing';
  const started = await client.json(`/api/jobs/${first.body.jobId}`);
  assert.equal(started.body.queuePosition, null);
});

// --- Fonctions pures ---------------------------------------------------------

test('sanitizeLines corrige les chevauchements et écarte l’inexploitable', () => {
  const lines = sanitizeLines(
    [
      { start: 0, end: 2, text: '  Première   ligne  ' },
      { start: 1, end: 3, text: 'Chevauche la précédente' },
      { start: 5, end: 5.01, text: 'Trop courte' },
      { start: 6, end: 8, text: '   ' },
      { start: 7, end: 100, text: 'Dépasse la fin du clip' },
      { start: NaN, end: 2, text: 'Temps invalide' },
    ],
    40,
  );

  assert.equal(lines.length, 3);
  assert.equal(lines[0].text, 'Première ligne', 'espaces normalisés');
  assert.equal(lines[1].start, 2, 'le chevauchement est repoussé');
  assert.equal(lines[2].end, 40, 'borné à la durée du clip');
});

test('clampBounds respecte la marge disponible et la durée minimale', () => {
  const clip = { startSeconds: 30, endSeconds: 70, padStart: 2.5, padEnd: 2.5 };

  assert.deepEqual(clampBounds(clip, {}), {}, 'sans demande, aucun changement');
  assert.deepEqual(clampBounds(clip, { startSeconds: 28.5 }), { startSeconds: 28.5, endSeconds: 70 });
  // Au-delà de la marge, on borne au lieu de refuser.
  assert.deepEqual(clampBounds(clip, { startSeconds: 0 }), { startSeconds: 27.5, endSeconds: 70 });
  assert.deepEqual(clampBounds(clip, { endSeconds: 999 }), { startSeconds: 30, endSeconds: 72.5 });
  // Durée minimale de 5 s garantie.
  const serre = clampBounds(clip, { startSeconds: 69, endSeconds: 69.5 });
  assert.ok(serre.endSeconds - serre.startSeconds >= 5);
});

test('formatSrtTime respecte le format horaire', () => {
  assert.equal(formatSrtTime(0), '00:00:00,000');
  assert.equal(formatSrtTime(1.5), '00:00:01,500');
  assert.equal(formatSrtTime(3661.25), '01:01:01,250');
  assert.equal(formatSrtTime(-2), '00:00:00,000');
});

test('les lignes vides sont ignorées à l’export', () => {
  const srt = buildSrt([
    { start: 0, end: 1, text: 'Gardée' },
    { start: 1, end: 1, text: 'Durée nulle' },
    { start: 2, end: 3, text: '   ' },
  ]);
  assert.equal(srt, '1\n00:00:00,000 --> 00:00:01,000\nGardée\n');
  assert.match(buildVtt([{ start: 0, end: 1, text: 'Gardée' }]), /^WEBVTT/);
});
