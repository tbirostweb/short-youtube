"""Chargement de la configuration : config.yaml + secrets (.env)."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv

# Racine du projet (dossier parent de src/)
ROOT = Path(__file__).resolve().parent.parent


class Config:
    """Petit wrapper autour du dict YAML + accès aux secrets d'environnement."""

    def __init__(self, data: dict[str, Any]) -> None:
        self.data = data

    # --- accès type dictionnaire ---
    def __getitem__(self, key: str) -> Any:
        return self.data[key]

    def section(self, name: str) -> dict[str, Any]:
        return self.data.get(name, {}) or {}

    def get(self, *keys: str, default: Any = None) -> Any:
        """cfg.get('captions', 'font', default='DejaVu Sans')"""
        node: Any = self.data
        for k in keys:
            if not isinstance(node, dict) or k not in node:
                return default
            node = node[k]
        return node

    # --- chemins résolus par rapport à la racine ---
    def path(self, *keys: str, default: str = "") -> Path:
        raw = self.get(*keys, default=default)
        p = Path(raw)
        return p if p.is_absolute() else (ROOT / p)

    # --- copie avec surcharges (pour un rendu spécifique : voix, fond...) ---
    def clone_with(self, overrides: dict[str, Any] | None) -> "Config":
        """Renvoie une COPIE de la config avec des surcharges (deep-merge).

        Les valeurs None dans `overrides` sont ignorées (n'écrasent rien).
        Utilisé par le mode batch pour appliquer, par vidéo, une voix, une
        musique, un fond ou une langue différents sans toucher la config globale.
        """
        import copy

        data = copy.deepcopy(self.data)
        if overrides:
            _deep_merge(data, overrides)
        return Config(data)

    # --- secrets (.env) ---
    @property
    def anthropic_key(self) -> str | None:
        return os.getenv("ANTHROPIC_API_KEY") or None

    @property
    def openai_key(self) -> str | None:
        return os.getenv("OPENAI_API_KEY") or None

    @property
    def pexels_key(self) -> str | None:
        return os.getenv("PEXELS_API_KEY") or None

    @property
    def pixabay_key(self) -> str | None:
        return os.getenv("PIXABAY_API_KEY") or None


def _deep_merge(base: dict, overrides: dict) -> None:
    """Fusionne `overrides` dans `base` en place (récursif, ignore les None)."""
    for key, value in overrides.items():
        if value is None:
            continue
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            _deep_merge(base[key], value)
        else:
            base[key] = value


def load_config(path: str | os.PathLike | None = None) -> Config:
    """Charge .env puis config.yaml et renvoie un objet Config."""
    load_dotenv(ROOT / ".env")
    cfg_path = Path(path) if path else (ROOT / "config.yaml")
    if not cfg_path.is_absolute():
        cfg_path = ROOT / cfg_path
    with open(cfg_path, "r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    return Config(data)
