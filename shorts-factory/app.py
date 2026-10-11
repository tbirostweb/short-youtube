"""Dashboard web (FastAPI) : suivre l'historique et lancer une génération.

Démarrage : python main.py serve   (puis http://localhost:8000)
"""
from __future__ import annotations

import base64
import os
import secrets
import shutil
import tempfile
import threading
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import Body, FastAPI, File, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from src.config import load_config
from src.database import Database
from src.logger import get_logger

log = get_logger("dashboard")

cfg = load_config()
ROOT = Path(__file__).resolve().parent
OUTPUT_DIR = cfg.path("project", "output_dir", default="output")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Shorts Factory")

# --- Authentification (recommandée en ligne) -------------------------
# Si DASHBOARD_PASSWORD est défini (ex. déploiement Dokploy), tout le
# dashboard est protégé par un login/mot de passe. Vide en local = ouvert.
_DASH_USER = os.getenv("DASHBOARD_USER", "admin")
_DASH_PASS = os.getenv("DASHBOARD_PASSWORD")


@app.middleware("http")
async def _basic_auth(request, call_next):
    if _DASH_PASS:
        header = request.headers.get("authorization", "")
        ok = False
        if header.startswith("Basic "):
            try:
                user, _, pwd = base64.b64decode(header[6:]).decode().partition(":")
                ok = (secrets.compare_digest(user, _DASH_USER)
                      and secrets.compare_digest(pwd, _DASH_PASS))
            except Exception:  # noqa: BLE001
                ok = False
        if not ok:
            return Response(
                "Authentification requise.", status_code=401,
                headers={"WWW-Authenticate": 'Basic realm="Shorts Factory"'},
            )
    return await call_next(request)


app.mount("/media", StaticFiles(directory=str(OUTPUT_DIR)), name="media")
app.mount("/static", StaticFiles(directory=str(ROOT / "static")), name="static")

# --- état du job en cours (un seul à la fois) ---
_job = {"running": False, "phase": "idle", "message": "", "video": None, "error": None}
_lock = threading.Lock()


def _run_job(do_upload: bool) -> None:
    from src.pipeline import Pipeline

    pipeline = Pipeline(cfg)

    def progress(phase: str) -> None:
        _job["phase"] = phase

    try:
        _job.update(running=True, phase="topic", message="Génération en cours…",
                    video=None, error=None)
        record = pipeline.run_once(do_upload=do_upload, progress=progress)
        _job.update(
            phase="finished",
            message="Terminé",
            video={
                "title": record["title"],
                "file": Path(record["file_path"]).name,
                "youtube_id": record.get("youtube_id"),
            },
        )
    except Exception as exc:  # noqa: BLE001
        log.error("Job dashboard en erreur : %s", exc)
        _job.update(phase="error", error=str(exc), message="Erreur")
    finally:
        _job["running"] = False
        pipeline.close()


def _run_custom_job(topic: dict[str, Any], overrides: dict[str, Any], do_upload: bool) -> None:
    """Génère une vidéo à partir des infos saisies dans l'interface."""
    from src.pipeline import Pipeline

    pipeline = Pipeline(cfg)

    def progress(phase: str) -> None:
        _job["phase"] = phase

    try:
        _job.update(running=True, phase="topic", message="Génération en cours…",
                    video=None, error=None)
        record = pipeline.generate(topic, progress=progress, overrides=overrides)
        if do_upload and cfg.get("youtube", "enabled", default=True):
            progress("upload")
            pipeline.upload(record)
        progress("finished")
        _job.update(
            phase="finished", message="Terminé",
            video={
                "title": record["title"],
                "file": Path(record["file_path"]).name,
                "youtube_id": record.get("youtube_id"),
            },
        )
    except Exception as exc:  # noqa: BLE001
        log.error("Génération interface en erreur : %s", exc)
        _job.update(phase="error", error=str(exc), message="Erreur")
    finally:
        _job["running"] = False
        pipeline.close()


def _split(value: str | None) -> list[str]:
    return [x.strip() for x in (value or "").replace(";", ",").split(",") if x.strip()]


