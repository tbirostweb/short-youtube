"""Chargement et sélection des sujets à transformer en Shorts."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def load_topics(path: str | Path) -> list[dict[str, Any]]:
    p = Path(path)
    if not p.exists():
        return []
    with open(p, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, list):
        raise ValueError("topics.json doit contenir une liste d'objets.")
    # Normalisation : chaque topic a au minimum un id
    for i, t in enumerate(data):
        t.setdefault("id", f"topic-{i+1}")
        t.setdefault("keywords", [])
        t.setdefault("hashtags", [])
    return data


def pick_next(topics: list[dict[str, Any]], used_ids: set[str]) -> dict[str, Any] | None:
    """Renvoie le premier sujet non encore traité, sinon None."""
    for t in topics:
        if t["id"] not in used_ids:
            return t
    return None
