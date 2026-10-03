"""Génération du script parlé (voix off).

Trois modes (config `script.mode`) :
  - "manual" : utilise le champ `script` du topic tel quel.
  - "llm"    : génère via Anthropic ou OpenAI (clé requise).
  - "auto"   : LLM si une clé existe, sinon retombe sur `script`/template.
"""
from __future__ import annotations

import re

from ..config import Config
from ..logger import get_logger

log = get_logger(__name__)


def _clean(text: str) -> str:
    """Nettoie le texte pour la TTS (pas d'emojis, espaces propres)."""
    text = re.sub(r"[\U0001F000-\U0001FAFF\u2600-\u27BF]", "", text)  # emojis
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _template_script(topic: dict) -> str:
    """Construit un script simple à partir des champs du topic (sans LLM)."""
    if topic.get("script"):
        return _clean(topic["script"])

    parts: list[str] = []
    if topic.get("hook"):
        parts.append(topic["hook"])
    parts.append(topic.get("topic", ""))
    for point in topic.get("points", []):
        parts.append(point)
    parts.append(topic.get("cta", "Abonne-toi pour la suite."))
    return _clean(". ".join(p.strip(" .") for p in parts if p))


def _prompt(topic: dict, cfg: Config) -> str:
    style = cfg.get("script", "style", default="")
    lang = cfg.get("script", "language", default="fr")
    words = cfg.get("script", "target_words", default=95)
    keywords = ", ".join(topic.get("keywords", []))
    extra = topic.get("prompt") or topic.get("angle") or ""
    return (
        f"{style}\n\n"
        f"Langue : {lang}. Longueur cible : environ {words} mots.\n"
        f"Sujet : {topic.get('topic', '')}\n"
        + (f"Angle : {extra}\n" if extra else "")
        + (f"Mots-clés : {keywords}\n" if keywords else "")
    )


def _generate_anthropic(prompt: str, cfg: Config) -> str:
    import anthropic

    client = anthropic.Anthropic(api_key=cfg.anthropic_key)
    model = cfg.get("script", "anthropic_model", default="claude-sonnet-4-6")
    resp = client.messages.create(
        model=model,
        max_tokens=600,
        messages=[{"role": "user", "content": prompt}],
    )
    return "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")


def _generate_openai(prompt: str, cfg: Config) -> str:
    from openai import OpenAI

    client = OpenAI(api_key=cfg.openai_key)
    model = cfg.get("script", "openai_model", default="gpt-4o-mini")
    resp = client.chat.completions.create(
        model=model,
        max_tokens=600,
        messages=[{"role": "user", "content": prompt}],
    )
    return resp.choices[0].message.content or ""


class ScriptGenerator:
    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg

    def _use_llm(self) -> bool:
        mode = self.cfg.get("script", "mode", default="auto")
        provider = self.cfg.get("script", "provider", default="anthropic")
        has_key = (
            self.cfg.anthropic_key if provider == "anthropic" else self.cfg.openai_key
        )
        if mode == "manual":
            return False
        if mode == "llm":
            if not has_key:
                raise RuntimeError(
                    f"script.mode=llm mais aucune clé {provider.upper()} dans .env"
                )
            return True
        return bool(has_key)  # mode auto

    def generate(self, topic: dict) -> str:
        # Un script fourni explicitement (ex: colonne "script" de l'Excel, ou
        # texte déjà traduit) est TOUJOURS utilisé tel quel, sans passer au LLM.
        if topic.get("script"):
            log.info("Script fourni : utilisé tel quel (pas de génération).")
            return _clean(topic["script"])

        provider = self.cfg.get("script", "provider", default="anthropic")
        if self._use_llm():
            log.info("Génération du script via %s…", provider)
            prompt = _prompt(topic, self.cfg)
            raw = (
                _generate_anthropic(prompt, self.cfg)
                if provider == "anthropic"
                else _generate_openai(prompt, self.cfg)
            )
            script = _clean(raw)
            if script:
                return script
            log.warning("Réponse LLM vide -> fallback template.")
        log.info("Script depuis le topic (template, sans LLM).")
        script = _template_script(topic)
        if not script:
            raise RuntimeError(
                f"Impossible de produire un script pour le topic '{topic.get('id')}'. "
                "Ajoute un champ 'script' au topic ou configure une clé LLM."
            )
        return script