# Voix proposées dans l'interface (les plus naturelles d'edge-tts en tête)
VOICES = [
    # --- Français (les + naturelles d'abord) ---
    {"id": "fr-FR-RemyMultilingualNeural", "label": "FR · Rémy — naturel (H) ⭐"},
    {"id": "fr-FR-VivienneMultilingualNeural", "label": "FR · Vivienne — naturel (F) ⭐"},
    {"id": "fr-FR-HenriNeural", "label": "FR · Henri (H)"},
    {"id": "fr-FR-DeniseNeural", "label": "FR · Denise (F)"},
    {"id": "fr-FR-EloiseNeural", "label": "FR · Éloïse (F, douce)"},
    {"id": "fr-CA-JeanNeural", "label": "FR-CA · Jean (H, québécois)"},
    {"id": "fr-CA-SylvieNeural", "label": "FR-CA · Sylvie (F, québécois)"},
    # --- English (most natural first) ---
    {"id": "en-US-AndrewMultilingualNeural", "label": "EN · Andrew — natural (M) ⭐"},
    {"id": "en-US-AvaMultilingualNeural", "label": "EN · Ava — natural (F) ⭐"},
    {"id": "en-US-BrianMultilingualNeural", "label": "EN · Brian — natural (M)"},
    {"id": "en-US-EmmaMultilingualNeural", "label": "EN · Emma — natural (F)"},
    {"id": "en-US-GuyNeural", "label": "EN-US · Guy (M)"},
    {"id": "en-US-AriaNeural", "label": "EN-US · Aria (F)"},
    {"id": "en-GB-RyanNeural", "label": "EN-GB · Ryan (M, british)"},
    {"id": "en-GB-SoniaNeural", "label": "EN-GB · Sonia (F, british)"},
    {"id": "en-AU-NatashaNeural", "label": "EN-AU · Natasha (F, aussie)"},
]
_VOICE_IDS = {v["id"] for v in VOICES}


@app.get("/", response_class=HTMLResponse)
def index() -> str:
    return (ROOT / "templates" / "dashboard.html").read_text(encoding="utf-8")


@app.get("/api/voices")
def voices_list() -> JSONResponse:
    return JSONResponse(VOICES)


@app.get("/api/voice_preview")
def voice_preview(voice: str):
    """Synthétise un court échantillon de la voix (bouton « écouter »)."""
    import asyncio
    import re as _re

    import edge_tts

    if voice not in _VOICE_IDS:
        return JSONResponse({"error": "voix inconnue"}, status_code=400)
    sample = ("Voici un aperçu de cette voix, pour t'aider à choisir."
              if voice.startswith("fr")
              else "Here is a quick preview of this voice, to help you choose.")
    safe = _re.sub(r"[^A-Za-z0-9]", "", voice)
    tmp = Path(tempfile.gettempdir()) / f"preview_{safe}.mp3"

    async def _go() -> None:
        await edge_tts.Communicate(sample, voice=voice, rate="+6%").save(str(tmp))

    try:
        asyncio.run(_go())
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=502)
    return FileResponse(str(tmp), media_type="audio/mpeg")


@app.post("/api/generate")
def generate(payload: dict = Body(...)) -> JSONResponse:
    """Génère une vidéo depuis les infos saisies dans l'interface."""
    script = (payload.get("script") or "").strip()
    title = (payload.get("title") or "").strip()
    theme = (payload.get("topic") or "").strip()
    if not script and not theme:
        return JSONResponse(
            {"started": False, "reason": "Donne au moins un script, ou un thème."},
            status_code=400,
        )
    topic: dict[str, Any] = {
        "id": "ui-" + datetime.now().strftime("%Y%m%d%H%M%S"),
        "topic": theme or title or "short",
        "title": title or None,
        "keywords": _split(payload.get("keywords")),
        "hashtags": _split(payload.get("hashtags")),
        "script": script or None,
    }
    overrides: dict[str, Any] = {}
    if payload.get("voice"):
        overrides["tts"] = {"voice": payload["voice"]}
    if payload.get("language"):
        overrides.setdefault("script", {})["language"] = payload["language"]
    if payload.get("background"):
        overrides["background"] = {"source": payload["background"]}
    if payload.get("mood"):
        overrides["music"] = {"mood": payload["mood"]}

    do_upload = bool(payload.get("upload", False))
    with _lock:
        if _job["running"]:
            return JSONResponse(
                {"started": False, "reason": "Un job est déjà en cours."},
                status_code=409,
            )
        thread = threading.Thread(
            target=_run_custom_job, args=(topic, overrides, do_upload), daemon=True
        )
        thread.start()
    return JSONResponse({"started": True})


# ---------------------------------------------------------------------
#  Mode Excel : modèle à télécharger + import d'un lot
# ---------------------------------------------------------------------
@app.get("/api/template")
def download_template() -> FileResponse:
    """Renvoie un modèle Excel vide (colonnes à remplir) à télécharger."""
    from tools.make_template import make_template

    tmp = Path(tempfile.gettempdir()) / "shorts_template.xlsx"
    make_template(str(tmp))
    return FileResponse(
        str(tmp),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename="modele_shorts.xlsx",
    )


def _run_batch_job(xlsx_path: str, do_upload: bool) -> None:
    from src.batch import run_batch

    def on_row(i: int, total: int, title: str) -> None:
        _job.update(phase="render", message=f"Lot : {i}/{total} — {title}")

    try:
        _job.update(running=True, phase="topic", message="Lecture du fichier…",
                    video=None, error=None, batch=None)
        recap = run_batch(cfg, xlsx_path, do_upload=do_upload, on_row=on_row)
        _job.update(
            phase="finished",
            message=f"Lot terminé : {recap['ok']} générée(s), "
                    f"{recap['uploaded']} uploadée(s), {recap['failed']} échec(s).",
            batch=recap, video=None,
        )
    except Exception as exc:  # noqa: BLE001
        log.error("Lot en erreur : %s", exc)
        _job.update(phase="error", error=str(exc), message="Erreur")
    finally:
        _job["running"] = False
        try:
            Path(xlsx_path).unlink(missing_ok=True)
        except OSError:
            pass


