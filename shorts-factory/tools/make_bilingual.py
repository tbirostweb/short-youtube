"""Génère les 20 sujets en FR et EN, fonds variés + voix naturelles alternées.

Sortie :
  output/rendu/fr/sujet_1.mp4 ... sujet_20.mp4
  output/rendu/en/sujet_1.mp4 ... sujet_20.mp4

- Chaque sujet a ses PROPRES mots-clés Pexels -> fonds différents.
- Voix les plus naturelles d'edge-tts, alternées (H/F) par langue.
- Accroches fortes + fins naturelles (aucun « abonne-toi » : soit une
  question qui donne envie de répondre, soit une punchline qui marque).
- Scripts EN traduits à la main (pas besoin de clé LLM).
Lancer :  PYTHONPATH=. python -m tools.make_bilingual
"""
from __future__ import annotations

from pathlib import Path

from src.config import load_config
from src.pipeline import Pipeline

# Voix les plus naturelles / convaincantes d'edge-tts
VOICES_FR = ["fr-FR-RemyMultilingualNeural", "fr-FR-VivienneMultilingualNeural"]
VOICES_EN = ["en-US-AndrewMultilingualNeural", "en-US-AvaMultilingualNeural"]

BROLL_DIR = Path(__file__).resolve().parent.parent / "data" / "assets" / "broll"

