import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run, commandExists } from '../src/lib/exec.js';
import {
  probe,
  cutClip,
  renderVertical,
  buildVerticalFilter,
  buildAudioFilter,
  measureLoudness,
} from '../src/lib/ffmpeg.js';
import { buildAss } from '../src/lib/ass.js';
import { buildSendcmd } from '../src/steps/tracking.js';

// Les binaires sont configurables : sur une machine où le ffmpeg par défaut
// est compilé sans libass, pointer FFMPEG_BIN vers un build complet permet de
// jouer aussi le test d'incrustation des sous-titres.
const FFMPEG = process.env.FFMPEG_BIN || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_BIN || 'ffprobe';
const config = { ffmpeg: FFMPEG, ffprobe: FFPROBE };
const hasFfmpeg = await commandExists(FFMPEG, ['-version']);

// L'incrustation ASS demande un ffmpeg compilé avec libass. C'est le cas de
// l'image Docker du worker (paquet ffmpeg de Debian) mais pas de toutes les
// installations locales : le test correspondant est alors ignoré, pas simulé.
const hasAssFilter = hasFfmpeg
  ? await run(FFMPEG, ['-hide_banner', '-filters'], { timeoutMs: 30000 })
      .then(({ stdout }) => /^\s*\S+\s+ass\s/m.test(stdout))
      .catch(() => false)
  : false;

// Fabrique un extrait court 16:9 avec piste audio, pour tester les commandes réelles.
async function makeSource(dir) {
  const file = path.join(dir, 'source.mp4');
  await run(
    FFMPEG,
    [
      '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
      '-t', '6',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      file,
    ],
    { timeoutMs: 120000 },
  );
  return file;
}

test('la chaîne de filtres verticale est bien formée', () => {
  const filter = buildVerticalFilter({ focusX: 0.25, assFile: 'clip_00.ass' });
  assert.match(filter, /crop@dyn=w='min\(ih\*9\/16\\,iw\)'/);
  assert.match(filter, /x='clip\(iw\*0\.2500-/);
  assert.match(filter, /scale=1080:1920:force_original_aspect_ratio=increase/);
  assert.match(filter, /,crop=1080:1920,setsar=1/);
  assert.match(filter, /ass=clip_00\.ass$/);

  // Le point de focus est borné, jamais hors de l'image.
  assert.match(buildVerticalFilter({ focusX: 5 }), /iw\*1\.0000/);
  assert.match(buildVerticalFilter({ focusX: -3 }), /iw\*0\.0000/);

  // Avec suivi, la position x est pilotée par sendcmd.
  const tracked = buildVerticalFilter({ focusX: 0.5, assFile: 'a.ass', sendcmdFile: 'a.sendcmd' });
  assert.match(tracked, /^sendcmd=f=a\.sendcmd,crop@dyn=/);
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
  // largeur de recadrage = floor(1080*9/16) = 607 -> x maximum = 1920-607 = 1313
  assert.match(lines[0], /^0\.000-0\.200 \[enter\] crop@dyn x 0;$/);
  assert.match(lines[1], /crop@dyn x 656;$/);
  assert.match(lines[2], /crop@dyn x 1313;$/);
});

test(
  'découpe ffmpeg : la durée du clip est dans la tolérance',
  { skip: hasFfmpeg ? false : 'ffmpeg absent de cette machine' },
  async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ytsh-ffmpeg-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));

    const source = await makeSource(dir);
    const output = path.join(dir, 'cut_00.mp4');
    await cutClip({ input: source, output, start: 1.5, end: 4.0, config });

    const info = await probe(output, config);
    assert.ok(Math.abs(info.duration - 2.5) < 0.15, `durée obtenue : ${info.duration}`);
    assert.equal(info.width, 640);
    assert.ok(info.hasAudio, 'la piste audio doit être conservée');
  },
);

test(
  'rendu vertical : sortie 1080x1920 en une seule passe',
  { skip: hasFfmpeg ? false : 'ffmpeg absent de cette machine' },
  async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ytsh-render-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));

    const source = await makeSource(dir);
    const cut = path.join(dir, 'cut_00.mp4');
    await cutClip({ input: source, output: cut, start: 1.0, end: 4.0, config });

    await renderVertical({
      input: 'cut_00.mp4',
      output: 'clip_00.mp4',
      assFile: null,
      focusX: 0.5,
      cwd: dir,
      durationSeconds: 3,
      config,
    });

    const info = await probe(path.join(dir, 'clip_00.mp4'), config);
    assert.equal(info.width, 1080, 'largeur verticale');
    assert.equal(info.height, 1920, 'hauteur verticale');
    assert.ok(Math.abs(info.duration - 3) < 0.25, `durée obtenue : ${info.duration}`);
    assert.ok(info.hasAudio);
  },
);

