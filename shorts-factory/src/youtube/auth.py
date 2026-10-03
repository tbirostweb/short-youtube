"""Authentification OAuth2 pour l'API YouTube Data v3.

Flux :
  1. Tu crées un projet Google Cloud + OAuth "Desktop app", tu télécharges
     le client_secret.json dans credentials/ (voir README).
  2. `python main.py auth` ouvre le navigateur une seule fois et écrit
     credentials/token.json. Ensuite le bot rafraîchit ce token tout seul.
"""
from __future__ import annotations

from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

from ..config import Config
from ..logger import get_logger

log = get_logger(__name__)

SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]


def _resolve(cfg: Config, raw: str | None, *keys: str, default: str) -> Path:
    """Résout un chemin (absolu ou relatif à la racine). `raw` prioritaire."""
    if raw:
        p = Path(raw)
        if p.is_absolute():
            return p
        from ..config import ROOT
        return ROOT / p
    return cfg.path(*keys, default=default)


def _load_credentials(
    cfg: Config,
    interactive: bool,
    token_file: str | Path | None = None,
    client_secret: str | Path | None = None,
) -> Credentials:
    client_secret = (
        _resolve(cfg, str(client_secret) if client_secret else None,
                 "youtube", "client_secret",
                 default="credentials/client_secret.json")
    )
    token_file = (
        _resolve(cfg, str(token_file) if token_file else None,
                 "youtube", "token_file",
                 default="credentials/token.json")
    )

    creds: Credentials | None = None
    if token_file.exists():
        creds = Credentials.from_authorized_user_file(str(token_file), SCOPES)

    if creds and creds.valid:
        return creds

    if creds and creds.expired and creds.refresh_token:
        log.info("Rafraîchissement du token YouTube…")
        creds.refresh(Request())
        token_file.write_text(creds.to_json(), encoding="utf-8")
        return creds

    if not interactive:
        raise RuntimeError(
            "Aucun token YouTube valide. Lance d'abord : python main.py auth"
        )

    if not client_secret.exists():
        raise RuntimeError(
            f"client_secret.json introuvable ({client_secret}). "
            "Télécharge-le depuis Google Cloud Console (OAuth Desktop app)."
        )

    log.info("Ouverture du navigateur pour autoriser YouTube…")
    flow = InstalledAppFlow.from_client_secrets_file(str(client_secret), SCOPES)
    creds = flow.run_local_server(port=0)
    token_file.parent.mkdir(parents=True, exist_ok=True)
    token_file.write_text(creds.to_json(), encoding="utf-8")
    log.info("Token YouTube enregistré : %s", token_file)
    return creds


def get_service(
    cfg: Config,
    interactive: bool = False,
    token_file: str | Path | None = None,
    client_secret: str | Path | None = None,
):
    """Renvoie un client googleapiclient prêt à uploader.

    `token_file`/`client_secret` permettent de cibler une chaîne précise
    (multi-comptes). Sinon on utilise la config `youtube` globale.
    """
    creds = _load_credentials(cfg, interactive, token_file, client_secret)
    return build("youtube", "v3", credentials=creds, cache_discovery=False)


def run_auth_flow(
    cfg: Config,
    token_file: str | Path | None = None,
    client_secret: str | Path | None = None,
) -> None:
    """Force le flux interactif (commande `auth`)."""
    get_service(cfg, interactive=True, token_file=token_file,
                client_secret=client_secret)
    log.info("Authentification terminée. Tu peux maintenant uploader.")
