import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run, commandExists } from '../src/lib/exec.js';
import { probe } from '../src/lib/ffmpeg.js';
import { restyleClip } from '../src/steps/restyle.js';
import { CODES } from '../src/lib/errors.js';

const FFMPEG = process.env.FFMPEG_BIN || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_BIN || 'ffprobe';
const hasFfmpeg = await commandExists(FFMPEG, ['-version']);

// La re-stylisation ré-incruste toujours les sous-titres : sans libass, il n'y
// a rien à vérifier. Le test s'ignore alors plutôt que d'être simulé.
const hasAssFilter = hasFfmpeg
  ? await run(FFMPEG, ['-hide_banner', '-filters'], { timeoutMs: 30000 })
      .then(({ stdout }) => /^\s*\S+\s+ass\s/m.test(stdout))
      .catch(() => false)
  : false;

const renderSkip = !hasFfmpeg
  ? 'ffmpeg absent de cette machine'
  : !hasAssFilter
    ? 'ffmpeg local compilé sans libass (filtre ass indisponible)'
    : false;

const WORDS = [
  { text: 'Voici', start: 0.1, end: 0.6 },
  { text: 'un', start: 0.6, end: 0.8 },
  { text: 'essai', start: 0.8, end: 1.4 },
  { text: 'complet', start: 1.5, end: 2.2 },
];

function fakeDb({ clip, job }) {
  const calls = { statuses: [], finished: null };
  return {
    calls,
    async getClip() {
      return clip;
    },
    async getJob() {
      return job;
    },
    async setClipRestyleStatus(id, status) {
      calls.statuses.push(status);
    },
    async finishRestyle(id, payload) {
      calls.finished = { id, ...payload };
    },
  };
}

async function makeJobDir({ withCut = true, withWords = true, seconds = 3 } = {}) {
  const mediaDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ytsh-restyle-'));
  const jobDir = path.join(mediaDir, '42');
  await fs.mkdir(jobDir, { recursive: true });

  if (withCut) {
    await run(
      FFMPEG,
      [
        '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25',
        '-f', 'lavfi', '-i', 'sine=frequency=440',
        '-t', String(seconds),
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
        path.join(jobDir, 'cut_00.mp4'),
      ],
      { timeoutMs: 120000 },
    );
  }
  if (withWords) {
    await fs.writeFile(path.join(jobDir, 'words.json'), JSON.stringify({ words: WORDS }));
  }
  // Un clip déjà produit, qui sera remplacé.
  await fs.writeFile(path.join(jobDir, 'clip_00.mp4'), 'ancien contenu');
  return { mediaDir, jobDir };
}

const clipRow = {
  id: '7',
  job_id: '42',
  idx: 0,
  start_seconds: 0,
  end_seconds: 3,
  pad_start: 0,
  pad_end: 0,
  caption_style: 'punch',
  focus_x: 0.5,
};
const jobRow = { id: '42', caption_style: 'punch', focus_x: 0.5 };

test(
  'la re-stylisation remplace le clip par un rendu vertical, sans toucher au reste',
  { skip: renderSkip },
  async (t) => {
    const { mediaDir, jobDir } = await makeJobDir();
    t.after(() => fs.rm(mediaDir, { recursive: true, force: true }));

    const db = fakeDb({ clip: clipRow, job: jobRow });
    const config = { mediaDir, ffmpeg: FFMPEG, ffprobe: FFPROBE, trackingCrop: false };

    const result = await restyleClip({
      clipId: '7',
      captionStyle: 'boxed',
      focusX: 0.15,
      db,
      config,
    });

    const info = await probe(path.join(jobDir, 'clip_00.mp4'), { ffprobe: FFPROBE });
    assert.equal(info.width, 1080);
    assert.equal(info.height, 1920);
    assert.ok(Math.abs(info.duration - 3) < 0.3, `durée obtenue : ${info.duration}`);

    // Le nouveau style est écrit dans le fichier de sous-titres.
    const ass = await fs.readFile(path.join(jobDir, 'clip_00.ass'), 'utf8');
    assert.match(ass, /^Style: Karaoke,DejaVu Sans,70,/m, 'préréglage boxed attendu');
    assert.match(ass, /\{\\k\d+\}Voici/, 'karaoké mot à mot conservé');

    // La base est mise à jour, et la découpe reste disponible pour un autre essai.
    assert.deepEqual(db.calls.finished, {
      id: '7',
      captionStyle: 'boxed',
      focusX: 0.15,
      layout: 'crop',
      hookOverlay: false,
      duration: info.duration,
      startSeconds: 0,
      endSeconds: 3,
      padStart: 0,
      padEnd: 0,
      subtitlesEdited: false,
    });
    assert.equal(result.captionStyle, 'boxed');
    assert.ok(await fs.stat(path.join(jobDir, 'cut_00.mp4')));

    // Aucun fichier temporaire ne traîne.
    const left = await fs.readdir(jobDir);
    assert.ok(!left.some((f) => f.includes('.restyle.')), `fichier temporaire oublié : ${left}`);
  },
);

