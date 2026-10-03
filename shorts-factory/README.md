# 🎬 Shorts Factory — bot YouTube Shorts autonome

Génère des YouTube Shorts **de A à Z** et les publie tout seul :

```
Sujet → Script → Voix off → Fond vertical → Sous-titres animés → Montage → Upload YouTube
```

- **Voix off gratuite** (edge-tts, aucune clé) avec **timing exact des mots** → sous-titres animés style TikTok/Shorts, brûlés dans la vidéo.
- **Fonds verticaux** via l'API **Pexels** (gratuite), ou tes propres clips, ou un fond de couleur.
- **Scripts** écrits à la main (dans `data/topics.json`) **ou** générés par IA (Anthropic / OpenAI, optionnel).
- **Montage FFmpeg** 1080×1920, musique optionnelle, export prêt pour Shorts.
- **Upload YouTube** (Data API v3) avec titre/description/tags, confidentialité et programmation.
- **Mode autonome** : X vidéos/jour à heures fixes, avec garde-fous.
- **Dashboard web** pour suivre et lancer les générations.

> Fonctionne **sans aucune clé API** pour un premier test (voix + fond de couleur + scripts fournis). Les clés ajoutent juste de la qualité/automatisation.

---

## 🚀 Démarrage rapide (sans clé, 3 commandes)

Pré-requis : **Python 3.10+** et **FFmpeg** installés.

```bash
# 1. Dépendances
python -m venv .venv && source .venv/bin/activate   # Windows : .venv\Scripts\activate
pip install -r requirements.txt

# 2. Config secrets (vide au début, c'est OK)
cp .env.example .env

# 3. Génère ta première vidéo (sans upload)
python main.py generate
```

La vidéo apparaît dans `output/`. 🎉

### Installer FFmpeg
- **macOS** : `brew install ffmpeg-full` ⚠️ (voir note libass ci-dessous)
- **Ubuntu/Debian** : `sudo apt install ffmpeg`
- **Windows** : `winget install Gyan.FFmpeg` (ou https://ffmpeg.org/download.html)

> ⚠️ **macOS / libass — indispensable pour les sous-titres.**
> Depuis peu, le `brew install ffmpeg` « normal » est compilé **sans libass** :
> le filtre `subtitles` manque et **aucun sous-titre n'est incrusté** (le reste
> marche). Vérifie avec :
> ```bash
> ffmpeg -filters | grep subtitles   # doit renvoyer une ligne
> ```
> Si c'est vide, installe le build complet et pointe le bot dessus dans `.env` :
> ```bash
> brew install ffmpeg-full
> # dans .env :
> #   FFMPEG_BINARY=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg
> #   FFPROBE_BINARY=/opt/homebrew/opt/ffmpeg-full/bin/ffprobe
> ```
> (Linux/Docker : le paquet `ffmpeg` inclut déjà libass, rien à faire.)

---

## 🔑 Clés API (toutes optionnelles)

Édite `.env` :

| Clé | À quoi ça sert | Obtenir |
|-----|----------------|---------|
| `PEXELS_API_KEY` | Fonds vidéo verticaux automatiques | https://www.pexels.com/api/ (gratuit) |
| `ANTHROPIC_API_KEY` | Génère script + metadata via Claude | https://console.anthropic.com |
| `OPENAI_API_KEY` | Idem via GPT | https://platform.openai.com |

Sans clé LLM : le bot utilise le champ `script` de chaque sujet dans `data/topics.json`.
Sans clé Pexels : le bot utilise tes clips locaux, sinon un fond de couleur.

---

## 📺 Configurer l'upload YouTube

L'API YouTube utilise **OAuth** (pas une simple clé). Une fois configuré, le bot se ré-authentifie tout seul.

1. Va sur **Google Cloud Console** → crée un projet.
2. **APIs & Services → Library** → active **YouTube Data API v3**.
3. **OAuth consent screen** : type *External*, ajoute ton adresse Google en *Test user*.
4. **Credentials → Create credentials → OAuth client ID → Desktop app**.
5. Télécharge le JSON, renomme-le **`client_secret.json`**, place-le dans **`credentials/`**.
6. Autorise une seule fois :

```bash
python main.py auth
```

