"""Récupère une vidéo de fond verticale (b-roll).

Sources possibles (config `background.source`) :
  - "pexels"  : clip via l'API Pexels (gratuit, PEXELS_API_KEY) — portrait
  - "pixabay" : clip via l'API Pixabay (gratuit, PIXABAY_API_KEY)
  - "local"   : pioche un clip au hasard dans un dossier
  - "color"   : pas de vidéo -> le builder génère un fond de couleur
  - "auto"    : Pexels + Pixabay (ordre aléatoire pour varier), sinon local, sinon color
"""
from __future__ import annotations

import hashlib
import random
from pathlib import Path

import requests

from ..config import Config
from ..logger import get_logger

log = get_logger(__name__)

_VIDEO_EXT = {".mp4", ".mov", ".mkv", ".webm", ".m4v"}


def _pick_local(local_dir: Path) -> Path | None:
    if not local_dir.exists():
        return None
    clips = [p for p in local_dir.iterdir() if p.suffix.lower() in _VIDEO_EXT]
    if not clips:
        return None
    choice = random.choice(clips)
    log.info("Fond : clip local %s", choice.name)
    return choice


def _download_to_cache(url: str, cache_dir: Path, provider: str, query: str) -> Path | None:
    """Télécharge une vidéo (avec cache par URL). Renvoie le chemin ou None."""
    fname = hashlib.md5(url.encode()).hexdigest()[:16] + ".mp4"
    dest = cache_dir / fname
    if dest.exists() and dest.stat().st_size > 0:
        log.info("Fond : %s (cache) %s", provider, fname)
        return dest
    log.info("Fond : téléchargement %s « %s »…", provider, query)
    try:
        with requests.get(url, stream=True, timeout=120) as r:
            r.raise_for_status()
            with open(dest, "wb") as fh:
                for block in r.iter_content(chunk_size=1 << 16):
                    fh.write(block)
    except requests.RequestException as exc:
        log.warning("Échec téléchargement %s (%s).", provider, exc)
        dest.unlink(missing_ok=True)
        return None
    return dest


def _fetch_pexels(query: str, cache_dir: Path, cfg: Config) -> Path | None:
    key = cfg.pexels_key
    if not key:
        return None
    query = query or "abstract background"
    try:
        resp = requests.get(
            "https://api.pexels.com/videos/search",
            headers={"Authorization": key},
            params={
                "query": query,
                "orientation": "portrait",
                "size": "medium",
                "per_page": 20,
            },
            timeout=30,
        )
        resp.raise_for_status()
        videos = resp.json().get("videos", [])
    except requests.RequestException as exc:
        log.warning("Pexels indisponible (%s).", exc)
        return None

    if not videos:
        log.warning("Aucun résultat Pexels pour « %s ».", query)
        return None

    # Efficacité : on écarte les clips très courts (souvent des illustrations /
    # loops graphiques, ex. une carte « SAVINGS ») pour ne garder que de vraies
    # scènes filmées -> meilleure qualité et meilleure rétention.
    real = [v for v in videos if 6 <= (v.get("duration") or 0) <= 60]
    video = random.choice(real or videos)
    # Choisit le fichier portrait le plus adapté (hauteur >= 1280)
    files = sorted(
        video.get("video_files", []),
        key=lambda f: (f.get("height") or 0),
    )
    best = None
    for f in files:
        h = f.get("height") or 0
        w = f.get("width") or 0
        if h >= w and h >= 1280:
            best = f
            break
    best = best or (files[-1] if files else None)
    if not best or not best.get("link"):
        return None
    return _download_to_cache(best["link"], cache_dir, "Pexels", query)


def _fetch_pixabay(query: str, cache_dir: Path, cfg: Config) -> Path | None:
    key = cfg.pixabay_key
    if not key:
        return None
    query = (query or "abstract")[:100]
    try:
        resp = requests.get(
            "https://pixabay.com/api/videos/",
            params={"key": key, "q": query, "per_page": 40, "safesearch": "true"},
            timeout=30,
        )
        resp.raise_for_status()
        hits = resp.json().get("hits", [])
    except (requests.RequestException, ValueError) as exc:
        log.warning("Pixabay indisponible (%s).", exc)
        return None

    if not hits:
        log.warning("Aucun résultat Pixabay pour « %s ».", query)
        return None

    # Même filtre anti-illustration (durée) que Pexels.
    real = [h for h in hits if 6 <= (h.get("duration") or 0) <= 60]
    hit = random.choice(real or hits)
    vids = hit.get("videos", {})
    # Pixabay est surtout paysage : le builder recadre en 9:16. On prend la
    # meilleure définition dispo.
    pick = vids.get("large") or vids.get("medium") or vids.get("small") or vids.get("tiny")
    if not pick or not pick.get("url"):
        return None
    return _download_to_cache(pick["url"], cache_dir, "Pixabay", query)


def _local_choice(local_dir: Path, cfg: Config) -> Path | None:
    """Clip local : fichier imposé (background.local_file) ou choix aléatoire."""
    fixed = cfg.get("background", "local_file", default=None)
    if fixed and str(fixed).strip():
        cand = Path(str(fixed).strip())
        if not cand.is_absolute():
            cand = local_dir / cand
        if cand.exists():
            log.info("Fond : clip local imposé %s", cand.name)
            return cand
        log.warning("Clip « %s » introuvable -> choix aléatoire.", fixed)
    return _pick_local(local_dir)


def get_background(keywords: list[str], cfg: Config) -> Path | None:
    """Renvoie un chemin de vidéo de fond, ou None (=> fond de couleur)."""
    source = cfg.get("background", "source", default="auto")
    local_dir = cfg.path("background", "local_dir", default="data/assets/broll")
    cache_dir = cfg.path("project", "db_path").parent / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)

    query = cfg.get("background", "pexels_query", default="") or " ".join(keywords[:3])

    if source == "color":
        return None
    if source == "local":
        return _local_choice(local_dir, cfg)
    if source == "pexels":
        return _fetch_pexels(query, cache_dir, cfg)
    if source == "pixabay":
        return _fetch_pixabay(query, cache_dir, cfg)

    # auto : clip imposé > Pexels + Pixabay (ordre aléatoire) > local > couleur
    if cfg.get("background", "local_file"):
        fixed = _local_choice(local_dir, cfg)
        if fixed:
            return fixed
    providers = [_fetch_pexels, _fetch_pixabay]
    random.shuffle(providers)  # varie la source d'une vidéo à l'autre
    for fetch in providers:
        clip = fetch(query, cache_dir, cfg)
        if clip:
            return clip
    clip = _pick_local(local_dir)
    if clip:
        return clip
    log.info("Fond : couleur unie (aucun clip disponible).")
    return None
