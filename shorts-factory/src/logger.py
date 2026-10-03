"""Logger unique et lisible pour tout le projet."""
from __future__ import annotations

import logging
import sys

_CONFIGURED = False


def get_logger(name: str = "shortsbot") -> logging.Logger:
    global _CONFIGURED
    if not _CONFIGURED:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(
            logging.Formatter(
                fmt="%(asctime)s  %(levelname)-7s  %(name)s  %(message)s",
                datefmt="%H:%M:%S",
            )
        )
        root = logging.getLogger()
        root.setLevel(logging.INFO)
        root.addHandler(handler)
        # edge-tts / google sont bavards -> on calme
        for noisy in ("googleapiclient", "google_auth_httplib2", "urllib3", "asyncio"):
            logging.getLogger(noisy).setLevel(logging.WARNING)
        _CONFIGURED = True
    return logging.getLogger(name)