Ton navigateur s'ouvre → tu approuves → un `credentials/token.json` est créé. C'est fini.

> ⚠️ Tant que ton app OAuth est en mode *Testing*, seuls les *test users* déclarés peuvent uploader — largement suffisant pour ton propre compte.

---

## ▶️ Utilisation

```bash
python main.py generate         # 1 vidéo, SANS upload (idéal pour tester)
python main.py run              # 1 vidéo + upload
python main.py run --no-upload  # équivalent de generate
python main.py template f.xlsx  # crée un modèle Excel à remplir
python main.py batch f.xlsx     # génère (+ upload) tous les Shorts de l'Excel
python main.py channels         # liste les chaînes + statut d'auth
python main.py auth --channel fr1  # autorise une chaîne précise
python main.py schedule         # boucle autonome (voir config schedule)
python main.py serve            # dashboard web -> http://localhost:8000
python main.py list             # historique des vidéos
```

> 🏭 Pour produire **en volume sur plusieurs chaînes FR/EN depuis un Excel**,
> voir la section **Mode batch** plus bas.

### Mode autonome
Dans `config.yaml`, section `schedule` : heures de publication, nombre max/jour, jitter.
Puis :

```bash
python main.py schedule
```

Le bot génère et publie une vidéo à chaque créneau, en piochant le prochain sujet non traité et en respectant le quota.

### Dashboard
```bash
python main.py serve
```
Ouvre http://localhost:8000 : statut, pipeline en temps réel, historique, bouton **Générer un Short** (avec ou sans upload).

---

## 🏭 Mode batch (Excel) + multi-chaînes FR/EN

Tu peux piloter des dizaines de Shorts d'un coup depuis un simple fichier Excel :
une ligne = une vidéo. C'est le mode conçu pour produire en volume sur
plusieurs chaînes.

### 1. Créer le modèle Excel

```bash
python main.py template mes_shorts.xlsx
```

Ça crée un `.xlsx` avec 3 feuilles : **Shorts** (à remplir), **Notice** (le rôle
de chaque colonne) et **Reference** (voix FR/EN + `categoryId` YouTube).

### 2. Remplir les colonnes

| Colonne | Rôle |
|---|---|
| `channel` | Chaîne cible : `fr1`, `fr2`, `en1`, `en2` (voir `config.yaml`) |
| `titre` | Titre YouTube — utilisé **tel quel** |
| `script` | Texte lu par la voix off. **Vide** = généré par IA si une clé LLM est présente |
| `topic` | Thème (sert si pas de `script`, ou pour compléter) |
| `keywords` | Mots-clés (virgule) → recherche b-roll Pexels **et** tags |
| `hashtags` | Hashtags (virgule) |
| `cta` | Phrase de fin (call-to-action) |
| `voix` | Voix edge-tts spécifique (vide = voix de la chaîne) |
| `musique` | Fichier dans `data/assets/music/`, ou `aucune`. Vide = aléatoire |
| `fond` | `auto` / `pexels` / `local` / `color` |
| `categorie` | `categoryId` YouTube (nombre). Vide = celle de la chaîne |
| `traduire_vers` | Une **autre** chaîne (ex `en1`) → duplique la vidéo **traduite** dessus |
| `publier` | `oui` / `non` (non = génère seulement, sans upload) |
| `date_publication` | Programmation, ex `2026-08-01 09:00` (vide = tout de suite) |

Tout est optionnel **sauf** de quoi produire un script : soit tu remplis `script`,
soit tu remplis `topic` **et** tu as une clé LLM dans `.env`.

### 3. Lancer

```bash
python main.py batch mes_shorts.xlsx --no-upload   # tout générer et vérifier
python main.py batch mes_shorts.xlsx               # générer + uploader (selon "publier")
```

Une erreur sur une ligne n'arrête pas les autres : un récap s'affiche à la fin
(générées / uploadées / échecs).

### Multi-chaînes (2 FR + 2 EN par défaut)

Les 4 chaînes sont définies dans `config.yaml` (section `channels`) : chacune a
sa voix, sa langue, sa catégorie et son propre token OAuth. Le `client_secret.json`
est **partagé** — il suffit de s'authentifier avec le bon compte Google pour chaque
chaîne :

