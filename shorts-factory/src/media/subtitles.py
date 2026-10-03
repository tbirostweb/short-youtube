"""Génère un fichier de sous-titres ASS animés (style Shorts/TikTok).

Deux modes (config `captions.style`) :
  - "word"   : un mot à la fois, apparaît PILE quand il est prononcé
               (synchro parfaite). Mot-clé important -> jaune, sinon blanc.
               Chaque mot « pop » (petit rebond). C'est le mode par défaut.
  - "phrase" : groupe de N mots en blanc, le mot en cours surligné en jaune
               (karaoké). Plus dense, mais on voit les mots suivants à l'avance.
"""
from __future__ import annotations

from pathlib import Path

from ..config import Config
from .emoji import is_keyword


def _hex_to_ass(hex_color: str, alpha: int = 0) -> str:
    """#RRGGBB -> &HAABBGGRR (couleur ASS pour l'en-tête de style)."""
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H{alpha:02X}{b}{g}{r}".upper()


def _inline_color(hex_color: str) -> str:
    """#RRGGBB -> &HBBGGRR& (override couleur inline \\1c dans une ligne)."""
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H{b}{g}{r}&".upper()


def _ass_text(s: str) -> str:
    """Neutralise les caractères qui casseraient/injecteraient dans l'ASS.

    Dans un Dialogue ASS, `{...}` délimite des balises d'override et `\\`
    introduit une commande : un script utilisateur contenant ces caractères
    corromprait le rendu. On les remplace (ils n'apparaissent pas dans une
    voix off normale de toute façon).
    """
    return (
        str(s).replace("\\", "／").replace("{", "(").replace("}", ")")
        .replace("\r", " ").replace("\n", " ").strip()
    )


def _sec_to_ass(t: float) -> str:
    """secondes -> H:MM:SS.cc (centisecondes)."""
    if t < 0:
        t = 0.0
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = int(t % 60)
    cs = int(round((t - int(t)) * 100))
    if cs == 100:
        cs = 0
        s += 1
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _group_words(words: list[dict], per_group: int) -> list[dict]:
    """Regroupe les mots en lignes de `per_group` mots (garde les mots)."""
    groups: list[dict] = []
    for i in range(0, len(words), per_group):
        chunk = words[i : i + per_group]
        if not chunk:
            continue
        groups.append(
            {"words": chunk, "start": chunk[0]["start"], "end": chunk[-1]["end"]}
        )
    return groups


def build_ass(words: list[dict], out_path: str | Path, cfg: Config) -> Path:
    c = cfg.section("captions")
    v = cfg.section("video")
    width = int(v.get("width", 1080))
    height = int(v.get("height", 1920))

    font = c.get("font", "DejaVu Sans")
    size = int(c.get("font_size", 92))
    primary = _hex_to_ass(c.get("primary_color", "#FFFFFF"))
    highlight = _hex_to_ass(c.get("highlight_color", "#FFD400"))
    outline_col = _hex_to_ass(c.get("outline_color", "#000000"))
    outline = c.get("outline", 6)
    shadow = c.get("shadow", 2)
    bold = -1 if c.get("bold", True) else 0
    margin_v = int(c.get("margin_v", 640))
    uppercase = bool(c.get("uppercase", True))
    style_mode = c.get("style", "word")
    per_group = 1 if style_mode == "word" else int(c.get("words_per_group", 3))
    # Décalage global des sous-titres (s). Positif = texte plus TARD (si tu as
    # l'impression que le texte passe avant la voix, monte un peu, ex 0.06).
    offset = float(c.get("offset", 0.0))

    hl_inline = _inline_color(c.get("highlight_color", "#FFD400"))
    pri_inline = _inline_color(c.get("primary_color", "#FFFFFF"))

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Main,{font},{size},{primary},{highlight},{outline_col},&H64000000,{bold},0,0,0,100,100,0,0,1,{outline},{shadow},2,60,60,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    def fmt(t: float) -> str:
        return _sec_to_ass(t + offset)

    lines: list[str] = []

    if per_group == 1:
        # ---- MODE MOT-À-MOT : un mot affiché pile quand il est prononcé ----
        n = len(words)
        for i, w in enumerate(words):
            seg_start = float(w["start"])
            seg_end = float(words[i + 1]["start"]) if i + 1 < n else float(w["end"]) + 0.4
            if seg_end <= seg_start:
                seg_end = seg_start + 0.08
            tok = w["text"]
            tok = tok.upper() if uppercase else tok
            tok = _ass_text(tok)
            kw = is_keyword(w["text"])
            color = hl_inline if kw else pri_inline
            # Apparition dynamique : fondu express + rebond avec dépassement
            # (grossit vite au-delà de 100% puis se cale). Les mots-clés
            # dépassent plus fort et restent un poil plus gros.
            over = 128 if kw else 118      # pic du rebond (%)
            settle = 106 if kw else 100    # taille finale (%)
            text = (
                f"{{\\an2\\1c{color}\\fad(45,0)\\fscx42\\fscy42"
                f"\\t(0,110,\\fscx{over}\\fscy{over})"
                f"\\t(110,190,\\fscx{settle}\\fscy{settle})}}{tok}"
            )
            lines.append(f"Dialogue: 0,{fmt(seg_start)},{fmt(seg_end)},Main,,0,0,0,,{text}")
    else:
        # ---- MODE PHRASE (karaoké) : groupe blanc, mot actif jaune ----
        groups = _group_words(words, per_group)
        for gi, g in enumerate(groups):
            gwords = g["words"]
            n = len(gwords)
            if gi + 1 < len(groups):
                next_group_start = float(groups[gi + 1]["words"][0]["start"])
            else:
                next_group_start = float(g["end"]) + 0.4
            for i, w in enumerate(gwords):
                seg_start = float(w["start"])
                seg_end = float(gwords[i + 1]["start"]) if i + 1 < n else next_group_start
                if seg_end <= seg_start:
                    seg_end = seg_start + 0.08
                tokens: list[str] = []
                for j, ww in enumerate(gwords):
                    tok = ww["text"]
                    tok = tok.upper() if uppercase else tok
                    tok = _ass_text(tok)
                    if j == i:
                        tokens.append(
                            f"{{\\1c{hl_inline}\\fscx90\\fscy90"
                            f"\\t(0,90,\\fscx112\\fscy112)}}{tok}"
                            f"{{\\1c{pri_inline}\\fscx100\\fscy100}}"
                        )
                    else:
                        tokens.append(tok)
                text = "{\\an2}" + " ".join(t for t in tokens if t)
                lines.append(
                    f"Dialogue: 0,{fmt(seg_start)},{fmt(seg_end)},Main,,0,0,0,,{text}"
                )

    out_path = Path(out_path)
    out_path.write_text(header + "\n".join(lines) + "\n", encoding="utf-8")
    return out_path
