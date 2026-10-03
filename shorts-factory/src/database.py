"""Historique des vidéos générées (SQLite).

Sert à : garder la trace de ce qui a été produit/uploadé, éviter de
retraiter deux fois le même sujet, et alimenter le dashboard.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS videos (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_id      TEXT,
    topic         TEXT,
    title         TEXT,
    description   TEXT,
    tags          TEXT,
    file_path     TEXT,
    status        TEXT DEFAULT 'rendered',   -- rendered | uploaded | error
    youtube_id    TEXT,
    error         TEXT,
    created_at    TEXT,
    uploaded_at   TEXT
);
"""


class Database:
    def __init__(self, db_path: str | Path) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        # timeout + WAL : le dashboard peut lire pendant qu'une génération
        # écrit (processus séparés) sans « database is locked ».
        self._conn = sqlite3.connect(
            str(self.db_path), check_same_thread=False, timeout=10.0
        )
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA busy_timeout = 8000")
        try:
            self._conn.execute("PRAGMA journal_mode = WAL")
        except sqlite3.OperationalError:
            pass
        self._conn.execute(_SCHEMA)
        self._conn.commit()

    # ---------------------------------------------------------------
    def add_video(self, **fields: Any) -> int:
        fields.setdefault("created_at", _now())
        if isinstance(fields.get("tags"), (list, tuple)):
            fields["tags"] = json.dumps(list(fields["tags"]), ensure_ascii=False)
        cols = ", ".join(fields)
        placeholders = ", ".join(["?"] * len(fields))
        cur = self._conn.execute(
            f"INSERT INTO videos ({cols}) VALUES ({placeholders})",
            list(fields.values()),
        )
        self._conn.commit()
        return int(cur.lastrowid)

    def update(self, video_id: int, **fields: Any) -> None:
        if not fields:
            return
        assignments = ", ".join(f"{k} = ?" for k in fields)
        self._conn.execute(
            f"UPDATE videos SET {assignments} WHERE id = ?",
            [*fields.values(), video_id],
        )
        self._conn.commit()

    def mark_uploaded(self, video_id: int, youtube_id: str) -> None:
        self.update(
            video_id,
            status="uploaded",
            youtube_id=youtube_id,
            uploaded_at=_now(),
        )

    def mark_error(self, video_id: int, message: str) -> None:
        self.update(video_id, status="error", error=str(message)[:1000])

    # ---------------------------------------------------------------
    def used_topic_ids(self) -> set[str]:
        """Sujets déjà rendus ou uploadés (à ne pas refaire)."""
        rows = self._conn.execute(
            "SELECT DISTINCT topic_id FROM videos WHERE topic_id IS NOT NULL"
        ).fetchall()
        return {r["topic_id"] for r in rows if r["topic_id"]}

    def uploaded_today(self) -> int:
        today = date.today().isoformat()
        row = self._conn.execute(
            "SELECT COUNT(*) AS n FROM videos "
            "WHERE status = 'uploaded' AND substr(uploaded_at, 1, 10) = ?",
            (today,),
        ).fetchone()
        return int(row["n"]) if row else 0

    def recent(self, limit: int = 50) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            "SELECT * FROM videos ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            if d.get("tags"):
                try:
                    d["tags"] = json.loads(d["tags"])
                except (json.JSONDecodeError, TypeError):
                    pass
            out.append(d)
        return out

    def close(self) -> None:
        self._conn.close()
