"""Génère 5 sujets FR + 5 sujets EN (les meilleurs), fonds curés + hooks affinés.

Sortie : output/rendu/fr/sujet_1..5.mp4 et output/rendu/en/sujet_1..5.mp4
Effets : voix naturelles, Ken Burns, barre de progression, emojis, sous-titres
mot-à-mot. Accroches retravaillées pour capter dès la 1re seconde.
Lancer :  PYTHONPATH=. python -m tools.make_final
"""
from __future__ import annotations

from pathlib import Path

from src.config import load_config
from src.pipeline import Pipeline

VOICES_FR = ["fr-FR-RemyMultilingualNeural", "fr-FR-VivienneMultilingualNeural"]
VOICES_EN = ["en-US-AndrewMultilingualNeural", "en-US-AvaMultilingualNeural"]
BROLL_DIR = Path(__file__).resolve().parent.parent / "data" / "assets" / "broll"

# Ambiance musicale par sujet (cohérence, pas de hasard) : finance = motivant,
# IA/tech = électro.
MOOD_BY_ID = {
    "interets-composes": "uplift",
    "riches-actifs": "uplift",
    "telephone-espion": "tech",
    "video-auto-ia": "tech",
    "chatgpt-astuce": "tech",
}

# Mots-clés Pexels par sujet (fonds récupérés à la volée = zéro asset stocké).
KW_BY_ID = {
    "interets-composes": ["stock market screen", "financial charts", "trading"],
    "riches-actifs": ["luxury mansion", "modern villa", "real estate"],
    "telephone-espion": ["smartphone dark", "using phone night", "data security"],
    "video-auto-ia": ["humanoid robot", "ai robot", "robotics"],
    "chatgpt-astuce": ["ai chatbot", "person phone typing", "technology"],
}

TOPICS: list[dict] = [
    {
        "id": "interets-composes",
        "fr": {
            "title": "1€ peut devenir 1000€",
            "hashtags": ["#argent", "#finance", "#investir"],
            "script": "Un seul euro peut se transformer en mille. Pas par magie, par les maths. Ça s'appelle les intérêts composés : tu gagnes de l'argent sur ton argent, puis sur les gains de ton argent. Cent euros par mois en bourse à sept pour cent deviennent plus de cent vingt mille euros en trente ans. Tu n'as presque rien versé, c'est le temps qui a tout fait. Et attendre dix ans de plus peut diviser ton résultat par deux.",
        },
        "en": {
            "title": "1 dollar can become 1000",
            "hashtags": ["#money", "#finance", "#investing"],
            "script": "A single dollar can turn into a thousand. Not by magic, by math. It's called compound interest: you earn money on your money, then on those gains too. One hundred dollars a month in stocks at seven percent becomes over one hundred twenty thousand in thirty years. You barely paid anything, time did it all. And waiting ten more years can cut your result in half.",
        },
    },
    {
        "id": "riches-actifs",
        "fr": {
            "title": "Pourquoi les riches restent riches",
            "hashtags": ["#argent", "#riche", "#finance"],
            "script": "Les riches ne travaillent pas pour l'argent, ils font travailler l'argent à leur place. Pendant que la plupart échangent leur temps contre un salaire, eux achètent des actifs : des choses qui rapportent même la nuit. Une action verse des dividendes. Un appartement encaisse un loyer. Les pauvres, eux, achètent des passifs qui coûtent chaque mois. La vraie différence n'a jamais été le salaire. C'est ce que tu fais avec.",
        },
        "en": {
            "title": "Why the rich stay rich",
            "hashtags": ["#money", "#rich", "#finance"],
            "script": "Rich people don't work for money, they make money work for them. While most trade their time for a salary, they buy assets: things that pay even at night. A stock pays dividends. An apartment collects rent. Poor people buy liabilities that cost them every month. The real difference was never the salary. It's what you do with it.",
        },
    },
    {
        "id": "telephone-espion",
        "fr": {
            "title": "Ton téléphone en sait trop sur toi",
            "hashtags": ["#tech", "#smartphone", "#ia"],
            "script": "Ton téléphone en sait plus sur toi que ta propre mère. Tu parles d'un produit, et la pub apparaît. Ce n'est pas de la magie, et il n'a même pas besoin de t'écouter. Il connaît déjà tes recherches, ta position, l'heure où tu te couches, les magasins où tu t'arrêtes. Des algorithmes devinent tes envies avant toi. Ce ne sont pas les micros qui te trahissent, ce sont tes données.",
        },
        "en": {
            "title": "Your phone knows too much",
            "hashtags": ["#tech", "#smartphone", "#privacy"],
            "script": "Your phone knows more about you than your own mother. You talk about a product, and the ad appears. It's not magic, and it doesn't even need to listen. It already knows your searches, your location, when you sleep, the stores where you stop. Algorithms guess your desires before you do. It's not the microphone that betrays you, it's your data.",
        },
    },
    {
        "id": "video-auto-ia",
        "fr": {
            "title": "Cette vidéo a été faite par une IA",
            "hashtags": ["#ia", "#tech", "#automatisation"],
            "script": "Un humain n'a presque pas touché cette vidéo. Le texte, la voix, les sous-titres, même le choix des images : tout a été généré par une intelligence artificielle. Une personne a juste appuyé sur un bouton. Ce qui demandait une équipe entière et une journée se fait maintenant en quelques minutes. On vit un tournant que nos parents n'auraient jamais cru possible.",
        },
        "en": {
            "title": "This video was made by an AI",
            "hashtags": ["#ai", "#tech", "#automation"],
            "script": "A human barely touched this video. The text, the voice, the subtitles, even the choice of footage: all generated by an artificial intelligence. A person just pressed a button. What used to take a whole team and a full day now happens in minutes. We're living a turning point our parents would never have believed.",
        },
    },
    {
        "id": "chatgpt-astuce",
        "fr": {
            "title": "L'erreur n°1 avec ChatGPT",
            "hashtags": ["#chatgpt", "#ia", "#tech"],
            "script": "Tu utilises ChatGPT comme un moteur de recherche, et c'est l'erreur numéro un. Voici comment font les pros. Donne-lui d'abord un rôle : tu es un expert en marketing avec vingt ans d'expérience. Puis le contexte. Puis la mission. Rôle, contexte, mission. Avec ces trois mots, tes réponses passent instantanément de banales à brillantes. Le secret n'a jamais été l'outil. C'est la façon dont tu lui parles.",
        },
        "en": {
            "title": "The #1 mistake with ChatGPT",
            "hashtags": ["#chatgpt", "#ai", "#tech"],
            "script": "You use ChatGPT like a search engine, and that's mistake number one. Here's how the pros do it. First give it a role: you are a marketing expert with twenty years of experience. Then the context. Then the mission. Role, context, mission. With those three words, your answers instantly go from boring to brilliant. The secret was never the tool. It's how you talk to it.",
        },
    },
]


