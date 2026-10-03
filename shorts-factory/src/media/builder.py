"""Assemblage final de la vidéo via FFmpeg.

Compose : fond vertical (clip ou couleur) + sous-titres animés brûlés
+ voix off (+ musique optionnelle), export MP4 1080x1920 prêt pour Shorts.
"""
from __future__ import annotations

import os
import random
import shutil
import subprocess
import tempfile
from pathlib import Path

from ..config import Config
from ..logger import get_logger
from .emoji import find_cues, render_png
from .subtitles import build_ass

log = get_logger(__name__)

_AUDIO_EXT = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"}


def ffmpeg_bin() -> str:
    """Binaire ffmpeg à utiliser (surcharge via FFMPEG_BINARY dans .env).

    Utile quand le ffmpeg par défaut est compilé SANS libass (le filtre
    `subtitles` manque alors) : on pointe vers un build complet, ex.
    `FFMPEG_BINARY=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg`.
    """
    return os.environ.get("FFMPEG_BINARY") or "ffmpeg"


def ffprobe_bin() -> str:
    return os.environ.get("FFPROBE_BINARY") or "ffprobe"


def _drawtext_font(cfg: Config) -> str | None:
    """Trouve une police .ttf utilisable pour drawtext (branding)."""
    fonts_dir = cfg.path("captions_fonts_dir", default="data/assets/fonts")
    if fonts_dir.exists():
        for f in sorted(fonts_dir.iterdir()):
            if f.suffix.lower() in {".ttf", ".otf"}:
                return str(f)
    for cand in (
        "/System/Library/Fonts/Supplemental/Arial.ttf",              # macOS
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",           # Debian/Docker
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ):
        if Path(cand).exists():
            return cand
    return None


def ensure_ffmpeg() -> None:
    for tool in (ffmpeg_bin(), ffprobe_bin()):
        if shutil.which(tool) is None and not Path(tool).exists():
            raise RuntimeError(
                f"{tool} introuvable. Installe FFmpeg (apt install ffmpeg) "
                "ou utilise l'image Docker fournie."
            )
    # libass est requis pour brûler les sous-titres animés (filtre `subtitles`).
    try:
        out = subprocess.run(
            [ffmpeg_bin(), "-hide_banner", "-filters"],
            capture_output=True, text=True, check=False,
        )
        if "subtitles" not in out.stdout:
            log.warning(
                "Ce build FFmpeg (%s) n'a pas le filtre `subtitles` (libass) : "
                "les sous-titres ne seront PAS incrustés. Installe un FFmpeg avec "
                "libass (macOS : `brew install ffmpeg-full` puis règle "
                "FFMPEG_BINARY dans .env) ou utilise Docker.",
                ffmpeg_bin(),
            )
    except OSError:
        pass


def _probe_duration(path: Path, fallback: float) -> float:
    try:
        out = subprocess.run(
            [
                ffprobe_bin(), "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=nokey=1:noprint_wrappers=1",
                str(path),
            ],
            capture_output=True, text=True, check=True,
        )
        return float(out.stdout.strip())
    except (subprocess.CalledProcessError, ValueError):
        return fallback


def _pick_music(cfg: Config) -> Path | None:
    if not cfg.get("music", "enabled", default=True):
        return None
    music_dir = cfg.path("music", "music_dir", default="data/assets/music")

    # Musique imposée (ex: colonne "musique" de l'Excel) : nom de fichier
    # dans music_dir, ou chemin. "none"/"aucune" => pas de musique.
    fixed = cfg.get("music", "file", default=None)
    if fixed:
        if str(fixed).strip().lower() in {"none", "aucune", "no", "off"}:
            return None
        cand = Path(fixed)
        if not cand.is_absolute():
            cand = music_dir / fixed
        if cand.exists():
            log.info("Musique (imposée) : %s", cand.name)
            return cand
        log.warning("Musique « %s » introuvable -> choix aléatoire.", fixed)

    if not music_dir.exists():
        return None
    tracks = [p for p in music_dir.iterdir() if p.suffix.lower() in _AUDIO_EXT]
    if not tracks:
        return None

    # Ambiance imposée (config music.mood) : on ne pioche que dans les morceaux
    # de cette ambiance (moods.json) -> cohérent avec le sujet, pas aléatoire.
    mood = cfg.get("music", "mood", default=None)
    if mood:
        import json

        try:
            moods = json.loads((music_dir / "moods.json").read_text(encoding="utf-8"))
            matching = [p for p in tracks if moods.get(p.name) == str(mood)]
            if matching:
                tracks = matching
        except (OSError, ValueError):
            pass

    choice = random.choice(tracks)
    log.info("Musique : %s (ambiance %s)", choice.name, mood or "toutes")
    return choice


