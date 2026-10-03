"""Musique de fond : récupérée à la volée (zéro stockage) + crédit auto.

`get_music(cfg)` renvoie (chemin_mp3, crédit) selon `music.source` :
  - "incompetech" (défaut) : morceaux Kevin MacLeod (CC BY 4.0) téléchargés à
    la demande depuis incompetech.com — SANS clé, URLs stables, qualité curée
    par ambiance. Rien à stocker dans le repo. C'est le plus fiable.
  - "openverse" : recherche via l'API Openverse (CC, filtre commercial). Plus
    de variété, mais l'accès anonyme est très limité -> mets un token gratuit
    OPENVERSE_API_TOKEN sinon ça retombe souvent sur le repli.
  - "local" : pioche dans data/assets/music (repli).

Le crédit du morceau utilisé est ajouté automatiquement à la description.
"""
from __future__ import annotations

import hashlib
import json
import os
import random
import re
import urllib.parse
from pathlib import Path

import requests

from ..config import Config
from ..logger import get_logger
from .builder import _pick_music

log = get_logger(__name__)

_UA = "ShortsFactory/1.0 (background music fetch)"


def _local_credit(music_path: Path | None) -> str | None:
    if not music_path:
        return None
    try:
        credits = json.loads(
            (music_path.parent / "credits.json").read_text(encoding="utf-8")
        )
    except (OSError, ValueError):
        return None
    return credits.get(music_path.name)


def _cache_dir(cfg: Config) -> Path:
    d = cfg.path("project", "db_path").parent / "cache" / "music"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _download_mp3(url: str, dest: Path) -> bool:
    """Télécharge un mp3 (vérifie l'en-tête). True si OK."""
    if dest.exists() and dest.stat().st_size > 0:
        return True
    try:
        r = requests.get(url, headers={"User-Agent": _UA}, timeout=120)
        r.raise_for_status()
        if r.content[:3] not in (b"ID3", b"\xff\xfb", b"\xff\xf3"):
            return False
        dest.write_bytes(r.content)
        return True
    except requests.RequestException:
        dest.unlink(missing_ok=True)
        return False


# ---------------------------------------------------------------------
#  Source 1 (défaut) : Kevin MacLeod / incompetech (CC BY 4.0), à la demande
# ---------------------------------------------------------------------
_INCOMPETECH_BASE = "https://incompetech.com/music/royalty-free/mp3-royaltyfree"
_INCOMPETECH = {
    "uplift": ["Inspired", "Fearless First", "Life of Riley", "Carefree",
               "Wallpaper", "Salty Ditty"],
    "tech": ["The Complex", "Digital Lemonade", "Blippy Trance",
             "Investigations", "Voltaic", "Itty Bitty 8 Bit"],
    "calm": ["Deliberate Thought", "Bossa Antigua", "Local Forecast - Elevator",
             "Clenched Teeth"],
    "": ["Inspired", "The Complex", "Life of Riley", "Deliberate Thought",
         "Carefree", "Investigations"],
}


def _fetch_incompetech(cfg: Config, mood: str | None) -> tuple[Path | None, str | None]:
    names = list(_INCOMPETECH.get(mood or "", _INCOMPETECH[""]))
    random.shuffle(names)
    cache = _cache_dir(cfg)
    for name in names[:5]:
        slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
        dest = cache / f"km_{slug}.mp3"
        url = f"{_INCOMPETECH_BASE}/{urllib.parse.quote(name)}.mp3"
        if _download_mp3(url, dest):
            log.info("Musique (incompetech) : %s [%s]", name, mood or "toutes")
            return dest, (
                f"« {name} » by Kevin MacLeod (incompetech.com) "
                "— Licensed under Creative Commons: By Attribution 4.0"
            )
    return None, None


# ---------------------------------------------------------------------
#  Source 2 (option) : API Openverse (CC, filtre commercial)
# ---------------------------------------------------------------------
_MOOD_QUERY = {
    "uplift": "uplifting corporate motivational instrumental",
    "tech": "electronic technology futuristic instrumental",
    "calm": "ambient calm relaxing instrumental",
    "": "background instrumental",
}


def _fetch_openverse(cfg: Config, mood: str | None) -> tuple[Path | None, str | None]:
    headers = {"User-Agent": _UA}
    token = os.getenv("OPENVERSE_API_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        resp = requests.get(
            "https://api.openverse.org/v1/audio/", headers=headers,
            params={"q": _MOOD_QUERY.get(mood or "", _MOOD_QUERY[""]),
                    "category": "music", "license_type": "commercial",
                    "page_size": 40},
            timeout=30,
        )
        resp.raise_for_status()
        results = resp.json().get("results", [])
    except (requests.RequestException, ValueError) as exc:
        log.warning("Openverse indisponible (%s).", exc)
        return None, None

    safe = [r for r in results if r.get("license") in ("by", "by-sa") and r.get("url")]
    random.shuffle(safe)
    cache = _cache_dir(cfg)
    for t in safe[:6]:
        tid = re.sub(r"[^a-zA-Z0-9]", "", str(t.get("id") or ""))[:16] or \
            hashlib.md5(t["url"].encode()).hexdigest()[:16]
        dest = cache / f"ov_{tid}.mp3"
        if _download_mp3(t["url"], dest):
            lic = (t.get("license") or "").upper()
            log.info("Musique Openverse : %s — %s", t.get("title"), t.get("creator"))
            credit = (
                f"« {t.get('title', 'Untitled')} » by {t.get('creator', 'Unknown')} "
                f"(CC {lic} {t.get('license_version', '')}) — "
                f"{t.get('foreign_landing_url') or ''}"
            ).strip().rstrip("—").strip()
            return dest, credit
    return None, None


def get_music(cfg: Config) -> tuple[Path | None, str | None]:
    """Renvoie (chemin du morceau, crédit) ou (None, None)."""
    if not cfg.get("music", "enabled", default=True):
        return None, None
    source = str(cfg.get("music", "source", default="incompetech")).lower()
    mood = cfg.get("music", "mood", default=None)

    if source == "openverse":
        path, credit = _fetch_openverse(cfg, mood)
        if path:
            return path, credit
        log.info("Openverse indisponible -> incompetech.")
        source = "incompetech"

    if source == "incompetech":
        path, credit = _fetch_incompetech(cfg, mood)
        if path:
            return path, credit
        log.info("incompetech indisponible -> repli sur la musique locale.")

    path = _pick_music(cfg)
    return path, _local_credit(path)
