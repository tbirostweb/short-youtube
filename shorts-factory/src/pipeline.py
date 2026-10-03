"""Orchestration : de l'idée à la vidéo uploadée.

  pick topic -> script -> voix off -> fond -> montage -> metadata -> upload
"""
from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Optional

# Étapes exposées au dashboard pour l'affichage temps réel
Progress = Optional[Callable[[str], None]]

from .config import Config
from .database import Database
from .generators.metadata import MetadataGenerator
from .generators.script import ScriptGenerator
from .logger import get_logger
from .media import stock
from .media.builder import build_video
from .media.tts import synthesize
from .topics import load_topics, pick_next

log = get_logger(__name__)


def _slug(text: str) -> str:
    text = re.sub(r"[^\w\s-]", "", text.lower()).strip()
    return re.sub(r"[\s_-]+", "-", text)[:40] or "short"




class Pipeline:
    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self.db = Database(cfg.path("project", "db_path", default="data/shorts.db"))
        self.script_gen = ScriptGenerator(cfg)
        self.meta_gen = MetadataGenerator(cfg)
        self.output_dir = cfg.path("project", "output_dir", default="output")
        self.output_dir.mkdir(parents=True, exist_ok=True)

    # -----------------------------------------------------------------
    def next_topic(self) -> dict[str, Any] | None:
        topics = load_topics(self.cfg.path("project", "topics_file",
                                           default="data/topics.json"))
        if not topics:
            return None
        return pick_next(topics, self.db.used_topic_ids())

    # -----------------------------------------------------------------
    def generate(
        self,
        topic: dict[str, Any] | None = None,
        progress: Progress = None,
        overrides: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Produit une vidéo (sans upload). Renvoie l'enregistrement DB.

        `overrides` applique, POUR CETTE VIDÉO uniquement, des réglages
        spécifiques (voix, musique, fond, langue...) sans toucher la config
        globale — utilisé par le mode batch (une ligne Excel = une vidéo).
        """
        def step(name: str) -> None:
            if progress:
                progress(name)

        # Config effective de ce rendu (surcharges éventuelles)
        eff = self.cfg.clone_with(overrides) if overrides else self.cfg
        script_gen = ScriptGenerator(eff)
        meta_gen = MetadataGenerator(eff)

        step("topic")
        topic = topic or self.next_topic()
        if not topic:
            raise RuntimeError(
                "Aucun sujet disponible (tous traités ou data/topics.json vide). "
                "Ajoute des sujets ou supprime l'historique."
            )
        log.info("=== Sujet : %s (%s) ===", topic.get("topic"), topic["id"])

        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        base = self.output_dir / f"{stamp}_{_slug(topic.get('topic', topic['id']))}"
        voice_path = base.with_suffix(".mp3")
        video_path = base.with_suffix(".mp4")

        # 1) Script
        step("script")
        script = script_gen.generate(topic)
        log.info("Script (%d mots) : %s…", len(script.split()), script[:70])

        # 2) Voix off + timing des mots
        step("voice")
        voice_path, words = synthesize(script, voice_path, eff)

        # 3) Fond
        step("background")
        bg_path = stock.get_background(topic.get("keywords", []), eff)

        # Musique : on choisit le morceau MAINTENANT (et on le fixe) pour
        # pouvoir créditer automatiquement son auteur (CC BY) dans la description.
        from .media.music import get_music

        music_path, music_credit = get_music(eff)
        if music_path:
            eff = eff.clone_with({"music": {"file": str(music_path)}})

        # 4) Montage
        step("render")
        build_video(voice_path, words, video_path, eff, bg_path=bg_path)

        # La voix off est désormais muxée dans le MP4 : on supprime le MP3
        # intermédiaire (on ne garde que le .mp4 -> moins de place).
        try:
            Path(voice_path).unlink(missing_ok=True)
        except OSError:
            pass

        # 5) Metadata (+ crédit musique automatique pour respecter la CC BY)
        step("metadata")
        meta = meta_gen.generate(topic, script)
        if music_credit:
            meta["description"] = (
                meta["description"].rstrip() + "\n\n🎵 Musique : " + music_credit
            )

        # 6) Historique
        video_id = self.db.add_video(
            topic_id=topic["id"],
            topic=topic.get("topic", ""),
            title=meta["title"],
            description=meta["description"],
            tags=meta["tags"],
            file_path=str(video_path),
            status="rendered",
        )
        record = {
            "db_id": video_id,
            "topic_id": topic["id"],
            "title": meta["title"],
            "description": meta["description"],
            "tags": meta["tags"],
            "file_path": str(video_path),
            "script": script,
        }
        log.info("Vidéo prête (#%d) : %s", video_id, meta["title"])
        return record

    # -----------------------------------------------------------------
    def upload(self, record: dict[str, Any], settings: dict | None = None) -> str:
        """Upload un enregistrement produit par generate().

        `settings` cible une chaîne précise (token, confidentialité, catégorie,
        date de publication) — voir uploader.upload_video.
        """
        from .youtube.uploader import upload_video  # import tardif (dépendances)

        try:
            yt_id = upload_video(
                record["file_path"],
                record["title"],
                record["description"],
                record["tags"],
                self.cfg,
                settings=settings,
            )
            self.db.mark_uploaded(record["db_id"], yt_id)
            record["youtube_id"] = yt_id
            return yt_id
        except Exception as exc:  # noqa: BLE001
            self.db.mark_error(record["db_id"], str(exc))
            raise

    # -----------------------------------------------------------------
    def run_once(self, do_upload: bool = True, progress: Progress = None) -> dict[str, Any]:
        """Génère une vidéo et l'upload si demandé + autorisé par la config."""
        record = self.generate(progress=progress)
        upload_enabled = self.cfg.get("youtube", "enabled", default=True)
        if do_upload and upload_enabled:
            if progress:
                progress("upload")
            self.upload(record)
        elif do_upload and not upload_enabled:
            log.info("Upload désactivé dans la config (youtube.enabled=false).")
        if progress:
            progress("finished")
        return record

    def close(self) -> None:
        self.db.close()