test(
  'sans style demandé, celui du clip est conservé',
  { skip: renderSkip },
  async (t) => {
    const { mediaDir, jobDir } = await makeJobDir();
    t.after(() => fs.rm(mediaDir, { recursive: true, force: true }));

    const db = fakeDb({ clip: { ...clipRow, caption_style: 'clean' }, job: jobRow });
    await restyleClip({
      clipId: '7',
      focusX: 0.9,
      db,
      config: { mediaDir, ffmpeg: FFMPEG, ffprobe: FFPROBE, trackingCrop: false },
    });

    const ass = await fs.readFile(path.join(jobDir, 'clip_00.ass'), 'utf8');
    assert.match(ass, /^Style: Karaoke,DejaVu Sans,74,/m, 'préréglage clean conservé');
    assert.equal(db.calls.finished.captionStyle, 'clean');
    assert.equal(db.calls.finished.focusX, 0.9);
  },
);

test('sans découpe, la re-stylisation refuse explicitement', async (t) => {
  const { mediaDir } = await makeJobDir({ withCut: false });
  t.after(() => fs.rm(mediaDir, { recursive: true, force: true }));

  const db = fakeDb({ clip: clipRow, job: jobRow });
  await assert.rejects(
    () =>
      restyleClip({
        clipId: '7',
        captionStyle: 'clean',
        db,
        config: { mediaDir, ffmpeg: FFMPEG, ffprobe: FFPROBE, trackingCrop: false },
      }),
    (err) => err.code === CODES.RESTYLE_UNAVAILABLE,
  );
});

test('sans transcription, la re-stylisation refuse explicitement', async (t) => {
  const { mediaDir } = await makeJobDir({ withCut: hasFfmpeg, withWords: false });
  t.after(() => fs.rm(mediaDir, { recursive: true, force: true }));

  const db = fakeDb({ clip: clipRow, job: jobRow });
  await assert.rejects(
    () =>
      restyleClip({
        clipId: '7',
        captionStyle: 'clean',
        db,
        config: { mediaDir, ffmpeg: FFMPEG, ffprobe: FFPROBE, trackingCrop: false },
      }),
    (err) => err.code === CODES.RESTYLE_UNAVAILABLE,
  );
});

test(
  'les bornes du clip se déplacent dans la marge conservée',
  { skip: renderSkip },
  async (t) => {
    const { mediaDir, jobDir } = await makeJobDir({ seconds: 8 });
    t.after(() => fs.rm(mediaDir, { recursive: true, force: true }));

    // La découpe couvre [start-2, end+2], soit 8 secondes pour un clip de 4.
    const clip = { ...clipRow, start_seconds: 10, end_seconds: 14, pad_start: 2, pad_end: 2 };
    const db = fakeDb({ clip, job: jobRow });
    const config = { mediaDir, ffmpeg: FFMPEG, ffprobe: FFPROBE, trackingCrop: false };

    await restyleClip({ clipId: '7', startSeconds: 9, endSeconds: 15, db, config });

    const info = await probe(path.join(jobDir, 'clip_00.mp4'), { ffprobe: FFPROBE });
    assert.ok(Math.abs(info.duration - 6) < 0.35, `durée obtenue : ${info.duration}`);

    // La marge restante suit le déplacement : plus rien à gauche ni à droite.
    assert.equal(db.calls.finished.startSeconds, 9);
    assert.equal(db.calls.finished.endSeconds, 15);
    assert.equal(db.calls.finished.padStart, 1);
    assert.equal(db.calls.finished.padEnd, 1);
  },
);

