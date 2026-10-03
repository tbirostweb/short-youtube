"""Synthèse vocale via edge-tts (gratuit, sans clé API).

Renvoie le fichier audio ET la liste des mots avec leur timing exact
(fourni par le moteur TTS lui-même), utilisé pour les sous-titres animés.
"""
from __future__ import annotations

import asyncio
from pathlib import Path

import edge_tts

from ..config import Config
from ..logger import get_logger

log = get_logger(__name__)

# edge-tts renvoie les offsets en "ticks" de 100 ns -> secondes
_TICKS_PER_SECOND = 10_000_000


async def _synthesize(text: str, out_path: Path, cfg: Config) -> list[dict]:
    voice = cfg.get("tts", "voice", default="fr-FR-HenriNeural")
    rate = cfg.get("tts", "rate", default="+0%")
    volume = cfg.get("tts", "volume", default="+0%")
    pitch = cfg.get("tts", "pitch", default="+0Hz")

    # edge-tts >=7 défaut sur SentenceBoundary : il FAUT demander WordBoundary
    # explicitement, sinon aucun timing mot-à-mot -> pas de sous-titres animés.
    communicate = edge_tts.Communicate(
        text, voice=voice, rate=rate, volume=volume, pitch=pitch,
        boundary="WordBoundary",
    )

    words: list[dict] = []
    with open(out_path, "wb") as audio_file:
        async for chunk in communicate.stream():
            ctype = chunk.get("type")
            if ctype == "audio":
                audio_file.write(chunk["data"])
            elif ctype == "WordBoundary":
                start = chunk["offset"] / _TICKS_PER_SECOND
                dur = chunk["duration"] / _TICKS_PER_SECOND
                words.append(
                    {
                        "text": chunk["text"],
                        "start": round(start, 3),
                        "end": round(start + dur, 3),
                    }
                )
    return words


def synthesize(text: str, out_path: str | Path, cfg: Config,
               attempts: int = 3) -> tuple[Path, list[dict]]:
    """Génère l'audio et renvoie (chemin, liste_de_mots_timés).

    Réessaie en cas d'échec réseau transitoire (le service edge-tts peut
    couper) avant d'abandonner.
    """
    import time

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    log.info("Voix off (%s)…", cfg.get("tts", "voice", default="?"))

    last_err: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            words = asyncio.run(_synthesize(text, out_path, cfg))
            if out_path.exists() and out_path.stat().st_size > 0:
                log.info("Audio OK : %s mots timés, %.1f s.",
                         len(words), words[-1]["end"] if words else 0.0)
                return out_path, words
            last_err = RuntimeError("audio vide")
        except Exception as exc:  # noqa: BLE001 - on retente
            last_err = exc
        if attempt < attempts:
            log.warning("TTS échec (tentative %d/%d : %s) — nouvel essai…",
                        attempt, attempts, last_err)
            time.sleep(1.5 * attempt)

    raise RuntimeError(
        "La TTS n'a produit aucun audio après %d tentatives (%s). Vérifie ta "
        "connexion et le nom de la voix (`edge-tts --list-voices`)."
        % (attempts, last_err)
    )