```bash
python main.py channels                 # liste les chaînes + statut d'auth
python main.py auth --channel fr1        # autorise la chaîne fr1 (ouvre le navigateur)
python main.py auth --channel en1        # etc. pour chaque chaîne
```

### Traduction automatique FR ↔ EN (double le contenu)

Mets un id de chaîne d'une autre langue dans `traduire_vers` (ex `en1`). Le bot :
1. génère la vidéo dans la langue de la chaîne source,
2. **traduit** script + titre + description via ton LLM,
3. régénère la voix + le montage dans la 2ᵉ langue,
4. l'uploade sur la chaîne cible.

Un même sujet rempli une fois → deux vidéos sur deux chaînes. **Nécessite une clé
LLM** (`ANTHROPIC_API_KEY` ou `OPENAI_API_KEY`). Sans clé, la ligne est quand même
produite dans sa langue d'origine, seule la duplication traduite est ignorée.

> **Quota** : l'API YouTube autorise ~6 uploads/jour/chaîne. Avec 4 chaînes, vise
> ~**24 vidéos/jour** en régime réaliste. Pour la stratégie de croissance, lis
> **`STRATEGIE.md`**.

---

## 🐳 Docker

```bash
cp .env.example .env            # remplis si besoin
docker compose up -d            # lance le bot (schedule) + le dashboard (:8000)
```

Générer une vidéo ponctuelle :
```bash
docker compose run --rm bot python main.py run
```

> Pour l'**auth YouTube**, le plus simple est de lancer `python main.py auth` **hors Docker** une fois (il crée `credentials/token.json`, monté ensuite dans les conteneurs). L'OAuth a besoin d'ouvrir un navigateur.

---

## 🎨 Personnalisation

Tout est dans **`config.yaml`**. Les réglages les plus utiles :

**Voix off** (`tts.voice`) — liste des voix françaises :
```bash
edge-tts --list-voices | grep fr-FR
# ex : fr-FR-DeniseNeural (F), fr-FR-HenriNeural (H), fr-FR-EloiseNeural...
```

**Sous-titres** (`captions`) — police, taille, couleurs, style `word` (mot par mot) ou `phrase`.
Pour une police punchy type **Anton** ou **Montserrat** :
1. Télécharge le `.ttf` et pose-le dans `data/assets/fonts/`.
2. Mets `captions.font: "Anton"` (le **nom de la famille**, pas le fichier).

**Fond vidéo** (`background`) :
- `pexels` : automatique (clé requise). Change `pexels_query` ou laisse les `keywords` du sujet.
- `local` : pose des `.mp4` verticaux dans `data/assets/broll/`.
- `color` : fond uni (couleur `background.color`) avec léger grain.

**Musique** (`music`) : pose des `.mp3` dans `data/assets/music/`. Le bot en pioche un et baisse le volume (`music.volume`). Utilise de la musique libre de droits (YouTube Audio Library, etc.).

**Confidentialité & programmation** (`youtube`) :
- `privacy: private | unlisted | public`
- `publish_delay_hours` : publie X heures plus tard (planification native YouTube).

**Sujets** (`data/topics.json`) — chaque entrée :
```jsonc
{
  "id": "mon-sujet-01",              // unique, sert à ne pas le refaire
  "topic": "Titre / thème",
  "keywords": ["ocean", "water"],    // requête Pexels + tags
  "hashtags": ["#ocean", "#shorts"],
  "cta": "Abonne-toi.",
  "script": "Texte lu tel quel...",  // OU null -> généré par IA (si clé)
  "prompt": "Consigne si script=null" // optionnel, guide l'IA
}
```

---

## ⚠️ Limites & bonnes pratiques

- **Quota API YouTube** : ~10 000 unités/jour, et **un upload coûte ~1 600 unités** → **≈ 6 vidéos/jour max** par projet Google. Le garde-fou `schedule.max_per_day` évite les dépassements. Besoin de plus → demande une augmentation de quota à Google.
- **Politique YouTube** : les chaînes 100 % automatisées et le contenu répétitif/réutilisé peuvent être limités ou démonétisés. Apporte une vraie valeur (script original, montage soigné) et commence en `privacy: private` ou `unlisted` le temps de valider le rendu.
- **Musique & clips** : n'utilise que des ressources libres de droits (Pexels l'est ; pour l'audio, la YouTube Audio Library).
- Ce bot est un **outil de production** : tu restes responsable de ce que tu publies.