TOPICS: list[dict] = [
    {
        "id": "interets-composes",
        "bg": ["coins stacking", "growth chart", "money"],
        "fr": {
            "title": "1€ aujourd'hui peut valoir 1000€",
            "hashtags": ["#argent", "#finance", "#investir"],
            "script": "Un euro placé aujourd'hui peut en valoir mille demain. Le secret, ce sont les intérêts composés : tu gagnes de l'argent sur ton argent, puis sur les gains de ton argent. Cent euros par mois en bourse à sept pour cent deviennent plus de cent vingt mille euros en trente ans. Tu n'as presque rien versé, c'est le temps qui a fait le travail. Le plus fou ? Attendre dix ans de plus peut diviser ton résultat par deux.",
        },
        "en": {
            "title": "1 dollar today can be worth 1000",
            "hashtags": ["#money", "#finance", "#investing"],
            "script": "One dollar invested today can be worth a thousand tomorrow. The secret is compound interest: you earn money on your money, then on those gains too. One hundred dollars a month in the stock market at seven percent becomes over one hundred twenty thousand in thirty years. You barely paid anything, time did the work. The craziest part? Waiting ten more years can cut your result in half.",
        },
    },
    {
        "id": "50-30-20",
        "bg": ["budget planning", "calculator money", "notebook desk"],
        "fr": {
            "title": "La règle qui a sauvé mes finances",
            "hashtags": ["#budget", "#argent", "#finance"],
            "script": "Si l'argent file sans que tu saches où, cette règle va te sauver. Cinquante pour cent de ton salaire pour les besoins. Trente pour les envies. Vingt pour toi : ton épargne et tes investissements. Le piège, c'est d'épargner ce qui reste à la fin du mois... et il ne reste jamais rien. Alors inverse tout : mets ces vingt pour cent de côté le jour même où tu es payé, automatiquement, avant de dépenser un centime.",
        },
        "en": {
            "title": "The rule that saved my finances",
            "hashtags": ["#budget", "#money", "#finance"],
            "script": "If money disappears and you don't know where, this rule will save you. Fifty percent of your salary for needs. Thirty for wants. Twenty for you: savings and investing. The trap is saving whatever is left at the end of the month... and nothing is ever left. So flip it: move that twenty percent aside the day you get paid, automatically, before you spend a cent.",
        },
    },
    {
        "id": "riches-actifs",
        "bg": ["luxury lifestyle", "real estate house", "modern building"],
        "fr": {
            "title": "Pourquoi les riches restent riches",
            "hashtags": ["#argent", "#riche", "#finance"],
            "script": "Les riches ne sont pas payés comme toi. Pendant que la plupart échangent leur temps contre un salaire, eux achètent des actifs : des choses qui rapportent de l'argent même la nuit. Une action verse des dividendes. Un appartement encaisse un loyer. Une entreprise tourne sans eux. Les pauvres, eux, achètent des passifs qui coûtent chaque mois. La vraie différence, ce n'est pas le salaire, c'est ce que tu fais avec.",
        },
        "en": {
            "title": "Why the rich stay rich",
            "hashtags": ["#money", "#rich", "#finance"],
            "script": "Rich people don't get paid like you. While most trade their time for a salary, they buy assets: things that make money even at night. A stock pays dividends. An apartment collects rent. A business runs without them. Poor people buy liabilities that cost them every month. The real difference isn't the salary, it's what you do with it.",
        },
    },
    {
        "id": "cash-inflation",
        "bg": ["cash money", "supermarket prices", "wallet"],
        "fr": {
            "title": "Ton argent perd de la valeur maintenant",
            "hashtags": ["#inflation", "#argent", "#epargne"],
            "script": "Ton argent perd de la valeur pendant qu'il dort sur ton compte. Chaque année, l'inflation lui vole entre deux et cinq pour cent de son pouvoir d'achat. Mille euros aujourd'hui, ce sera à peine six cents dans quinze ans. Le garder liquide, c'est le regarder fondre au ralenti. La parade : le placer dans des actifs qui montent plus vite que les prix. Ne rien faire, c'est déjà un choix... et le plus coûteux de tous.",
        },
        "en": {
            "title": "Your money is losing value right now",
            "hashtags": ["#inflation", "#money", "#savings"],
            "script": "Your money loses value while it sleeps in your account. Every year, inflation steals two to five percent of its buying power. A thousand dollars today will be barely six hundred in fifteen years. Keeping it in cash is watching it melt in slow motion. The fix: put it in assets that rise faster than prices. Doing nothing is still a choice... and the most expensive one of all.",
        },
    },
    {
        "id": "buffett",
        "bg": ["wall street", "stock market chart", "trading floor"],
        "fr": {
            "title": "La méthode Buffett en 20 secondes",
            "hashtags": ["#bourse", "#investir", "#finance"],
            "script": "L'homme le plus riche de la bourse suit une règle qu'un enfant comprendrait. Warren Buffett n'achète que des entreprises solides, il les garde des années, et il n'ouvre presque jamais l'appli pour regarder le prix. Son secret : acheter quand tout le monde panique, et ne jamais vendre par peur. La bourse, dit-il, transfère l'argent des impatients vers les patients.",
        },
        "en": {
            "title": "The Buffett method in 20 seconds",
            "hashtags": ["#stocks", "#investing", "#finance"],
            "script": "The richest man in the market follows a rule a child could understand. Warren Buffett only buys strong companies, holds them for years, and almost never opens the app to check the price. His secret: buy when everyone panics, and never sell out of fear. The market, he says, moves money from the impatient to the patient.",
        },
    },
    {
        "id": "1euro-jour",
        "bg": ["piggy bank", "saving coins", "jar of money"],
        "fr": {
            "title": "Ce que 1€ par jour devient en 40 ans",
            "hashtags": ["#investir", "#argent", "#bourse"],
            "script": "Un euro par jour. Ridicule, non ? Sauf qu'en bourse à huit pour cent, ce petit euro devient une machine. Trente euros par mois pendant quarante ans, et tu passes la barre des cent mille euros. Tu n'as versé qu'une fraction, tout le reste, c'est le temps qui l'a créé pour toi. Le montant n'a jamais été le vrai problème. Le seul vrai levier, c'est de commencer tôt.",
        },
        "en": {
            "title": "What 1 dollar a day becomes in 40 years",
            "hashtags": ["#investing", "#money", "#stocks"],
            "script": "One dollar a day. Ridiculous, right? Except at eight percent in the market, that tiny dollar becomes a machine. Thirty dollars a month for forty years, and you cross one hundred thousand dollars. You only paid a fraction, all the rest was created by time for you. The amount was never the real problem. The only real lever is starting early.",
        },
    },
    {
        "id": "revenus-passifs",
        "bg": ["laptop beach", "passive income", "working remotely"],
        "fr": {
            "title": "3 revenus passifs qui marchent vraiment",
            "hashtags": ["#revenupassif", "#argent", "#finance"],
            "script": "Gagner de l'argent en dormant, ce n'est pas un mythe, mais oublie les arnaques. Voici trois revenus passifs réels. Un : les dividendes, tu es payé juste parce que tu détiens des actions. Deux : un produit numérique, créé une fois, vendu mille fois. Trois : le contenu, une vidéo peut te rapporter des années plus tard. Aucun n'est gratuit en efforts au départ, mais chacun continue de tourner sans toi ensuite.",
        },
        "en": {
            "title": "3 passive income ideas that actually work",
            "hashtags": ["#passiveincome", "#money", "#finance"],
            "script": "Making money in your sleep isn't a myth, but forget the scams. Here are three real passive incomes. One: dividends, you get paid just for owning stocks. Two: a digital product, made once, sold a thousand times. Three: content, one video can pay you years later. None are free in effort at first, but each keeps running without you after.",
        },
    },
    {
        "id": "fauche",
        "bg": ["empty wallet", "paycheck", "counting money"],
        "fr": {
            "title": "Pourquoi tu es fauché chaque mois",
            "hashtags": ["#argent", "#budget", "#finance"],
            "script": "Si tu es fauché à chaque fin de mois, ce n'est pas ton salaire, c'est ton ordre de priorités. La plupart des gens dépensent d'abord, puis épargnent ce qui reste. Et il ne reste jamais rien. Les riches font exactement l'inverse : ils se paient eux-mêmes en premier. Dès que l'argent arrive, une partie file automatiquement vers l'épargne, avant même qu'ils puissent y toucher.",
        },
        "en": {
            "title": "Why you're broke every month",
            "hashtags": ["#money", "#budget", "#finance"],
            "script": "If you're broke at every end of the month, it's not your salary, it's your order of priorities. Most people spend first, then save what's left. And nothing is ever left. Rich people do the exact opposite: they pay themselves first. The moment money comes in, a part goes automatically to savings, before they can even touch it.",
        },
    },
    {
        "id": "bourse-30s",
        "bg": ["trading screen", "candlestick chart", "stock ticker"],
        "fr": {
            "title": "La bourse expliquée en 30 secondes",
            "hashtags": ["#bourse", "#investir", "#finance"],
            "script": "La bourse fait peur, alors qu'elle tient en une phrase : tu achètes des petits morceaux d'entreprises, et quand elles grandissent, tu grandis avec. Pas besoin de deviner le bon moment. Un seul fonds qui suit les cinq cents plus grandes entreprises du monde, un peu chaque mois, et tu bats déjà la majorité des experts. Ceux qui perdent, ce sont ceux qui paniquent et revendent au pire moment.",
        },
        "en": {
            "title": "The stock market explained in 30 seconds",
            "hashtags": ["#stocks", "#investing", "#finance"],
            "script": "The stock market scares people, yet it fits in one sentence: you buy tiny pieces of companies, and when they grow, you grow with them. No need to guess the right moment. One fund that tracks the five hundred biggest companies in the world, a little each month, and you already beat most experts. The ones who lose are the ones who panic and sell at the worst time.",
        },
    },
    {
        "id": "carte-credit",
        "bg": ["credit card", "online shopping", "payment terminal"],
        "fr": {
            "title": "Le piège caché des cartes de crédit",
            "hashtags": ["#argent", "#credit", "#finance"],
            "script": "La carte de crédit est un piège déguisé en liberté. Son taux peut dépasser vingt pour cent par an. Si tu ne rembourses que le minimum, une petite dette peut mettre des années à disparaître... et parfois doubler en chemin. La banque adore ça, c'est exactement comme ça qu'elle gagne sur toi. La seule règle qui te protège : ne jamais mettre sur ta carte ce que tu n'as pas déjà sur ton compte.",
        },
        "en": {
            "title": "The hidden credit card trap",
            "hashtags": ["#money", "#creditcard", "#finance"],
            "script": "The credit card is a trap disguised as freedom. Its rate can pass twenty percent a year. If you only pay the minimum, a small debt can take years to disappear... and sometimes double along the way. The bank loves that, it's exactly how they win off you. The one rule that protects you: never put on your card what you don't already have in your account.",
        },
    },
    # ================= IA / TECH =================
    {
        "id": "3-outils-ia",
        "bg": ["artificial intelligence", "futuristic interface", "glowing tech"],
        "fr": {
            "title": "3 IA qui font le travail d'un employé",
            "hashtags": ["#ia", "#intelligenceartificielle", "#tech"],
            "script": "Ces trois IA font, en une heure, le travail d'une journée entière. La première écrit tes textes et tes emails en quelques secondes. La deuxième crée des visuels dignes d'un graphiste, sans graphiste. La troisième monte tes vidéos toute seule. Séparément, elles impressionnent. Ensemble, elles remplacent une petite équipe. L'intelligence artificielle ne prendra pas ton travail, mais quelqu'un qui sait la piloter, peut-être bien.",
        },
        "en": {
            "title": "3 AI tools that do an employee's work",
            "hashtags": ["#ai", "#artificialintelligence", "#tech"],
            "script": "These three AIs do a full day's work in one hour. The first writes your texts and emails in seconds. The second creates visuals worthy of a designer, without a designer. The third edits your videos by itself. Alone, they impress. Together, they replace a small team. Artificial intelligence won't take your job, but someone who masters it might.",
        },
    },
    {
        "id": "ia-gagne-argent",
        "bg": ["server room", "automation robot", "data center"],
        "fr": {
            "title": "L'IA qui gagne de l'argent quand tu dors",
            "hashtags": ["#ia", "#argent", "#tech"],
            "script": "Et si une IA travaillait pour toi pendant que tu dors ? Tu la programmes une seule fois, et elle crée du contenu, répond à tes clients ou trie tes données, vingt-quatre heures sur vingt-quatre. Ce robot ne dort jamais, ne se plaint jamais, ne demande jamais d'augmentation. Le secret des gens efficaces aujourd'hui, ce n'est pas de tout faire eux-mêmes. C'est de mettre l'intelligence artificielle en pilote automatique.",
        },
        "en": {
            "title": "The AI that makes money while you sleep",
            "hashtags": ["#ai", "#money", "#tech"],
            "script": "What if an AI worked for you while you sleep? You set it up once, and it creates content, answers your customers, or sorts your data, twenty-four hours a day. This robot never sleeps, never complains, never asks for a raise. The secret of effective people today isn't doing everything themselves. It's putting artificial intelligence on autopilot.",
        },
    },
    {
        "id": "prompt-secret",
        "bg": ["chatgpt screen", "typing laptop", "code editor"],
        "fr": {
            "title": "Le prompt ChatGPT que 99% ratent",
            "hashtags": ["#ia", "#chatgpt", "#tech"],
            "script": "Tu utilises ChatGPT comme tout le monde, et c'est exactement pour ça qu'il te répond comme à tout le monde. Voici l'astuce des pros. Avant de poser ta question, ajoute une phrase : pose-moi d'abord les questions dont tu as besoin pour me donner la meilleure réponse. D'un coup, l'IA t'interroge, comprend vraiment ton besoin, et le résultat devient dix fois meilleur. Ce n'est pas l'outil qui change tout. C'est la question.",
        },
        "en": {
            "title": "The ChatGPT prompt 99% miss",
            "hashtags": ["#ai", "#chatgpt", "#tech"],
            "script": "You use ChatGPT like everyone else, and that's exactly why it answers you like everyone else. Here's the pro move. Before your question, add one line: first ask me the questions you need to give me the best answer. Suddenly the AI interviews you, truly understands your need, and the result gets ten times better. It's not the tool that changes everything. It's the question.",
        },
    },
    {
        "id": "telephone-espion",
        "bg": ["smartphone privacy", "phone hacker", "data security"],
        "fr": {
            "title": "Ton téléphone n'a pas besoin de t'écouter",
            "hashtags": ["#tech", "#smartphone", "#ia"],
            "script": "Tu parles d'un produit à voix haute, et la pub apparaît. Coïncidence ? Pas vraiment. Ton téléphone n'a même pas besoin de t'écouter : il connaît déjà tes recherches, ta position, l'heure où tu te couches et les magasins où tu t'arrêtes. Des algorithmes devinent tes envies avant toi. Ce ne sont pas les micros qui te trahissent, ce sont tes propres données.",
        },
        "en": {
            "title": "Your phone doesn't need to listen",
            "hashtags": ["#tech", "#smartphone", "#privacy"],
            "script": "You say a product out loud, and the ad appears. Coincidence? Not really. Your phone doesn't even need to listen: it already knows your searches, your location, when you go to bed, the stores where you stop. Algorithms guess your desires before you do. It's not the microphone that betrays you, it's your own data.",
        },
    },
    {
        "id": "video-auto-ia",
        "bg": ["humanoid robot", "ai robot", "robotics"],
        "fr": {
            "title": "Cette vidéo a été faite par une IA",
            "hashtags": ["#ia", "#tech", "#automatisation"],
            "script": "La vidéo que tu regardes n'a presque pas été touchée par un humain. Le texte, la voix, les sous-titres, le choix des images de fond : tout a été généré par une intelligence artificielle. Un humain a juste appuyé sur un bouton. Ce qui demandait une équipe entière et une journée se fait maintenant en quelques minutes. On vit un tournant que nos parents n'auraient jamais cru possible.",
        },
        "en": {
            "title": "This video was made by an AI",
            "hashtags": ["#ai", "#tech", "#automation"],
            "script": "The video you're watching was barely touched by a human. The text, the voice, the subtitles, the choice of background footage: all generated by an artificial intelligence. A human just pressed a button. What used to take a whole team and a full day now happens in minutes. We're at a turning point our parents would never have believed possible.",
        },
    },
    {
        "id": "coder-futur",
        "bg": ["programming code", "developer screen", "software matrix"],
        "fr": {
            "title": "Faut-il encore apprendre à coder ?",
            "hashtags": ["#code", "#ia", "#tech"],
            "script": "Apprendre à coder en 2026, alors que l'IA écrit déjà le code toute seule ? Ça paraît absurde. Et pourtant, c'est tout l'inverse. Celui qui comprend le code dirige l'IA ; celui qui n'y comprend rien la subit. Tu n'as plus besoin de tout mémoriser, mais tu dois savoir quoi demander, et repérer quand la machine se trompe. Le clavier ne disparaît pas, il devient une baguette magique.",
        },
        "en": {
            "title": "Should you still learn to code?",
            "hashtags": ["#code", "#ai", "#tech"],
            "script": "Learning to code in 2026, when AI already writes code on its own? It sounds absurd. And yet it's the complete opposite. The one who understands code directs the AI; the one who understands nothing obeys it. You no longer need to memorize everything, but you must know what to ask, and spot when the machine is wrong. The keyboard doesn't disappear, it becomes a magic wand.",
        },
    },
    {
        "id": "sites-gratuits",
        "bg": ["laptop working", "web design", "creative desk"],
        "fr": {
            "title": "3 sites IA gratuits qui valent de l'or",
            "hashtags": ["#ia", "#gratuit", "#tech"],
            "script": "Trois sites d'intelligence artificielle gratuits que la plupart des gens paieraient sans hésiter. Le premier résume n'importe quelle vidéo ou document de cent pages en dix secondes. Le deuxième transforme une simple idée en présentation complète. Le troisième nettoie et améliore tes photos comme un studio pro. Zéro euro. Pendant que certains payent des abonnements, ces outils font déjà tout le travail, gratuitement.",
        },
        "en": {
            "title": "3 free AI sites worth gold",
            "hashtags": ["#ai", "#free", "#tech"],
            "script": "Three free artificial intelligence sites most people would happily pay for. The first summarizes any video or hundred-page document in ten seconds. The second turns a simple idea into a full presentation. The third cleans and upgrades your photos like a pro studio. Zero dollars. While some pay for subscriptions, these tools already do all the work, for free.",
        },
    },
    {
        "id": "detecter-image-ia",
        "bg": ["digital art", "ai generated face", "glitch portrait"],
        "fr": {
            "title": "Repérer une image générée par IA",
            "hashtags": ["#ia", "#tech", "#astuce"],
            "script": "Bientôt, tu ne pourras plus croire une seule image. Mais aujourd'hui, l'intelligence artificielle laisse encore des indices. Regarde les mains : les doigts sont souvent en trop ou tordus. Lis le texte en arrière-plan : il est flou ou n'a aucun sens. Observe les reflets et les ombres : ils ne collent pas toujours à la lumière. Ces détails, la plupart des gens ne les voient même pas.",
        },
        "en": {
            "title": "How to spot an AI generated image",
            "hashtags": ["#ai", "#tech", "#tips"],
            "script": "Soon, you won't be able to trust a single image. But today, artificial intelligence still leaves clues. Look at the hands: fingers are often extra or twisted. Read the text in the background: it's blurry or makes no sense. Watch the reflections and shadows: they don't always match the light. Most people don't even notice these details.",
        },
    },
    {
        "id": "metier-explose",
        "bg": ["business technology", "modern office", "future workspace"],
        "fr": {
            "title": "Le métier qui explose grâce à l'IA",
            "hashtags": ["#ia", "#metier", "#tech"],
            "script": "Pendant que certains ont peur que l'IA prenne leur job, un nouveau métier explose et paie déjà une fortune. Celui qui sait parler à l'intelligence artificielle et l'installer dans une entreprise. Pas besoin d'être ingénieur, ni d'avoir le moindre diplôme. Juste de maîtriser les bons outils avant les autres. La vague arrive. Tu peux la subir, ou monter dessus et te faire porter.",
        },
        "en": {
            "title": "The job exploding thanks to AI",
            "hashtags": ["#ai", "#career", "#tech"],
            "script": "While some fear AI taking their job, a new one is exploding and already pays a fortune. The person who knows how to talk to artificial intelligence and set it up inside a company. No engineering degree needed, no degree at all. Just master the right tools before others. The wave is coming. You can be hit by it, or ride it.",
        },
    },
    {
        "id": "chatgpt-astuce",
        "bg": ["ai chatbot", "smartphone chatgpt", "digital assistant"],
        "fr": {
            "title": "L'astuce ChatGPT que tout le monde rate",
            "hashtags": ["#chatgpt", "#ia", "#tech"],
            "script": "Quatre-vingt-dix-neuf pour cent des gens parlent à l'IA comme à un moteur de recherche. Grosse erreur. Donne-lui d'abord un rôle : tu es un expert en marketing avec vingt ans d'expérience. Puis donne le contexte. Puis la mission. Rôle, contexte, mission. Avec ces trois mots, tes réponses passent instantanément de banales à brillantes. Le secret n'a jamais été l'outil. C'est la façon dont tu lui parles.",
        },
        "en": {
            "title": "The ChatGPT trick everyone misses",
            "hashtags": ["#chatgpt", "#ai", "#tech"],
            "script": "Ninety-nine percent of people talk to AI like a search engine. Big mistake. First give it a role: you are a marketing expert with twenty years of experience. Then give the context. Then the mission. Role, context, mission. With those three words, your answers instantly go from boring to brilliant. The secret was never the tool. It's how you talk to it.",
        },
    },
]