test(
  'sous-titres ASS incrustés dans la même passe que le recadrage',
  {
    skip: !hasFfmpeg
      ? 'ffmpeg absent de cette machine'
      : !hasAssFilter
        ? 'ffmpeg local compilé sans libass (filtre ass indisponible)'
        : false,
  },
  async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ytsh-subs-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));

    const source = await makeSource(dir);
    const cut = path.join(dir, 'cut_00.mp4');
    await cutClip({ input: source, output: cut, start: 1.0, end: 4.0, config });

    const words = [
      { text: 'Bonjour', start: 1.0, end: 1.6 },
      { text: 'à', start: 1.6, end: 1.8 },
      { text: 'tous', start: 1.8, end: 2.4 },
      { text: 'les', start: 2.5, end: 2.7 },
      { text: 'amis', start: 2.7, end: 3.4 },
    ];
    await fs.writeFile(
      path.join(dir, 'clip_00.ass'),
      buildAss({ words, clipStart: 1.0, clipEnd: 4.0, style: 'punch' }),
      'utf8',
    );

    await renderVertical({
      input: 'cut_00.mp4',
      output: 'avec_subs.mp4',
      assFile: 'clip_00.ass',
      focusX: 0.5,
      cwd: dir,
      durationSeconds: 3,
      config,
    });
    await renderVertical({
      input: 'cut_00.mp4',
      output: 'sans_subs.mp4',
      assFile: null,
      focusX: 0.5,
      cwd: dir,
      durationSeconds: 3,
      config,
    });

    const info = await probe(path.join(dir, 'avec_subs.mp4'), config);
    assert.equal(info.width, 1080);
    assert.equal(info.height, 1920);

    // Les sous-titres doivent réellement modifier l'image : on compare la
    // luminance moyenne de la zone basse avec et sans incrustation.
    const luma = async (name) => {
      const png = path.join(dir, `${name}.png`);
      await run(
        FFMPEG,
        ['-y', '-ss', '0.5', '-i', path.join(dir, name), '-frames:v', '1',
         '-vf', 'crop=1080:400:0:1400,scale=1:1', png],
        { timeoutMs: 60000 },
      );
      const { stdout } = await run(
        FFPROBE,
        ['-v', 'error', '-f', 'lavfi', '-i', `movie=${png},signalstats`,
         '-show_entries', 'frame_tags=lavfi.signalstats.YAVG', '-of', 'csv=p=0'],
        { timeoutMs: 60000 },
      );
      return Number(stdout.trim().split('\n')[0]);
    };
    const withSubs = await luma('avec_subs.mp4');
    const withoutSubs = await luma('sans_subs.mp4');
    assert.ok(
      Math.abs(withSubs - withoutSubs) > 1,
      `les sous-titres ne modifient pas l'image (${withSubs} vs ${withoutSubs})`,
    );
  },
);

test(
  'le point de focus déplace réellement la fenêtre de recadrage',
  { skip: hasFfmpeg ? false : 'ffmpeg absent de cette machine' },
  async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ytsh-focus-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));

    // Image dont la moitié gauche est rouge et la moitié droite bleue.
    const source = path.join(dir, 'split.mp4');
    await run(
      FFMPEG,
      [
        '-y',
        '-f', 'lavfi', '-i', 'color=c=red:size=320x360:rate=15',
        '-f', 'lavfi', '-i', 'color=c=blue:size=320x360:rate=15',
        '-f', 'lavfi', '-i', 'anullsrc=channel_layout=mono:sample_rate=44100',
        '-filter_complex', '[0:v][1:v]hstack=inputs=2[v]',
        '-map', '[v]', '-map', '2:a',
        '-t', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
        source,
      ],
      { timeoutMs: 120000 },
    );

    const sample = async (focusX, name) => {
      await renderVertical({
        input: 'split.mp4',
        output: name,
        assFile: null,
        focusX,
        cwd: dir,
        durationSeconds: 1,
        config,
      });
      const png = path.join(dir, `${name}.png`);
      await run(FFMPEG, ['-y', '-i', path.join(dir, name), '-frames:v', '1', '-vf', 'scale=1:1', png], {
        timeoutMs: 60000,
      });
      const { stdout } = await run(
        FFPROBE,
        ['-v', 'error', '-f', 'lavfi', '-i', `movie=${png},signalstats`,
         '-show_entries', 'frame_tags=lavfi.signalstats.YAVG', '-of', 'csv=p=0'],
        { timeoutMs: 60000 },
      );
      return Number(stdout.trim().split('\n')[0]);
    };

    // Le rouge et le bleu ont des luminances très différentes :
    // un focus à gauche puis à droite doit donner deux valeurs distinctes.
    const left = await sample(0.05, 'left.mp4');
    const right = await sample(0.95, 'right.mp4');
    assert.ok(Math.abs(left - right) > 5, `luminances trop proches : ${left} vs ${right}`);
  },
);