---

## 🗂️ Structure

```
BotYt/
├── main.py                  # CLI (auth / generate / run / batch / template / channels / schedule / serve / list)
├── app.py                   # dashboard FastAPI (formulaire + import Excel + analytics)
├── config.yaml              # toute la configuration (channels FR/EN, captions, video, background…)
├── .env(.example)           # secrets (clés API : Pexels, LLM, chemins FFmpeg)
├── data/
│   ├── topics.json          # file de sujets (mode `generate`/`schedule`)
│   └── assets/
│       ├── broll/           # bg_<sujet>.mp4 : fonds curés par sujet (+ CREDITS.txt)
│       ├── music/  fonts/
├── src/
│   ├── config.py  logger.py  database.py  topics.py
│   ├── channels.py          # chaînes multi-comptes (FR/EN)
│   ├── batch.py             # moteur batch : Excel -> Shorts (+ duplication traduite)
│   ├── pipeline.py          # orchestration bout-en-bout (surcharges par vidéo)
│   ├── scheduler.py         # boucle autonome (APScheduler)
│   ├── generators/          # script.py, metadata.py, translate.py (FR<->EN)
│   ├── media/               # tts.py, stock.py, subtitles.py, emoji.py, builder.py (FFmpeg)
│   └── youtube/             # auth.py (OAuth multi-comptes), uploader.py
├── tools/                   # voir tools/README.md
│   ├── make_final.py        # GÉNÉRATEUR PRINCIPAL (5 sujets × FR/EN)
│   ├── make_bilingual.py    # variante large (20 sujets × FR/EN)
│   ├── fetch_broll.py       # curation des fonds Pexels par sujet
│   └── make_template.py     # génère le modèle Excel
├── templates/               # dashboard.html + analytics.html (design Apple)
├── docs/YOUTUBE_OAUTH_ET_STATS.md   # guide OAuth + branchement des vraies stats
├── Dockerfile  docker-compose.yml
└── requirements.txt
```

Pipeline (dans `src/pipeline.py`) : `topic → script → voix → fond → montage → metadata → upload`.
Rendu (`src/media/builder.py`) : fond curé + Ken Burns, sous-titres mot-à-mot (`subtitles.py`),
emojis animés sur mots-clés (`emoji.py`), barre de progression, silence de fin coupé (watchtime).
En batch, chaque ligne applique ses propres surcharges (voix, musique, fond, langue).

---

## 🧯 Dépannage

| Problème | Solution |
|----------|----------|
| `ffmpeg introuvable` | Installe FFmpeg (voir plus haut) ou utilise Docker |
| **Vidéo sans aucun sous-titre** (macOS) | Ton ffmpeg n'a pas libass. `ffmpeg -filters \| grep subtitles` : si vide → `brew install ffmpeg-full` puis règle `FFMPEG_BINARY`/`FFPROBE_BINARY` dans `.env` |
| `No such filter: 'subtitles'` | Idem : FFmpeg sans libass, voir ligne au-dessus |
| Voix vide / erreur TTS | Vérifie ta connexion et le nom de la voix (`edge-tts --list-voices`) |
| Sous-titres avec mauvaise police | Le nom `captions.font` doit être la **famille** de la police ; pose le `.ttf` dans `data/assets/fonts/` |
| `Aucun token YouTube` | Lance `python main.py auth` |
| `Aucun sujet disponible` | Ajoute des entrées à `data/topics.json` ou supprime `data/shorts.db` |
| Erreur quota upload | Tu as dépassé ~6 uploads/jour ; attends demain ou demande plus de quota |

---

## 🔧 Idées d'extension

- **Mode "clip"** : au lieu de générer, découper automatiquement les moments forts d'une longue vidéo (télécharger avec `yt-dlp`, détecter les pics audio, recadrer en 9:16).
- **Publication multi-plateformes** (TikTok, Reels) via leurs API respectives.
- **A/B testing** des titres/accroches en lisant les stats via l'API YouTube Analytics.

Bon montage 🚀