def _gen(pipeline: Pipeline, out_root: Path, lang: str, voices: list[str]) -> tuple[int, int]:
    ok = fail = 0
    out_dir = out_root / lang
    out_dir.mkdir(parents=True, exist_ok=True)
    for i, t in enumerate(TOPICS, start=1):
        data = t[lang]
        voice = voices[(i - 1) % len(voices)]
        topic = {
            "id": f"{t['id']}-{lang}",
            "topic": data["title"], "title": data["title"],
            "keywords": KW_BY_ID.get(t["id"], []),
            "hashtags": data["hashtags"], "script": data["script"],
        }
        overrides = {"tts": {"voice": voice}, "script": {"language": lang}}
        # Fond : clip local curé s'il existe, sinon Pexels via les mots-clés
        # (mode "tout API" = zéro asset dans le repo).
        clip = f"bg_{t['id']}.mp4"
        if (BROLL_DIR / clip).exists():
            overrides["background"] = {"source": "local", "local_file": clip}
        mood = MOOD_BY_ID.get(t["id"])
        if mood:
            overrides["music"] = {"mood": mood}
        try:
            rec = pipeline.generate(topic, overrides=overrides)
            dst = out_dir / f"sujet_{i}.mp4"
            if dst.exists():
                dst.unlink()
            Path(rec["file_path"]).rename(dst)
            ok += 1
            print(f"✅ {lang}/sujet_{i}.mp4  [{voice.split('-')[-1]:<22}]  {data['title']}")
        except Exception as exc:  # noqa: BLE001
            fail += 1
            print(f"❌ {lang}/sujet_{i}: {exc}")
    return ok, fail


def main() -> None:
    cfg = load_config()
    out_root = cfg.path("project", "output_dir", default="output") / "rendu"
    pipeline = Pipeline(cfg)
    try:
        okf, ff = _gen(pipeline, out_root, "fr", VOICES_FR)
        oke, fe = _gen(pipeline, out_root, "en", VOICES_EN)
    finally:
        pipeline.close()
    print(f"\n=== FR {okf}/5, EN {oke}/5 (échecs {ff+fe}). Dossier : {out_root} ===")


if __name__ == "__main__":
    main()