test('la mise en page « fond flou » conserve toute l’image', { skip: hasFfmpeg ? false : 'ffmpeg absent' }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ytsh-blur-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const source = await makeSource(dir);
  await renderVertical({
    input: path.basename(source),
    output: 'flou.mp4',
    assFile: null,
    layout: 'blur',
    cwd: dir,
    durationSeconds: 6,
    config,
  });

  const info = await probe(path.join(dir, 'flou.mp4'), config);
  assert.equal(info.width, 1080);
  assert.equal(info.height, 1920);
  assert.ok(info.hasAudio);
});

test('la chaîne de filtres du fond flou est un graphe valide', () => {
  const filter = buildVerticalFilter({ layout: 'blur', assFile: 'c.ass' });
  assert.match(filter, /^split=2\[bgsrc\]\[fgsrc\];/);
  assert.match(filter, /gblur=sigma=32/);
  assert.match(filter, /\[bg\]\[fg\]overlay=\(W-w\)\/2:\(H-h\)\/2/);
  // Les chaînes nommées sont séparées par des points-virgules, pas des virgules.
  assert.equal(filter.split(';').length, 4);
  // Aucun recadrage dynamique : il n'y a rien à suivre en fond flou.
  assert.ok(!filter.includes('crop@dyn'));
});

test('le fondu de fermeture n’est ajouté que s’il tient dans le clip', () => {
  assert.match(
    buildVerticalFilter({ fadeOut: 0.25, durationSeconds: 30 }),
    /fade=t=out:st=29\.750:d=0\.250$/,
  );
  // Clip trop court : pas de fondu plutôt qu'un fondu qui mange tout.
  assert.ok(!buildVerticalFilter({ fadeOut: 0.25, durationSeconds: 0.4 }).includes('fade=t=out'));
  // Aucun fondu d'ouverture : le premier dixième de seconde est l'accroche.
  assert.ok(!buildVerticalFilter({ fadeOut: 0.25, durationSeconds: 30 }).includes('fade=t=in'));
});

test(
  'un passage silencieux n’est pas normalisé et s’encode quand même',
  { skip: hasFfmpeg ? false : 'ffmpeg absent' },
  async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ytsh-silence-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));

    const muet = path.join(dir, 'muet.mp4');
    await run(
      FFMPEG,
      [
        '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25',
        '-f', 'lavfi', '-i', 'anullsrc=channel_layout=mono:sample_rate=44100',
        '-t', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
        muet,
      ],
      { timeoutMs: 120000 },
    );

    // Normaliser un silence n'a pas de sens et cassait l'encodage.
    assert.equal(await measureLoudness(muet, config), null);

    await renderVertical({
      input: 'muet.mp4',
      output: 'sortie.mp4',
      assFile: null,
      focusX: 0.5,
      cwd: dir,
      durationSeconds: 2,
      config,
    });
    const info = await probe(path.join(dir, 'sortie.mp4'), config);
    assert.equal(info.width, 1080);
    assert.ok(info.hasAudio, 'la piste audio doit rester présente');
  },
);

test(
  'le volume du clip est ramené autour de -14 LUFS',
  { skip: hasFfmpeg ? false : 'ffmpeg absent' },
  async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ytsh-loud-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));

    // Source volontairement trop faible : environ -32 LUFS.
    const faible = path.join(dir, 'faible.mp4');
    await run(
      FFMPEG,
      [
        '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25',
        '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=44100',
        '-af', 'volume=-18dB',
        '-t', '4', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
        faible,
      ],
      { timeoutMs: 120000 },
    );

    const avant = await measureLoudness(faible, config);
    assert.ok(avant, 'la source doit être mesurable');
    assert.ok(Number.parseFloat(avant.input_i) < -25, `source déjà forte : ${avant.input_i}`);

    await renderVertical({
      input: 'faible.mp4',
      output: 'normalise.mp4',
      assFile: null,
      focusX: 0.5,
      cwd: dir,
      durationSeconds: 4,
      config,
    });

    const apres = await measureLoudness(path.join(dir, 'normalise.mp4'), config);
    const niveau = Number.parseFloat(apres.input_i);
    assert.ok(
      Math.abs(niveau - -14) < 2,
      `volume de sortie attendu autour de -14 LUFS, obtenu ${niveau}`,
    );
  },
);

test('la chaîne audio se réduit aux fondus quand la mesure échoue', () => {
  assert.equal(
    buildAudioFilter({ measured: null, fadeOut: 0.25, durationSeconds: 10 }),
    'afade=t=in:st=0:d=0.05,afade=t=out:st=9.750:d=0.250',
  );
  const complet = buildAudioFilter({
    measured: { input_i: '-21.8', input_tp: '-17.7', input_lra: '0.0', input_thresh: '-31.8', target_offset: '0.5' },
    fadeOut: 0,
    durationSeconds: 10,
  });
  assert.match(complet, /^loudnorm=I=-14:TP=-1\.5:LRA=11:measured_I=-21\.8/);
  assert.match(complet, /linear=true/, 'normalisation linéaire, pas de compression dynamique');
  assert.match(complet, /aresample=44100/);
});
