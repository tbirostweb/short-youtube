"""Curate un clip de fond RÉEL et raccord pour chaque sujet.

Télécharge dans data/assets/broll/bg_<id>.mp4. Filtre anti-illustration :
vraie vidéo (durée 7-45 s), portrait, résolution correcte. Les requêtes sont
choisies pour ramener des SCÈNES réelles, pas des animations graphiques.
Lancer :  PYTHONPATH=. python -m tools.fetch_broll
"""
from __future__ import annotations

import os
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
KEY = os.getenv("PEXELS_API_KEY")
BROLL = Path(__file__).resolve().parent.parent / "data" / "assets" / "broll"
BROLL.mkdir(parents=True, exist_ok=True)

# id du sujet -> requêtes (on essaie dans l'ordre jusqu'à trouver un bon clip)
QUERIES: dict[str, list[str]] = {
    "interets-composes": ["stock market screen", "financial charts monitor"],
    "50-30-20": ["writing notes desk", "planning budget hands"],
    "riches-actifs": ["luxury villa aerial", "mansion pool"],
    "cash-inflation": ["counting cash hands", "money bills closeup"],
    "buffett": ["new york stock exchange", "wall street city"],
    "1euro-jour": ["coins jar saving", "piggy bank coins"],
    "revenus-passifs": ["working laptop cafe", "laptop beach relax"],
    "fauche": ["empty wallet hands", "person worried money"],
    "bourse-30s": ["trading charts monitor", "stock ticker screen"],
    "carte-credit": ["paying credit card", "card payment terminal"],
    "3-outils-ia": ["server room lights", "data center corridor"],
    "ia-gagne-argent": ["robot arm factory", "automation machine"],
    "prompt-secret": ["typing keyboard closeup", "laptop coding night"],
    "telephone-espion": ["using smartphone dark", "phone screen night"],
    "video-auto-ia": ["humanoid robot", "robot walking"],
    "coder-futur": ["programmer code screen", "developer typing"],
    "sites-gratuits": ["designer laptop working", "creative desk laptop"],
    "detecter-image-ia": ["face technology light", "digital face scan"],
    "metier-explose": ["modern office people", "business meeting tech"],
    "chatgpt-astuce": ["person phone typing", "smartphone chat app"],
}


def pick(vids: list[dict]) -> tuple[str, int, int, int] | None:
    best = None
    for v in vids:
        dur = v.get("duration", 0)
        if not (7 <= dur <= 45):          # écarte les loops/illustrations courtes
            continue
        cands = [f for f in v.get("video_files", [])
                 if f.get("link") and (f.get("height") or 0) >= (f.get("width") or 0)
                 and (f.get("width") or 0) >= 700]
        if not cands:
            continue
        f = min(cands, key=lambda f: abs((f.get("width") or 0) - 1080))
        score = dur  # à durée valide, on prend le 1er résultat pertinent
        if best is None:
            best = (f["link"], f.get("width"), f.get("height"), dur)
            break
    return best


def main() -> None:
    if not KEY:
        raise SystemExit("PEXELS_API_KEY manquante dans .env")
    ok = 0
    for sid, queries in QUERIES.items():
        got = None
        for q in queries:
            try:
                r = requests.get("https://api.pexels.com/videos/search",
                                 headers={"Authorization": KEY},
                                 params={"query": q, "orientation": "portrait",
                                         "per_page": 15, "size": "medium"},
                                 timeout=30)
                got = pick(r.json().get("videos", []))
            except Exception as e:  # noqa: BLE001
                got = None
            if got:
                used_q = q
                break
        if not got:
            print(f"⚠️  {sid}: aucun clip trouvé")
            continue
        link, w, h, dur = got
        dest = BROLL / f"bg_{sid}.mp4"
        try:
            with requests.get(link, stream=True, timeout=180) as resp:
                resp.raise_for_status()
                with open(dest, "wb") as fh:
                    for b in resp.iter_content(1 << 16):
                        fh.write(b)
            mb = dest.stat().st_size // 1024 // 1024
            print(f"✅ {sid:<20} {w}x{h} {dur}s {mb}MB  «{used_q}»")
            ok += 1
        except Exception as e:  # noqa: BLE001
            print(f"❌ {sid}: {e}")
    print(f"\n{ok}/{len(QUERIES)} clips téléchargés dans {BROLL}")


if __name__ == "__main__":
    main()
