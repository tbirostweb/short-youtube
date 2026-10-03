"""Upload d'une vidéo sur YouTube (Data API v3, upload résumable)."""
from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from googleapiclient.errors import HttpError
from googleapiclient.http import MediaFileUpload

from ..config import Config
from ..logger import get_logger
from .auth import get_service

log = get_logger(__name__)

_RETRIABLE = {500, 502, 503, 504}


def upload_video(
    file_path: str | Path,
    title: str,
    description: str,
    tags: list[str],
    cfg: Config,
    settings: dict | None = None,
) -> str:
    """Upload la vidéo et renvoie l'ID YouTube.

    `settings` (optionnel) surcharge la config `youtube` pour cibler une
    chaîne : privacy, category_id, made_for_kids, token_file, client_secret,
    et publish_at (datetime absolu de programmation).
    """
    file_path = Path(file_path)
    if not file_path.exists():
        raise FileNotFoundError(file_path)

    yt = {**cfg.section("youtube"), **(settings or {})}
    privacy = yt.get("privacy", "private")
    delay_h = int(yt.get("publish_delay_hours", 0))

    status: dict = {
        "privacyStatus": privacy,
        "selfDeclaredMadeForKids": bool(yt.get("made_for_kids", False)),
    }
    # Programmation : YouTube exige privacyStatus=private + publishAt (UTC ISO).
    # Priorité à une date absolue (publish_at), sinon délai en heures.
    publish_at = yt.get("publish_at")
    if publish_at is not None:
        if isinstance(publish_at, datetime):
            if publish_at.tzinfo is None:
                publish_at = publish_at.replace(tzinfo=timezone.utc)
            iso = publish_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        else:
            iso = str(publish_at)
        status["privacyStatus"] = "private"
        status["publishAt"] = iso
        log.info("Publication programmée pour %s.", iso)
    elif delay_h > 0:
        when = datetime.now(timezone.utc) + timedelta(hours=delay_h)
        status["privacyStatus"] = "private"
        status["publishAt"] = when.isoformat().replace("+00:00", "Z")
        log.info("Publication programmée pour %s (UTC).", status["publishAt"])

    body = {
        "snippet": {
            "title": title[:100],
            "description": description[:5000],
            "tags": tags,
            "categoryId": str(yt.get("category_id", "22")),
        },
        "status": status,
    }

    service = get_service(
        cfg,
        interactive=False,
        token_file=yt.get("token_file"),
        client_secret=yt.get("client_secret"),
    )
    media = MediaFileUpload(str(file_path), chunksize=-1, resumable=True)
    request = service.videos().insert(
        part="snippet,status", body=body, media_body=media
    )

    log.info("Upload YouTube : « %s »…", title)
    response = None
    error_retries = 0
    while response is None:
        try:
            _, response = request.next_chunk()
        except HttpError as exc:
            if exc.resp.status in _RETRIABLE and error_retries < 5:
                error_retries += 1
                sleep = 2 ** error_retries
                log.warning("Erreur %s -> retry dans %ss", exc.resp.status, sleep)
                time.sleep(sleep)
                continue
            raise
    video_id = response["id"]
    log.info("Uploadé : https://youtu.be/%s", video_id)
    return video_id