test(
  'une borne hors de la marge est ramenée à la limite, pas refusée',
  { skip: renderSkip },
  async (t) => {
    const { mediaDir } = await makeJobDir({ seconds: 8 });
    t.after(() => fs.rm(mediaDir, { recursive: true, force: true }));

    const clip = { ...clipRow, start_seconds: 10, end_seconds: 14, pad_start: 2, pad_end: 2 };
    const db = fakeDb({ clip, job: jobRow });

    // Demande absurde : 20 secondes avant, alors que la marge est de 2.
    await restyleClip({
      clipId: '7',
      startSeconds: -10,
      endSeconds: 100,
      db,
      config: { mediaDir, ffmpeg: FFMPEG, ffprobe: FFPROBE, trackingCrop: false },
    });

    assert.equal(db.calls.finished.startSeconds, 8, 'ramené à start - pad');
    assert.equal(db.calls.finished.endSeconds, 16, 'ramené à end + pad');
    assert.equal(db.calls.finished.padStart, 0);
    assert.equal(db.calls.finished.padEnd, 0);
  },
);

test(
  'des sous-titres corrigés à la main sont incrustés tels quels',
  { skip: renderSkip },
  async (t) => {
    const { mediaDir, jobDir } = await makeJobDir();
    t.after(() => fs.rm(mediaDir, { recursive: true, force: true }));

    const db = fakeDb({ clip: clipRow, job: jobRow });
    const config = { mediaDir, ffmpeg: FFMPEG, ffprobe: FFPROBE, trackingCrop: false };

    await restyleClip({
      clipId: '7',
      captionStyle: 'clean',
      lines: [
        { start: 0.2, end: 1.4, text: 'Texte corrigé à la main' },
        { start: 1.6, end: 2.8, text: 'Deuxième ligne' },
      ],
      db,
      config,
    });

    const ass = await fs.readFile(path.join(jobDir, 'clip_00.ass'), 'utf8');
    assert.match(ass, /Texte {\\k\d+}corrigé/, 'le texte corrigé est incrusté');
    assert.match(ass, /Deuxième {\\k\d+}ligne/);
    assert.ok(!ass.includes('essai'), 'les mots d’origine ne sont plus utilisés');
    // Deux lignes demandées, deux événements de sous-titres.
    assert.equal(ass.split('\n').filter((l) => l.startsWith('Dialogue:')).length, 2);
    assert.equal(db.calls.finished.subtitlesEdited, true);

    // Les corrections sont conservées pour les ré-encodages suivants.
    const stored = JSON.parse(await fs.readFile(path.join(jobDir, 'clip_00.lines.json'), 'utf8'));
    assert.equal(stored.length, 2);
    assert.equal(stored[0].text, 'Texte corrigé à la main');
  },
);

test(
  'un ré-encodage ultérieur conserve les corrections déjà faites',
  { skip: renderSkip },
  async (t) => {
    const { mediaDir, jobDir } = await makeJobDir();
    t.after(() => fs.rm(mediaDir, { recursive: true, force: true }));

    await fs.writeFile(
      path.join(jobDir, 'clip_00.lines.json'),
      JSON.stringify([{ start: 0.2, end: 2.0, text: 'Correction persistante' }]),
    );

    const db = fakeDb({ clip: clipRow, job: jobRow });
    // On ne demande qu'un changement de style, sans repasser les lignes.
    await restyleClip({
      clipId: '7',
      captionStyle: 'boxed',
      db,
      config: { mediaDir, ffmpeg: FFMPEG, ffprobe: FFPROBE, trackingCrop: false },
    });

    const ass = await fs.readFile(path.join(jobDir, 'clip_00.ass'), 'utf8');
    assert.match(ass, /Correction {\\k\d+}persistante/);
  },
);
