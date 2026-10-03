"""Planificateur autonome : publie X Shorts par jour aux heures définies."""
from __future__ import annotations

import random

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger

from .config import Config
from .logger import get_logger
from .pipeline import Pipeline

log = get_logger(__name__)


def _job(cfg: Config) -> None:
    pipeline = Pipeline(cfg)
    try:
        max_per_day = int(cfg.get("schedule", "max_per_day", default=3))
        done_today = pipeline.db.uploaded_today()
        if done_today >= max_per_day:
            log.info("Quota du jour atteint (%d/%d) — on saute.",
                     done_today, max_per_day)
            return

        jitter = int(cfg.get("schedule", "jitter_minutes", default=0))
        if jitter > 0:
            import time
            wait = random.randint(0, jitter * 60)
            log.info("Jitter : attente de %ds avant génération.", wait)
            time.sleep(wait)

        do_upload = bool(cfg.get("schedule", "upload", default=True))
        pipeline.run_once(do_upload=do_upload)
    except Exception as exc:  # noqa: BLE001 - un job qui plante ne tue pas le loop
        log.error("Job planifié en erreur : %s", exc)
    finally:
        pipeline.close()


def start_scheduler(cfg: Config) -> None:
    times = cfg.get("schedule", "times", default=["09:00", "13:00", "18:30"])
    scheduler = BlockingScheduler(timezone=None)  # fuseau du serveur

    for t in times:
        hour, minute = (int(x) for x in t.split(":"))
        scheduler.add_job(
            _job, CronTrigger(hour=hour, minute=minute),
            args=[cfg], id=f"short-{t}", max_instances=1, coalesce=True,
        )
        log.info("Créneau planifié : %02d:%02d", hour, minute)

    log.info("Scheduler démarré. Ctrl+C pour arrêter.")
    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        log.info("Scheduler arrêté.")