def _generate_lang(pipeline: Pipeline, out_root: Path, lang: str, voices: list[str]) -> tuple[int, int]:
    ok = fail = 0
    out_dir = out_root / lang
    out_dir.mkdir(parents=True, exist_ok=True)
    for i, t in enumerate(TOPICS, start=1):
        data = t[lang]
        voice = voices[(i - 1) % len(voices)]
        topic = {
            "id": f"{t['id']}-{lang}",
            "topic": data["title"],
            "title": data["title"],
            "keywords": t["bg"],           # -> requête Pexels (fond) + tags
            "hashtags": data["hashtags"],
            "script": data["script"],
        }
        overrides = {"tts": {"voice": voice}, "script": {"language": lang}}
        # Fond fixé et curé pour ce sujet (clip réel raccord) si dispo,
        # sinon on retombe sur Pexels via les mots-clés.
        clip = f"bg_{t['id']}.mp4"
        if (BROLL_DIR / clip).exists():
            overrides["background"] = {"source": "local", "local_file": clip}
        try:
            rec = pipeline.generate(topic, overrides=overrides)
            src = Path(rec["file_path"])
            dst = out_dir / f"sujet_{i}.mp4"
            if dst.exists():
                dst.unlink()
            src.rename(dst)
            ok += 1
            print(f"✅ {lang}/sujet_{i:>2}.mp4  [{voice.split('-')[-1]:<22}]  {data['title']}")
        except Exception as exc:  # noqa: BLE001
            fail += 1
            print(f"❌ {lang}/sujet_{i}: {exc}")
    return ok, fail


def main() -> None:
    cfg = load_config()
    out_root = cfg.path("project", "output_dir", default="output") / "rendu"
    pipeline = Pipeline(cfg)
    try:
        okf, failf = _generate_lang(pipeline, out_root, "fr", VOICES_FR)
        oke, faile = _generate_lang(pipeline, out_root, "en", VOICES_EN)
    finally:
        pipeline.close()
    print(f"\n=== FR : {okf} ok / {failf} échec | EN : {oke} ok / {faile} échec ===")
    print(f"Dossiers : {out_root}/fr  et  {out_root}/en")


if __name__ == "__main__":
    main()
