"""Traduction du script + métadonnées d'une langue à l'autre (via LLM).

Sert à dupliquer un Short FR sur une chaîne EN (ou l'inverse) : on traduit
le texte, puis le pipeline régénère la voix et le montage dans la 2e langue.
Nécessite une clé LLM (ANTHROPIC_API_KEY ou OPENAI_API_KEY).
"""
from __future__ import annotations

import json
import re

from ..config import Config
from ..logger import get_logger

log = get_logger(__name__)

_LANG_NAMES = {
    "fr": "français", "en": "anglais", "es": "espagnol",
    "de": "allemand", "it": "italien", "pt": "portugais", "nl": "néerlandais",
}


def _lang_name(code: str) -> str:
    return _LANG_NAMES.get((code or "").lower(), code)


def has_llm(cfg: Config) -> bool:
    return bool(cfg.anthropic_key or cfg.openai_key)


def _call_llm(prompt: str, cfg: Config) -> str:
    provider = cfg.get("script", "provider", default="anthropic")
    # On respecte le provider choisi si sa clé existe, sinon on prend l'autre.
    if provider == "anthropic" and cfg.anthropic_key:
        import anthropic

        client = anthropic.Anthropic(api_key=cfg.anthropic_key)
        resp = client.messages.create(
            model=cfg.get("script", "anthropic_model", default="claude-sonnet-4-6"),
            max_tokens=900,
            messages=[{"role": "user", "content": prompt}],
        )
        return "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
    if cfg.openai_key:
        from openai import OpenAI

        client = OpenAI(api_key=cfg.openai_key)
        resp = client.chat.completions.create(
            model=cfg.get("script", "openai_model", default="gpt-4o-mini"),
            max_tokens=900,
            messages=[{"role": "user", "content": prompt}],
        )
        return resp.choices[0].message.content or ""
    if cfg.anthropic_key:  # provider=openai mais seule la clé anthropic existe
        import anthropic

        client = anthropic.Anthropic(api_key=cfg.anthropic_key)
        resp = client.messages.create(
            model=cfg.get("script", "anthropic_model", default="claude-sonnet-4-6"),
            max_tokens=900,
            messages=[{"role": "user", "content": prompt}],
        )
        return "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
    raise RuntimeError(
        "Traduction impossible : aucune clé LLM dans .env "
        "(ANTHROPIC_API_KEY ou OPENAI_API_KEY)."
    )


def translate_bundle(
    script: str,
    title: str,
    description: str,
    target_lang: str,
    cfg: Config,
) -> dict:
    """Traduit script/titre/description vers `target_lang`. Renvoie un dict."""
    lang = _lang_name(target_lang)
    prompt = (
        f"Traduis ce contenu de YouTube Short en {lang}. "
        "Ne traduis pas mot à mot : adapte pour que ce soit naturel et percutant "
        "dans la langue cible, garde le rythme et le ton dynamique, garde les "
        "hashtags pertinents. "
        'Réponds STRICTEMENT en JSON, sans texte autour : '
        '{"script": "...", "title": "...", "description": "..."}.\n\n'
        f"TITRE:\n{title}\n\nDESCRIPTION:\n{description}\n\nSCRIPT:\n{script}"
    )
    raw = _call_llm(prompt, cfg)
    cleaned = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.MULTILINE).strip()
    try:
        data = json.loads(cleaned)
        return {
            "script": str(data.get("script", "")).strip(),
            "title": str(data.get("title", "")).strip(),
            "description": str(data.get("description", "")).strip(),
        }
    except json.JSONDecodeError:
        # Repli : au pire on considère toute la réponse comme le script traduit.
        log.warning("Réponse de traduction non-JSON, repli sur script brut.")
        return {"script": cleaned, "title": title, "description": description}