@app.post("/api/batch")
def batch(file: UploadFile = File(...), upload: bool = False) -> JSONResponse:
    """Reçoit un Excel rempli et génère un Short par ligne."""
    name = (file.filename or "").lower()
    if not name.endswith((".xlsx", ".xlsm")):
        return JSONResponse(
            {"started": False, "reason": "Envoie un fichier .xlsx."}, status_code=400
        )
    tmp = Path(tempfile.gettempdir()) / ("batch_" + datetime.now().strftime("%H%M%S") + ".xlsx")
    with open(tmp, "wb") as out:
        shutil.copyfileobj(file.file, out)
    with _lock:
        if _job["running"]:
            return JSONResponse(
                {"started": False, "reason": "Un job est déjà en cours."},
                status_code=409,
            )
        thread = threading.Thread(
            target=_run_batch_job, args=(str(tmp), upload), daemon=True
        )
        thread.start()
    return JSONResponse({"started": True})


# ---------------------------------------------------------------------
#  Analytics (APERÇU — données factices tant que YouTube n'est pas connecté)
# ---------------------------------------------------------------------
@app.get("/analytics", response_class=HTMLResponse)
def analytics_page() -> str:
    return (ROOT / "templates" / "analytics.html").read_text(encoding="utf-8")


@app.get("/api/analytics")
def analytics_data() -> JSONResponse:
    """Données d'aperçu (mock). À remplacer par l'API YouTube Analytics."""
    import random

    def series(base: int, n: int = 14, growth: float = 1.0) -> list[int]:
        out, v = [], base
        for _ in range(n):
            v = max(0, int(v * (0.9 + random.random() * 0.35) * growth))
            out.append(v)
        return out

    channels = [
        {"id": "fr1", "name": "FR — Chaîne 1", "lang": "fr"},
        {"id": "fr2", "name": "FR — Chaîne 2", "lang": "fr"},
        {"id": "en1", "name": "EN — Channel 1", "lang": "en"},
        {"id": "en2", "name": "EN — Channel 2", "lang": "en"},
    ]
    per_channel = []
    for c in channels:
        views = series(random.randint(4000, 22000), growth=1.05)
        per_channel.append({
            **c,
            "subscribers": random.randint(320, 9800),
            "sub_delta": random.randint(15, 480),
            "views_30d": sum(views) * 2,
            "revenue_30d": round(sum(views) * 2 / 1000 * random.uniform(0.15, 1.1), 2),
            "avg_retention": random.randint(38, 72),
            "views_series": views,
            "videos": random.randint(12, 60),
        })
    total = {
        "subscribers": sum(c["subscribers"] for c in per_channel),
        "views_30d": sum(c["views_30d"] for c in per_channel),
        "revenue_30d": round(sum(c["revenue_30d"] for c in per_channel), 2),
        "videos": sum(c["videos"] for c in per_channel),
    }
    return JSONResponse({"mock": True, "total": total, "channels": per_channel})


@app.get("/api/status")
def status() -> JSONResponse:
    db = Database(cfg.path("project", "db_path", default="data/shorts.db"))
    provider = cfg.get("script", "provider", default="anthropic")
    has_llm = bool(cfg.anthropic_key if provider == "anthropic" else cfg.openai_key)
    data = {
        "uploaded_today": db.uploaded_today(),
        "max_per_day": cfg.get("schedule", "max_per_day", default=3),
        "upload_enabled": cfg.get("youtube", "enabled", default=True),
        "privacy": cfg.get("youtube", "privacy", default="private"),
        "script_source": provider if has_llm else "templates (topics.json)",
        "background_source": cfg.get("background", "source", default="auto"),
        "pexels": bool(cfg.pexels_key),
    }
    db.close()
    return JSONResponse(data)


@app.get("/api/videos")
def videos() -> JSONResponse:
    db = Database(cfg.path("project", "db_path", default="data/shorts.db"))
    rows = db.recent(limit=50)
    db.close()
    return JSONResponse(rows)


@app.get("/api/job")
def job() -> JSONResponse:
    return JSONResponse(_job)


@app.post("/api/run")
def run(upload: bool = True) -> JSONResponse:
    with _lock:
        if _job["running"]:
            return JSONResponse(
                {"started": False, "reason": "Un job est déjà en cours."},
                status_code=409,
            )
        thread = threading.Thread(target=_run_job, args=(upload,), daemon=True)
        thread.start()
    return JSONResponse({"started": True})
