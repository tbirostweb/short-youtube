"""Emojis animés (pop) synchronisés aux mots-clés.

- `EMOJI_MAP` associe des racines de mots (finance, IA/tech, général) à un
  emoji. Quand un de ces mots est prononcé, on fait « pop » l'emoji en couleur
  au-dessus du sous-titre → plus visuel, meilleure rétention.
- Les emojis couleur ne se rendent pas dans libass : on les génère en PNG
  (police Apple Color Emoji via Pillow) puis on les superpose avec FFmpeg.
- Le même dictionnaire sert aussi à colorer les mots-clés en jaune dans les
  sous-titres (mots « importants » mis en avant).
"""
from __future__ import annotations

import re
import unicodedata
from pathlib import Path

# Racine normalisée (sans accent, minuscule) -> emoji.
# Les clés de 4+ lettres matchent en préfixe ; les clés courtes en exact.
EMOJI_MAP: dict[str, str] = {
    # --- Finance / investissement ---
    "argent": "💰", "money": "💰", "cash": "💰", "euro": "💶", "dollar": "💵",
    "bourse": "📈", "action": "📈", "stock": "📈", "marche": "📊", "trading": "📈",
    "croissance": "📈", "profit": "🤑", "riche": "🤑", "million": "💰",
    "banque": "🏦", "investir": "💸", "investissement": "💸", "epargne": "🐷",
    "interet": "📈", "crypto": "🪙", "bitcoin": "🪙", "carte": "💳",
    "maison": "🏠", "immobilier": "🏠", "salaire": "💵", "budget": "🧾",
    # --- IA / tech ---
    "intelligence": "🤖", "robot": "🤖", "algorithme": "🧠", "algo": "🧠",
    "clavier": "⌨️", "ordinateur": "💻", "code": "💻", "logiciel": "💻",
    "telephone": "📱", "smartphone": "📱", "internet": "🌐", "donnee": "📂",
    "data": "📂", "cerveau": "🧠", "puce": "🔌", "energie": "⚡",
    "futur": "🚀", "innovation": "💡", "idee": "💡", "secret": "🤫",
    "rapide": "⚡", "temps": "⏰", "attention": "⚠️", "erreur": "❌",
    "regarde": "👀", "incroyable": "🤯", "fou": "🤯", "feu": "🔥", "viral": "🔥",
    # --- Anglais (pour les chaînes EN) ---
    "dollars": "💵", "invest": "💸", "investing": "💸", "investment": "💸",
    "bank": "🏦", "stocks": "📈", "market": "📊", "growth": "📈", "rich": "🤑",
    "wealth": "💰", "millionaire": "💰", "savings": "🐷", "profit": "🤑",
    "keyboard": "⌨️", "computer": "💻", "coding": "💻", "software": "💻",
    "phone": "📱", "brain": "🧠", "energy": "⚡", "future": "🚀",
    "idea": "💡", "secret": "🤫", "fast": "⚡", "time": "⏰",
    "warning": "⚠️", "mistake": "❌", "watch": "👀", "crazy": "🤯",
    "gold": "🥇", "algorithm": "🧠", "data": "📂", "robots": "🤖",
    # exacts courts
    "ia": "🤖", "ai": "🤖", "pc": "💻", "or": "🥇",
}

_SHORT_EXACT = {k for k in EMOJI_MAP if len(k) <= 3}


def _norm(word: str) -> str:
    w = unicodedata.normalize("NFKD", str(word or ""))
    w = "".join(c for c in w if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]", "", w.lower())


def emoji_for(word: str) -> str | None:
    """Renvoie l'emoji associé à un mot, ou None."""
    n = _norm(word)
    if not n:
        return None
    if n in EMOJI_MAP:
        return EMOJI_MAP[n]
    # préfixe pour les racines longues (>=4) : ex 'argenté' -> 'argent'
    for key, emo in EMOJI_MAP.items():
        if key in _SHORT_EXACT:
            continue
        if n.startswith(key) or key.startswith(n) and len(n) >= 4:
            return emo
    return None


def is_keyword(word: str) -> bool:
    """True si le mot doit être mis en avant (couleur d'accent)."""
    return emoji_for(word) is not None


def find_cues(words: list[dict]) -> list[dict]:
    """Repère les mots déclencheurs et renvoie [{emoji, start, end}].

    Évite de rejouer le même emoji sur deux mots consécutifs collés.
    """
    cues: list[dict] = []
    last_emoji = None
    last_end = -10.0
    for w in words:
        emo = emoji_for(w.get("text", ""))
        if not emo:
            last_emoji = None
            continue
        start = float(w["start"])
        end = float(w["end"])
        # dédoublonne un emoji identique qui s'enchaîne immédiatement
        if emo == last_emoji and start - last_end < 0.4:
            cues[-1]["end"] = end
        else:
            cues.append({"emoji": emo, "start": start, "end": end})
        last_emoji = emo
        last_end = end
    return cues


# ---------------------------------------------------------------------
#  Rendu PNG des emojis couleur via Pillow
# ---------------------------------------------------------------------
#  Polices emoji couleur possibles selon l'OS (macOS = Apple, Linux/Docker =
#  Noto Color Emoji). Chaque entrée : (chemin, tailles supportées).
_EMOJI_FONTS = [
    ("/System/Library/Fonts/Apple Color Emoji.ttc", [160, 96, 64, 48, 40, 32, 20]),
    ("/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf", [109]),
    ("/usr/share/fonts/noto/NotoColorEmoji.ttf", [109]),
    ("/usr/share/fonts/google-noto-color-emoji/NotoColorEmoji.ttf", [109]),
]


def _emoji_font() -> tuple[str, list[int]] | tuple[None, None]:
    for path, sizes in _EMOJI_FONTS:
        if Path(path).exists():
            return path, sizes
    return None, None


def render_png(emoji: str, out_path: str | Path, px: int = 160) -> Path | None:
    """Rend un emoji couleur en PNG transparent. None si impossible.

    La taille finale importe peu : FFmpeg redimensionne l'overlay ensuite.
    """
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        return None
    font_path, sizes = _emoji_font()
    if not font_path:
        return None
    size = min(sizes, key=lambda s: abs(s - px))
    try:
        font = ImageFont.truetype(font_path, size)
        img = Image.new("RGBA", (size * 2 + 8, size + 8), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        draw.text((4, 0), emoji, font=font, embedded_color=True)
        bbox = img.getbbox()
        if bbox:
            img = img.crop(bbox)
        out_path = Path(out_path)
        img.save(out_path)
        return out_path
    except Exception:
        return None
