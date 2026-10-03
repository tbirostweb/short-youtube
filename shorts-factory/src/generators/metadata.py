"""Génération des métadonnées YouTube : titre, description, tags."""
from __future__ import annotations

import re

from ..config import Config
from ..logger import get_logger

log = get_logger(__name__)

MAX_TITLE = 95  # YouTube limite à 100, on garde de la marge pour #Shorts


def _first_sentence(script: str) -> str:
    m = re.split(r"(?<=[.!?])\s", script.strip())
    return m[0] if m else script[:80]


def _fallback(topic: dict, script: str, cfg: Config) -> dict:
    base = topic.get("title") or topic.get("topic") or _first_sentence(script)
    base = base.strip().rstrip(".")
    title = base[:MAX_TITLE]

    hashtags = topic.get("hashtags") or []
    default_tags = cfg.get("youtube", "default_tags", default=[])
    tags = list(dict.fromkeys([*topic.get("keywords", []), *default_tags]))

    description = script.strip()
    if hashtags:
        description += "\n\n" + " ".join(hashtags)

    return {"title": title, "description": description, "tags": tags}


def _llm(topic: dict, script: str, cfg: Config) -> dict | None:
    provider = cfg.get("script", "provider", default="anthropic")
    has_key = cfg.anthropic_key if provider == "anthropic" else cfg.openai_key
    if not has_key:
        return None

    lang = cfg.get("script", "language", default="fr")
    prompt = (
        "À partir de ce script de Short, produis des métadonnées YouTube.\n"
        f"Langue : {lang}. Réponds STRICTEMENT en JSON, sans texte autour, "
        'au format : {"title": "...", "description": "...", "tags": ["...", "..."]}. '
        f"Titre accrocheur < {MAX_TITLE} caractères. Description courte + hashtags. "
        "8 à 12 tags pertinents.\n\n"
        f"SCRIPT:\n{script}"
    )
    try:
        if provider == "anthropic":
            import anthropic

            client = anthropic.Anthropic(api_key=cfg.anthropic_key)
            resp = client.messages.create(
                model=cfg.get("script", "anthropic_model", default="claude-sonnet-4-6"),
                max_tokens=500,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = "".join(
                b.text for b in resp.content if getattr(b, "type", "") == "text"
            )
        else:
            from openai import OpenAI

            client = OpenAI(api_key=cfg.openai_key)
            resp = client.chat.completions.create(
                model=cfg.get("script", "openai_model", default="gpt-4o-mini"),
                max_tokens=500,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = resp.choices[0].message.content or ""

        import json

        cleaned = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.MULTILINE)
        data = json.loads(cleaned.strip())
        return {
            "title": str(data.get("title", ""))[:MAX_TITLE],
            "description": str(data.get("description", "")),
            "tags": [str(t) for t in data.get("tags", [])][:15],
        }
    except Exception as exc:  # noqa: BLE001 - on retombe proprement
        log.warning("Metadata LLM échouée (%s) -> fallback.", exc)
        return None


class MetadataGenerator:
    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg

    def generate(self, topic: dict, script: str) -> dict:
        # Si un titre est fourni (ex: colonne "titre" de l'Excel), on respecte
        # le choix de l'utilisateur et on n'appelle PAS le LLM pour l'inventer.
        if topic.get("title"):
            data = _fallback(topic, script, self.cfg)
            if topic.get("description"):
                data["description"] = str(topic["description"])
            if topic.get("tags"):
                data["tags"] = [str(t) for t in topic["tags"]]
        else:
            data = _llm(topic, script, self.cfg) or _fallback(topic, script, self.cfg)

        # Ajoute le tag Shorts au titre et à la description
        shorts_tag = self.cfg.get("youtube", "shorts_tag", default="#Shorts")
        if shorts_tag and shorts_tag.lower() not in data["title"].lower():
            room = 100 - len(shorts_tag) - 1
            data["title"] = data["title"][:room].rstrip() + " " + shorts_tag
        if shorts_tag and shorts_tag.lower() not in data["description"].lower():
            data["description"] = data["description"].rstrip() + "\n\n" + shorts_tag

        # Nettoyage des tags (YouTube : 500 caractères cumulés max)
        tags, total = [], 0
        for t in data.get("tags", []):
            t = t.strip().lstrip("#")
            if not t:
                continue
            total += len(t) + 1
            if total > 480:
                break
            tags.append(t)
        data["tags"] = tags
        return data