def build_video(
    voice_path: str | Path,
    words: list[dict],
    output_path: str | Path,
    cfg: Config,
    bg_path: str | Path | None = None,
) -> Path:
    ensure_ffmpeg()
    voice_path = Path(voice_path).resolve()
    output_path = Path(output_path).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    v = cfg.section("video")
    width, height = int(v.get("width", 1080)), int(v.get("height", 1920))
    fps = int(v.get("fps", 30))
    crf = int(v.get("crf", 20))
    preset = v.get("preset", "medium")
    max_dur = float(v.get("max_duration", 60))

    fallback_len = (words[-1]["end"] if words else 15.0)
    probe = _probe_duration(voice_path, fallback_len)
    # Watchtime : on coupe le silence de fin (edge-tts en ajoute souvent) en
    # calant la durée sur la fin du dernier mot + un court tampon. Pas de temps
    # mort à la fin -> meilleure complétion / rétention.
    if words:
        duration = min(probe + 0.15, words[-1]["end"] + 0.55, max_dur)
    else:
        duration = min(probe + 0.25, max_dur)

    music_path = _pick_music(cfg)
    music_vol = float(cfg.get("music", "volume", default=0.12))
    captions_on = bool(cfg.get("captions", "enabled", default=True))

    work = Path(tempfile.mkdtemp(prefix="short_"))
    try:
        # --- sous-titres ---
        if captions_on and words:
            build_ass(words, work / "captions.ass", cfg)
            fonts_src = cfg.path("captions_fonts_dir", default="data/assets/fonts")
            if not fonts_src.exists():
                fonts_src = cfg.path("data/assets/fonts")
            (work / "fonts").mkdir(exist_ok=True)
            if fonts_src.exists():
                for f in fonts_src.iterdir():
                    if f.suffix.lower() in {".ttf", ".otf"}:
                        shutil.copy(f, work / "fonts" / f.name)

        # --- construction des entrées FFmpeg ---
        cmd: list[str] = [ffmpeg_bin(), "-y", "-hide_banner", "-loglevel", "error"]
        idx = 0

        if bg_path:
            cmd += ["-stream_loop", "-1", "-i", str(Path(bg_path).resolve())]
            v_src = f"{idx}:v"
            idx += 1
            # Assombrissement + saturation + vignette pour que le texte reste
            # lisible par-dessus le b-roll (une plage ensoleillée « avalerait »
            # sinon le blanc des sous-titres) et pour un rendu plus cinéma.
            dim = float(cfg.get("background", "dim", default=0.10))     # 0..1
            sat = float(cfg.get("background", "saturation", default=1.12))
            vchain = (
                f"[{v_src}]scale={width}:{height}:force_original_aspect_ratio=increase,"
                f"crop={width}:{height},setsar=1,fps={fps}"
            )
            # Ken Burns : zoom lent et continu sur toute la vidéo (plus vivant).
            if bool(cfg.get("video", "ken_burns", default=True)):
                amt = float(cfg.get("video", "ken_burns_amount", default=0.12))
                frames = max(1, int(duration * fps))
                rate = amt / frames
                bw, bh = int(width * (1 + amt)) // 2 * 2, int(height * (1 + amt)) // 2 * 2
                vchain += (
                    f",scale={bw}:{bh},"
                    f"zoompan=z='min(zoom+{rate:.6f}\\,{1 + amt:.3f})':d=1:"
                    f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
                    f"s={width}x{height}:fps={fps}"
                )
            vchain += f",eq=brightness=-{dim:.3f}:saturation={sat:.2f},vignette=PI/4"
        else:
            color = cfg.get("background", "color", default="0x0E1116")
            cmd += ["-f", "lavfi", "-i", f"color=c={color}:s={width}x{height}:r={fps}"]
            v_src = f"{idx}:v"
            idx += 1
            # fond uni + léger grain STATIQUE + vignette pour ne pas être plat.
            # NB : pas de grain temporel (allf=t) — il change à chaque frame,
            # devient quasi-incompressible et fait exploser le poids du fichier
            # (~25× plus lourd) sans réel gain visuel.
            vchain = (
                f"[{v_src}]noise=alls=7,vignette=PI/5"
            )

        cmd += ["-i", str(voice_path)]
        voice_idx = idx
        idx += 1

        music_idx = None
        if music_path:
            cmd += ["-stream_loop", "-1", "-i", str(music_path.resolve())]
            music_idx = idx
            idx += 1

        # --- filtre vidéo (sous-titres) ---
        if captions_on and words:
            vchain += ",subtitles=captions.ass:fontsdir=fonts"

        # --- barre de progression signature (rétention) ---
        if bool(cfg.get("video", "progress_bar", default=True)):
            pcol = str(cfg.get("video", "progress_color",
                               default=cfg.get("captions", "highlight_color",
                                               default="#FFD400"))).lstrip("#")
            ph = int(cfg.get("video", "progress_height", default=12))
            vchain += (
                f",drawbox=x=0:y=0:w='iw*min(t/{duration:.2f}\\,1)':h={ph}:"
                f"color=0x{pcol}@0.92:t=fill"
            )

        # --- branding discret en coin (identité de chaîne) ---
        mark = str(cfg.get("video", "watermark", default="") or "").strip()
        font = _drawtext_font(cfg)
        if mark and font:
            safe = (mark.replace("\\", "").replace(":", "").replace("'", "")
                    .replace("%", "").replace("{", "").replace("}", ""))
            vchain += (
                f",drawtext=text='{safe}':fontfile='{font}':fontsize=34:"
                f"fontcolor=white@0.55:x=w-tw-34:y=h-th-34:"
                f"shadowcolor=black@0.5:shadowx=2:shadowy=2"
            )

        # --- emojis qui « pop » sur les mots-clés (overlay PNG couleur) ---
        emoji_on = bool(cfg.get("captions", "emoji", default=True))
        rendered: list[tuple[int, dict]] = []
        if captions_on and words and emoji_on:
            cues = find_cues(words)[:12]  # cap pour garder le graphe raisonnable
            for k, cue in enumerate(cues):
                if render_png(cue["emoji"], work / f"emoji_{k}.png", px=150):
                    rendered.append((k, cue))

        if rendered:
            cap_margin = int(cfg.get("captions", "margin_v", default=640))
            cap_size = int(cfg.get("captions", "font_size", default=92))
            ew = int(cfg.get("captions", "emoji_size", default=230))  # + gros
            y_emoji = max(20, height - cap_margin - int(cap_size * 1.35) - ew - 10)
            parts = [vchain + ",format=yuv420p[base]"]
            prev = "[base]"
            for i, (k, cue) in enumerate(rendered):
                s = float(cue["start"])
                e = float(cue["end"]) + 0.45
                out = "[v]" if i == len(rendered) - 1 else f"[b{k}]"
                # loop=0 : l'image (1 frame) est bouclée pour rester dispo sur
                # toute la durée ; sinon l'overlay n'a rien à afficher après t=0.
                parts.append(
                    f"movie=emoji_{k}.png:loop=0,setpts=N/FRAME_RATE/TB,"
                    f"scale={ew}:-1,format=rgba,"
                    f"fade=t=in:st={s:.2f}:d=0.10:alpha=1[e{k}]"
                )
                # Entrée dynamique : l'emoji « tombe » en place avec un léger
                # dépassement (rebond) sur ~0.25 s, puis reste stable.
                y_expr = (
                    f"'{y_emoji}-90*max(0,1-(t-{s:.2f})/0.18)"
                    f"+16*max(0,1-abs(t-{s:.2f}-0.20)/0.10)'"
                )
                parts.append(
                    f"{prev}[e{k}]overlay=x=(W-w)/2:y={y_expr}:"
                    f"enable='between(t,{s:.2f},{e:.2f})'{out}"
                )
                prev = out
            vchain = ";".join(parts)
        else:
            vchain += ",format=yuv420p[v]"

        # --- filtre audio ---
        # loudnorm : volume constant au niveau social (~-14 LUFS) sur TOUTES les
        # vidéos → rendu pro, plus de « une vidéo trop forte, une trop faible ».
        norm = "loudnorm=I=-14:TP=-1.5:LRA=11"
        if music_idx is not None:
            # DUCKING pro : la musique baisse automatiquement quand la voix
            # parle (sidechaincompress piloté par la voix) et remonte dans les
            # silences -> la musique « respire » avec le rythme, jamais elle
            # n'écrase la voix. Puis on normalise le MIX FINAL (volume constant).
            achain = (
                f"[{voice_idx}:a]asplit=2[vmix][vkey];"
                f"[{music_idx}:a]volume={music_vol}[mus];"
                f"[mus][vkey]sidechaincompress=threshold=0.02:ratio=8:"
                f"attack=15:release=340[mduck];"
                f"[vmix][mduck]amix=inputs=2:duration=first:dropout_transition=200[mix];"
                f"[mix]{norm}[a]"
            )
        else:
            achain = f"[{voice_idx}:a]{norm}[a]"
        fc = vchain + ";" + achain
        audio_map = "[a]"

        cmd += ["-filter_complex", fc, "-map", "[v]", "-map", audio_map]
        cmd += [
            "-t", f"{duration:.2f}",
            "-r", str(fps),
            "-c:v", "libx264", "-preset", preset, "-crf", str(crf),
            "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart",
            str(output_path),
        ]

        log.info("Encodage FFmpeg (%.1fs, %dx%d)…", duration, width, height)
        proc = subprocess.run(cmd, cwd=work, capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError(
                "FFmpeg a échoué :\n"
                + (proc.stderr or proc.stdout or "erreur inconnue")[-2000:]
            )
        log.info("Vidéo générée : %s", output_path.name)
        return output_path
    finally:
        shutil.rmtree(work, ignore_errors=True)
