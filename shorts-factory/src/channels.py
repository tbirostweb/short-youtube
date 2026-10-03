"""Gestion des chaînes YouTube (multi-comptes : FR, EN, ...).

Chaque chaîne a sa propre voix, sa langue, son token OAuth et ses réglages
d'upload. Défini dans config.yaml sous la section `channels`.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .config import Config


@dataclass
class Channel:
    id: str
    name: str = ""
    language: str = "fr"
    voice: str | None = None
    tts_rate: str | None = None
    tts_pitch: str | None = None
    tts_volume: str | None = None
    token_file: str | None = None
    client_secret: str | None = None
    category_id: str | None = None
    privacy: str | None = None
    made_for_kids: bool | None = None

    def overrides(self) -> dict[str, Any]:
        """Surcharges de config pour un rendu sur cette chaîne (voix, langue)."""
        ov: dict[str, Any] = {}
        tts: dict[str, Any] = {}
        if self.voice:
            tts["voice"] = self.voice
        if self.tts_rate:
            tts["rate"] = self.tts_rate
        if self.tts_pitch:
            tts["pitch"] = self.tts_pitch
        if self.tts_volume:
            tts["volume"] = self.tts_volume
        if tts:
            ov["tts"] = tts
        if self.language:
            ov["script"] = {"language": self.language}
        return ov

    def upload_settings(self) -> dict[str, Any]:
        """Réglages d'upload propres à la chaîne (token, catégorie, privacy)."""
        s: dict[str, Any] = {}
        if self.token_file:
            s["token_file"] = self.token_file
        if self.client_secret:
            s["client_secret"] = self.client_secret
        if self.category_id:
            s["category_id"] = self.category_id
        if self.privacy:
            s["privacy"] = self.privacy
        if self.made_for_kids is not None:
            s["made_for_kids"] = self.made_for_kids
        return s


def load_channels(cfg: Config) -> dict[str, Channel]:
    raw = cfg.section("channels") or {}
    channels: dict[str, Channel] = {}
    for cid, c in raw.items():
        c = c or {}
        cat = c.get("category_id")
        channels[cid] = Channel(
            id=cid,
            name=c.get("name", cid),
            language=c.get("language", "fr"),
            voice=c.get("voice"),
            tts_rate=c.get("tts_rate"),
            tts_pitch=c.get("tts_pitch"),
            tts_volume=c.get("tts_volume"),
            token_file=c.get("token_file"),
            client_secret=c.get("client_secret"),
            category_id=str(cat) if cat is not None else None,
            privacy=c.get("privacy"),
            made_for_kids=c.get("made_for_kids"),
        )
    return channels


def get_channel(cfg: Config, channel_id: str | None) -> Channel | None:
    """Renvoie la chaîne demandée, ou None si `channel_id` est vide."""
    if not channel_id:
        return None
    channels = load_channels(cfg)
    if channel_id not in channels:
        dispo = ", ".join(channels) or "aucune"
        raise KeyError(
            f"Chaîne '{channel_id}' absente de config.yaml (section channels). "
            f"Chaînes disponibles : {dispo}."
        )
    return channels[channel_id]
