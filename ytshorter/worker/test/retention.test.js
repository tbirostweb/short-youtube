import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runRetention } from '../src/lib/retention.js';

function fakeDb({ expiredJobs = [], staleUploads = [], existingJobs = [] } = {}) {
  const calls = { deletedJobs: [], deletedUploads: [], consumedPurges: 0 };
  return {
    calls,
    async listExpiredJobs() {
      return expiredJobs;
    },
    async deleteJob(id) {
      calls.deletedJobs.push(String(id));
    },
    async jobExists(id) {
      return existingJobs.includes(String(id));
    },
    async listStaleUploads() {
      return staleUploads;
    },
    async deleteUpload(id) {
      calls.deletedUploads.push(String(id));
    },
    async deleteConsumedUploads() {
      calls.consumedPurges += 1;
    },
  };
}

async function makeMedia() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ytsh-retention-'));
  return dir;
}

const config = (mediaDir, overrides = {}) => ({
  mediaDir,
  retention: { days: 7, uploadTtlHours: 24, intervalMinutes: 60, ...overrides },
});

test('les jobs expirés perdent leurs fichiers et leur ligne en base', async (t) => {
  const mediaDir = await makeMedia();
  t.after(() => fs.rm(mediaDir, { recursive: true, force: true }));

  await fs.mkdir(path.join(mediaDir, '101'), { recursive: true });
  await fs.writeFile(path.join(mediaDir, '101', 'clip_00.mp4'), 'x');
  await fs.mkdir(path.join(mediaDir, '202'), { recursive: true });

  const db = fakeDb({ expiredJobs: ['101'], existingJobs: ['202'] });
  const summary = await runRetention({ db, config: mediaDir ? config(mediaDir) : null });

  assert.equal(summary.jobs, 1);
  assert.deepEqual(db.calls.deletedJobs, ['101']);
  await assert.rejects(() => fs.stat(path.join(mediaDir, '101')));
  assert.ok(await fs.stat(path.join(mediaDir, '202')), 'un job vivant n’est pas touché');
});

test('les fichiers envoyés jamais utilisés sont supprimés', async (t) => {
  const mediaDir = await makeMedia();
  t.after(() => fs.rm(mediaDir, { recursive: true, force: true }));

  const uploadDir = path.join(mediaDir, 'uploads');
  await fs.mkdir(uploadDir, { recursive: true });
  const orphan = path.join(uploadDir, 'abc.mp4');
  await fs.writeFile(orphan, 'x');

  const db = fakeDb({ staleUploads: [{ id: '5', filePath: orphan }] });
  const summary = await runRetention({ db, config: config(mediaDir) });

  assert.equal(summary.uploads, 1);
  assert.deepEqual(db.calls.deletedUploads, ['5']);
  assert.equal(db.calls.consumedPurges, 1);
  await assert.rejects(() => fs.stat(orphan));
  // Le dossier "uploads" n'est pas un dossier de job : il survit.
  assert.ok(await fs.stat(uploadDir));
});

test('les dossiers orphelins sont ramassés', async (t) => {
  const mediaDir = await makeMedia();
  t.after(() => fs.rm(mediaDir, { recursive: true, force: true }));

  await fs.mkdir(path.join(mediaDir, '777'), { recursive: true });
  await fs.mkdir(path.join(mediaDir, '888'), { recursive: true });
  await fs.mkdir(path.join(mediaDir, 'uploads'), { recursive: true });
  await fs.writeFile(path.join(mediaDir, 'note.txt'), 'x');

  const db = fakeDb({ existingJobs: ['888'] });
  const summary = await runRetention({ db, config: config(mediaDir) });

  assert.equal(summary.orphans, 1);
  await assert.rejects(() => fs.stat(path.join(mediaDir, '777')));
  assert.ok(await fs.stat(path.join(mediaDir, '888')));
  assert.ok(await fs.stat(path.join(mediaDir, 'uploads')));
  assert.ok(await fs.stat(path.join(mediaDir, 'note.txt')));
});

test('la rétention désactivée ne supprime aucun job', async (t) => {
  const mediaDir = await makeMedia();
  t.after(() => fs.rm(mediaDir, { recursive: true, force: true }));

  await fs.mkdir(path.join(mediaDir, '101'), { recursive: true });
  const db = fakeDb({ expiredJobs: ['101'], existingJobs: ['101'] });

  const summary = await runRetention({
    db,
    config: config(mediaDir, { days: 0, uploadTtlHours: 0 }),
  });

  assert.equal(summary.jobs, 0);
  assert.equal(summary.uploads, 0);
  assert.deepEqual(db.calls.deletedJobs, []);
  assert.ok(await fs.stat(path.join(mediaDir, '101')));
});

test('un volume média absent ne fait pas échouer le passage', async () => {
  const db = fakeDb();
  const summary = await runRetention({ db, config: config('/media/inexistant') });
  assert.deepEqual(summary, { jobs: 0, uploads: 0, orphans: 0 });
});
