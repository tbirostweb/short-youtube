# ytshorter

Une application web qui prend l'URL d'une vidéo YouTube, repère automatiquement les
meilleurs passages, les découpe en clips verticaux **1080x1920 avec sous-titres
incrustés**, et rédige pour chaque clip un titre et une description prêts pour
**YouTube Shorts** et **TikTok**, dans la langue choisie.

**100 % gratuit** : uniquement des outils auto-hébergés et des offres d'API gratuites
à quota. Aucune facturation à l'usage. Le seul coût est le VPS.

---

## Sommaire

1. [Ce que fait l'application](#1-ce-que-fait-lapplication)
2. [Architecture](#2-architecture)
3. [Démarrage rapide](#3-démarrage-rapide)
4. [Configuration](#4-configuration)
5. [Obtenir les clés d'API gratuites](#5-obtenir-les-clés-dapi-gratuites)
6. [Développement local sans Docker](#6-développement-local-sans-docker)
7. [Tests](#7-tests)
8. [Le pipeline en détail](#8-le-pipeline-en-détail)
9. [Sécurité](#9-sécurité)
10. [Déploiement Dokploy sur OVH](#10-déploiement-dokploy-sur-ovh)
11. [Exploitation et dépannage](#11-exploitation-et-dépannage)
12. [Décisions d'implémentation](#12-décisions-dimplémentation)
13. [Limites assumées et risques](#13-limites-assumées-et-risques)

---

## 1. Ce que fait l'application

1. Vous fournissez une source — **une URL YouTube ou votre propre fichier vidéo** —
   et réglez : mise en page verticale, langue des métadonnées, **langue des
   sous-titres** (traduits si elle diffère de la langue parlée), nombre de clips,
   durée cible, style de sous-titres (avec aperçu visuel), incrustation de
   l'accroche, cadrage.
2. Le traitement part en arrière-plan. La progression s'affiche **en direct**,
   étape par étape : téléchargement, transcription, sélection, découpe,
   recadrage et sous-titres, métadonnées, finalisation.
3. Vous obtenez une grille de clips. Chaque carte contient un lecteur vidéo, le
   téléchargement du MP4 vertical, le titre et la description YouTube Shorts, la
   légende et les hashtags TikTok, avec un bouton **Copier** par bloc.

Ce que le rendu fait sans qu'on le demande :

- **cadrage automatique sur le sujet** — le cadre suit le visage, à défaut le
  point d'intérêt, avec réinitialisation à chaque coupe de plan ;
- **volume aligné sur -14 LUFS** en deux passes, la cible des plateformes ;
- **fondu de fermeture** court, et surtout **pas de fondu d'ouverture** : sur un
  format court, les premiers dixièmes de seconde sont l'accroche.

Et quand un clip est *presque* bon, on peut le rattraper sans rien relancer :

- **corriger les sous-titres** — un nom mal transcrit, une faute, une coupure
  maladroite ; le clip est ré-encodé avec le texte corrigé ;
- **déplacer le début et la fin** — chaque extrait est découpé avec une marge de
  sécurité, donc les secondes manquantes existent encore ;
- **changer le style, la mise en page, l'accroche ou le cadrage** ;
- **exporter les sous-titres** en SRT ou WebVTT.

Aucune de ces reprises ne consomme de quota d'IA : elles ne coûtent qu'une passe
d'encodage sur un extrait de quelques dizaines de secondes.

**Publier plus vite.** Les plateformes verrouillent en privé les envois des
applications non auditées : la publication reste donc manuelle. Tout ce qui
l'entoure est en revanche supprimé :

- **un bouton de copie par champ réel du formulaire**, pas par donnée — le titre
  YouTube d'un côté, description et hashtags fusionnés de l'autre (c'est la même
  zone de texte), et une **légende TikTok unique** hashtags compris ;
- **lien direct** vers la page d'envoi de chaque plateforme ;
- **suivi de ce qui est déjà en ligne**, par clip et par plateforme, avec un
  compteur d'avancement — indispensable sur une série de cinq épisodes ;
- **archive ZIP** de tous les clips, accompagnée d'un mémo texte reprenant tous
  les titres et descriptions dans l'ordre de publication.

En plus :

- **Historique** des générations, avec suppression définitive des fichiers.
- **Re-stylisation d'un clip** : changer le style de sous-titres, la mise en
  page, l'accroche ou le cadrage d'un clip déjà produit, en une passe
  d'encodage, sans relancer le pipeline et sans consommer le moindre quota d'IA.
- **Rétention automatique** : les générations et les fichiers envoyés non
  utilisés sont supprimés au bout d'un délai configurable.

Hors périmètre (mais l'architecture ne les empêche pas) : connexion de comptes
sociaux et publication programmée, comptes multi-utilisateurs avancés, facturation.

---

## 2. Architecture

Cinq services orchestrés par Docker Compose :

| Service  | Rôle |
|----------|------|
| `web`    | Front Vue 3 buildé en statique, servi par nginx, qui proxifie aussi `/api`. |
| `api`    | Fastify : validation, création des jobs, état, SSE, téléchargements signés. |
| `worker` | Pipeline complet : yt-dlp, whisper.cpp, LLM, ffmpeg, recadrage Python. |
| `redis`  | File BullMQ et bus de progression (publication/abonnement). |
| `mysql`  | Utilisateurs, jobs, clips. |

```
navigateur ──► web (nginx) ──► api (Fastify) ──► mysql
                                   │  ▲
                              BullMQ│  │SSE (Redis pub/sub)
                                   ▼  │
                                 redis ──► worker ──► yt-dlp / whisper.cpp / LLM / ffmpeg
                                                          │
                                                    volume media (partagé api ↔ worker)
```

Le traitement est **asynchrone** : l'api crée un job et répond `202 { jobId }`,
elle n'attend jamais la fin. Le worker traite **une vidéo à la fois**
(`concurrency: 1`) pour tenir dans les quotas gratuits et ne pas saturer le CPU.

### Points d'entrée de l'api

| Méthode et route | Rôle |
|---|---|
| `POST /api/uploads` | Envoi d'un fichier vidéo (multipart, en flux). Renvoie un `uploadId` opaque. |
| `POST /api/jobs` | Crée un job depuis `youtubeUrl` **ou** `uploadId`. Répond `202 { jobId }`. |
| `GET /api/jobs` | Historique paginé, limité aux jobs du demandeur. |
| `GET /api/jobs/:id` | État du job et ses clips, avec liens de téléchargement signés. |
| `GET /api/jobs/:id/events` | Flux SSE de progression. |
| `DELETE /api/jobs/:id` | Supprime le job et ses fichiers (refusé pendant le traitement). |
| `POST /api/clips/:id/restyle` | Ré-encode un clip avec un autre style ou cadrage. |
| `GET /api/clips/:id/subtitles` | Lignes de sous-titres réellement incrustées, en temps local. |
| `PUT /api/clips/:id/subtitles` | Enregistre des sous-titres corrigés et ré-encode le clip. |
| `GET /api/clips/:id/subtitles.srt` / `.vtt` | Export des sous-titres. |
| `GET /api/clips/:id/download` | Sert le MP4 via un lien signé à durée limitée. |
| `GET /api/jobs/:id/clips.zip` | Archive de tous les clips + un mémo texte de publication. |
| `POST /api/clips/:id/published` | Marque un clip comme publié sur YouTube ou TikTok. |
| `GET /health` | Sonde de santé (MySQL, Redis). |

Erreurs uniformes : `{ error: { code, message } }`. Codes : `INVALID_URL`,
`VIDEO_TOO_LONG`, `DOWNLOAD_FAILED`, `NO_SPEECH`, `TRANSCRIPTION_FAILED`,
`QUOTA_EXCEEDED`, `PROVIDER_ERROR`, `UNSUPPORTED_FILE`, `FILE_TOO_LARGE`,
`UPLOAD_NOT_FOUND`, `RESTYLE_IN_PROGRESS`, `RESTYLE_UNAVAILABLE`, `RATE_LIMITED`,
`SUBTITLES_UNAVAILABLE`, `NOT_FOUND`, `FORBIDDEN`, `UNAUTHORIZED`, `CONFLICT`,
`LINK_EXPIRED`, `VALIDATION_FAILED`, `INTERNAL`.

### Arborescence

```
web/                  front Vue 3 + Vite + Tailwind v4 + Pinia + Vue Router
api/                  service Fastify
  src/routes/         jobs, clips, uploads, auth, health
  src/lib/            store MySQL, bus Redis, signature HMAC, schémas, mots de passe
  migrations/         001_init.sql (exécuté au démarrage, idempotent)
worker/               pipeline
  src/steps/          source, download, select, render, metadata, restyle, tracking, cleanup
  src/transcribe/     whispercpp, groq, interface commune
  src/llm/            gemini, groq, ollama, chaîne de bascule
  src/prompts/        gabarits LLM éditables (.txt)
  src/lib/            ffmpeg, ass, db, progress, retention, exec, schémas
  python/             track_crop.py (recadrage suivi, optionnel)
docker-compose.yml
.env.example
```

---

## 3. Démarrage rapide

Prérequis : Docker et Docker Compose. Aucun GPU.

```bash
cp .env.example .env
```

Éditez `.env` et renseignez au minimum :

- `MYSQL_PASSWORD` et `MYSQL_ROOT_PASSWORD` ;
- `SIGNING_SECRET` et `SESSION_SECRET`, générés avec :

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

- au moins un fournisseur LLM : `GEMINI_API_KEY` ou `GROQ_API_KEY`
  (voir [section 5](#5-obtenir-les-clés-dapi-gratuites)).

Puis :

```bash
docker compose up -d --build
```

L'application est sur <http://localhost:8080>.

Aucune étape manuelle supplémentaire n'est nécessaire :

- les tables MySQL sont créées au démarrage de l'api (migrations idempotentes) ;
- le modèle whisper.cpp est téléchargé automatiquement au premier lancement du
  worker, dans le volume `models` (environ 150 Mo pour `ggml-base.bin`).

Le premier `build` est long : il compile whisper.cpp depuis les sources.

Suivre les journaux :

```bash
docker compose logs -f worker
```

---

## 4. Configuration

Toutes les variables sont documentées une par une dans `.env.example`.
Les plus structurantes :

| Variable | Rôle |
|----------|------|
| `LLM_PROVIDER` / `LLM_PROVIDER_CHAIN` | Fournisseur préféré et ordre de bascule (`gemini,groq,ollama`). |
| `GEMINI_API_KEY`, `GROQ_API_KEY`, `OLLAMA_URL` | Accès aux fournisseurs. Toutes restent côté serveur. |
| `TRANSCRIBER` | `whispercpp` (défaut, sans clé, lent) ou `groq` (à quota, rapide). |
| `WHISPER_MODEL_PATH` | Modèle ggml. `ggml-base.bin` (rapide) ou `ggml-small.bin` (meilleur). |
| `MAX_VIDEO_MINUTES` | Durée maximale acceptée pour une vidéo source. |
| `TRACKING_CROP` | `1` (défaut) active le cadrage automatique sur le sujet ; `0` = recadrage centré. |
| `AUDIO_NORMALIZE` | `1` (défaut) aligne le volume sur -14 LUFS en deux passes. |
| `RENDER_FADE_OUT` | Durée du fondu de fermeture, en secondes. `0` le désactive. |
| `X264_PRESET`, `X264_CRF` | Compromis vitesse / taille / qualité du rendu final. |
| `AUTH_ENABLED` | `0` = mono-utilisateur sans compte ; `1` = comptes email/mot de passe. |
| `MAX_UPLOAD_MB` | Taille maximale d'un fichier envoyé. À garder ≤ `client_max_body_size` de nginx. |
| `KEEP_CUTS_FOR_RESTYLE` | `1` conserve les découpes pour permettre les reprises. |
| `CUT_PAD_SECONDS` | Marge conservée autour de chaque découpe ; rend les bornes ajustables. |
| `RETENTION_DAYS` | Âge de suppression automatique des générations. `0` = jamais. |
| `UPLOAD_TTL_HOURS` | Âge de suppression des fichiers envoyés jamais utilisés. |
| `RATE_LIMIT_*` | Fenêtre et plafonds de la limitation de débit. |
| `SIGNING_SECRET`, `SESSION_SECRET` | Signature des liens de téléchargement et des cookies. |

En `NODE_ENV=production`, l'api **refuse de démarrer** si les secrets sont restés
aux valeurs `change_me`.

---

## 5. Obtenir les clés d'API gratuites

Aucune de ces offres n'exige de carte bancaire pour le palier gratuit utilisé ici.
Les quotas évoluent : vérifiez-les chez chaque fournisseur.

### Google Gemini (LLM, choix par défaut)

1. Ouvrez <https://aistudio.google.com/apikey>.
2. Créez une clé d'API.
3. Renseignez `GEMINI_API_KEY` dans `.env`.

### Groq (LLM et transcription, très rapide)

1. Ouvrez <https://console.groq.com/keys>.
2. Créez une clé d'API.
3. Renseignez `GROQ_API_KEY`. Pour la transcription : `TRANSCRIBER=groq`.

### Ollama (repli local, sans clé ni quota)

```bash
docker compose --profile ollama up -d ollama
docker compose exec ollama ollama pull qwen2.5:3b
```

Puis `OLLAMA_URL=http://ollama:11434` (déjà par défaut). Ollama est le dernier
maillon de la chaîne : plus lent, sélection de moindre qualité, mais gratuit et
sans plafond. Comptez au moins 4 Go de RAM libre.

**Bascule automatique** : sur `429` ou quota atteint, le worker réessaie avec un
délai croissant (2 s, 4 s, 8 s… ou la valeur `Retry-After`), puis passe au
fournisseur suivant de la chaîne. Une clé invalide (`401`/`403`) provoque une
bascule immédiate, sans réessai inutile.

---

## 6. Développement local sans Docker

Prérequis : Node.js 20+, MySQL 8, Redis, ffmpeg (compilé **avec libass**),
yt-dlp, et whisper.cpp si vous utilisez la transcription locale.

```bash
# 1. Dépendances
(cd api && npm install)
(cd worker && npm install)
(cd web && npm install)

# 2. MySQL et Redis (les seuls services conteneurisés nécessaires)
docker compose up -d mysql redis

# 3. Trois terminaux
(cd api && npm run dev)     # http://localhost:3000
(cd worker && npm start)
(cd web && npm run dev)     # http://localhost:5173, proxy /api vers l'api
```

Le front en développement proxifie `/api` vers `http://localhost:3000`
(modifiable avec `API_ORIGIN`).

---

## 7. Tests

```bash
(cd api && npm test)      # 41 tests
(cd worker && npm test)   # 97 tests
(cd web && npm test)      # 6 tests
```

Deux suites du worker ont besoin d'outils externes et **s'ignorent proprement**
s'ils manquent, sans jamais être simulées :

```bash
# ffmpeg compilé avec libass, et un Python disposant d'OpenCV
cd worker && FFMPEG_BIN=/chemin/ffmpeg FFPROBE_BIN=/chemin/ffprobe \
  PYTHON_BIN=/chemin/python npm test
```

Couverture :

- **Validation d'URL** : formes `watch`, `youtu.be`, `shorts`, `live`, et rejets
  (autre domaine, identifiant malformé, playlist, `javascript:`, sous-domaine piégé).
- **JSON du LLM avec ajv** : sortie conforme, sortie invalide suivie d'**une seule
  relance avec l'erreur de validation jointe**, échec après deux essais, bascule
  sur `429`, `QUOTA_EXCEEDED` quand toute la chaîne est en quota.
- **Découpe ffmpeg** : sur un extrait généré à la volée, la durée du clip est dans
  une tolérance de 0,15 s ; le rendu vertical sort bien en 1080x1920 ; le point de
  focus déplace réellement la fenêtre de recadrage (vérifié sur les pixels).
- **SSE** : progression croissante puis état final `done`, et `error` immédiat pour
  un job déjà en échec.
- **Appartenance** : un second navigateur reçoit `403` sur le job d'un autre, en
  lecture comme en flux SSE, `404` sur un identifiant inexistant, et ne peut ni
  supprimer, ni re-styliser, ni réutiliser le fichier envoyé d'autrui.
- **Envoi de fichier** : format refusé (`415`), fichier trop volumineux (`413`),
  fichier vide, envoi de 3 Mo accepté, réutilisation d'un fichier déjà consommé
  (`409`), et vérification qu'aucun fichier refusé ne subsiste sur le disque.
- **Historique** : cloisonnement par propriétaire, pagination, bornes rejetées.
- **Suppression** : les fichiers disparaissent réellement du volume, un job en
  cours de traitement ne peut pas être supprimé.
- **Re-stylisation** : mise en file sans relancer de génération, refus immédiat
  quand les découpes ont été nettoyées, refus d'une seconde demande simultanée,
  et **ré-encodage réel** vérifié avec ffmpeg (sortie 1080x1920, fichier ASS
  régénéré avec le nouveau préréglage, découpe conservée, aucun fichier temporaire).
- **Rétention** : jobs expirés, fichiers envoyés orphelins, dossiers média sans
  job correspondant, et comportement quand la rétention est désactivée.
- **Nettoyage** : les livrables survivent, les intermédiaires non, l'option
  `KEEP_CUTS_FOR_RESTYLE` conserve bien les découpes.
- **Cadrage automatique** (OpenCV réel, vidéos de synthèse) : le cadre suit un
  sujet qui traverse l'image et finit du bon côté ; il ne tremble pas sur un plan
  fixe ; il se replace immédiatement après une coupe de plan au lieu de traverser
  l'écran ; il **refuse de suivre du bruit uniforme** ; la vitesse maximale est
  respectée entre deux positions ; un suivi jugé inexploitable est écarté au
  profit du recadrage centré ; un interpréteur Python absent ne casse rien.
- **Rendu** : sortie 1080x1920 dans les deux mises en page, graphe de filtres du
  fond flou valide, fondu de fermeture ajouté seulement s'il tient dans le clip,
  **aucun fondu d'ouverture**, et le point de focus déplace réellement les pixels.
- **Audio** : un clip trop faible ressort **mesuré à -14 LUFS ± 2** après rendu,
  et un passage totalement silencieux s'encode sans être normalisé — c'est le
  cas qui faisait échouer ffmpeg avant la mesure préalable.
- **Accroche incrustée** : bandeau au bon moment avec fondu, style distinct,
  coupe sur un mot entier, jamais au-delà de la durée du clip, et absence totale
  d'événement quand l'option est désactivée.
- **Traduction** : répartition d'un texte traduit sur la fenêtre d'un segment
  (mots longs plus longs, aucun chevauchement, fin calée sur le segment),
  conservation de l'original pour un segment non traduit, découpage en lots pour
  une transcription longue, et normalisation des codes de langue (`french` → `fr`)
  qui évite de traduire du français vers le français.
- **Marge de découpe** : la marge est bornée par les extrémités de la source, le
  clip livré garde la durée demandée malgré elle, et `CUT_PAD_SECONDS=0` rend la
  découpe exacte.
- **Ajustement des bornes** : déplacement réel vérifié à l'encodage (durée de
  sortie), marge restante recalculée, demande hors limites ramenée à la limite.
- **Correction des sous-titres** : texte corrigé réellement incrusté, lignes
  d'origine remplacées, corrections conservées lors d'un ré-encodage ultérieur,
  chevauchements et lignes vides écartés, cloisonnement par propriétaire.
- **Export** : SRT et WebVTT au format exact, lignes vides ignorées.
- **File d'attente** : position annoncée tant que le job attend, effacée dès que
  le traitement démarre.
- **Interface** : parité des dictionnaires français/anglais (mêmes clés, mêmes
  variables d'interpolation, aucune valeur vide), métadonnées de page présentes
  pour chaque route, et un message pour chaque code d'erreur de l'api.

Le test d'incrustation ASS est **ignoré** si le ffmpeg local n'a pas libass.
Pour le jouer avec un autre binaire :

```bash
cd worker && FFMPEG_BIN=/chemin/vers/ffmpeg FFPROBE_BIN=/chemin/vers/ffprobe npm test
```

---

## 8. Le pipeline en détail

### 8.1 Récupération de la source (`worker/src/steps/source.js`)

Deux voies derrière une seule sortie : le reste du pipeline ne connaît qu'un
`sourcePath`.

**Fichier envoyé** — le fichier est déplacé du dossier `uploads` vers le dossier
du job (déplacement, pas copie : le volume ne double pas), puis contrôlé avec
ffprobe : durée lisible, sous la limite, piste audio présente. Le nom du fichier,
privé de son extension, sert de titre. C'est la voie recommandée : elle ne dépend
pas du téléchargement YouTube et ne pose pas de question de droits.

**URL YouTube** — métadonnées d'abord, pour refuser une vidéo trop longue
**avant** de la télécharger :

```bash
yt-dlp --dump-single-json --no-playlist --no-warnings "<url>"
```

Puis :

```bash
yt-dlp -f "bv*[height<=1080]+ba/b[height<=1080]" --merge-output-format mp4 \
  --max-filesize 2048m -o "<media>/<jobId>/source.mp4" "<url>"
```

Échec → `DOWNLOAD_FAILED`. Vidéo trop longue → `VIDEO_TOO_LONG`.
Absence de piste audio → `NO_SPEECH`. L'URL est revalidée par le worker avant
d'atteindre yt-dlp, même si l'api l'a déjà validée.

### 8.2 Transcription avec timecodes au mot

Interface unique : `transcribe(mediaPath, workDir) -> { words: [{ text, start, end }] }`.

**whisper.cpp** (défaut, auto-hébergé, sans clé) :

```bash
ffmpeg -y -i source.mp4 -vn -ac 1 -ar 16000 -c:a pcm_s16le audio16k.wav
whisper-cli -m /models/ggml-base.bin -f audio16k.wav -t 4 \
  --dtw base -oj -ojf -of <media>/<jobId>/transcript -l auto
```

La sortie JSON est normalisée en mots : les tokens sont recomposés (un nouveau mot
commence à chaque token précédé d'une espace), les horodatages viennent de `t_dtw`
(unités de 10 ms, issu de l'alignement DTW) avec repli sur les offsets du token.
Le préréglage `--dtw` est déduit du nom du modèle (`ggml-small.en.bin` → `small.en`).

**Groq** (alternative à quota) : audio converti en FLAC 16 kHz mono, découpé en
tranches de 15 minutes si le fichier dépasse la limite d'envoi, puis
`response_format=verbose_json` avec `timestamp_granularities[]=word`. Les
horodatages de chaque tranche sont décalés puis fusionnés. En cas de quota, bascule
automatique sur whisper.cpp si le modèle local est présent.

Moins de 10 mots détectés → `NO_SPEECH`.

### 8.3 Sélection des moments

Gabarits éditables : `worker/src/prompts/selection.system.txt` et `selection.user.txt`.
La transcription est réduite en segments `[début-fin] texte`. Au-delà de
`MAX_TRANSCRIPT_CHARS`, elle est découpée en fenêtres traitées séparément, chacune
recevant un quota d'extraits proportionnel à sa durée.

Sortie JSON stricte validée par **ajv**, relancée une fois avec l'erreur de
validation si elle est invalide. Puis nettoyage : bornes ramenées dans la vidéo,
alignement sur les débuts et fins de mots, durées ramenées entre `minSeconds` et
`maxSeconds`, suppression des chevauchements, tri par score décroissant,
troncature à `clipCount`.

### 8.4 Découpe

```bash
ffmpeg -y -ss <start> -to <end> -i source.mp4 \
  -c:v libx264 -preset veryfast -crf 20 -c:a aac -b:a 128k -movflags +faststart cut_00.mp4
```

`-ss` placé **avant** `-i` avec ré-encodage : coupe précise à l'image.

La découpe déborde volontairement de `CUT_PAD_SECONDS` (2,5 s par défaut) de
part et d'autre, et le rendu final rogne cette marge. Elle ne coûte presque
rien en disque et change tout à l'usage : les secondes qui manquent à un
extrait qui démarre trop tard **existent encore**, ce qui rend les bornes
ajustables après coup sans conserver la vidéo source.

### 8.5 Mise en page verticale et cadrage

Deux mises en page, choisies par l'utilisateur :

**`crop` (défaut)** — recadrage 9:16, fusionné avec les sous-titres en une
seule passe :

```
crop@dyn=w='min(ih*9/16\,iw)':h=ih:x='clip(iw*0.5000-(min(ih*9/16\,iw))/2\,0\,iw-(min(ih*9/16\,iw)))':y=0,
scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,ass=clip_00.ass
```

**`blur`** — la vidéo entière est conservée, centrée, sur un fond constitué
d'elle-même agrandie, floutée et assombrie :

```
split=2[bgsrc][fgsrc];
[bgsrc]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=32,eq=brightness=-0.10:saturation=0.85[bg];
[fgsrc]scale=1080:1920:force_original_aspect_ratio=decrease[fg];
[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,ass=clip_00.ass
```

Aucune information n'est perdue : c'est la bonne réponse sur un plan large, une
diapositive ou deux interlocuteurs, là où le recadrage couperait l'essentiel.

#### Cadrage automatique sur le sujet

Le recadrage 16:9 vers 9:16 jette près de la moitié de l'image : décider *où*
regarder est le seul endroit du pipeline où un mauvais choix se voit
immédiatement. `worker/python/track_crop.py` échantillonne le clip à 5 images
par seconde et décide en cascade :

1. **visage** — MediaPipe s'il est installé, sinon cascade de Haar OpenCV. En
   présence de plusieurs visages, le plus grand l'emporte, avec une prime de
   continuité pour celui qui est le plus proche de la cible précédente : sans
   elle, le cadre saute d'un interlocuteur à l'autre à chaque image ;
2. **saillance** — quand aucun visage n'est vu (plan large, dos, mains,
   diapositive), le centre d'énergie horizontal est calculé à partir du
   mouvement et des contours, et retenu **seulement si l'énergie est
   réellement concentrée** ; sur du bruit uniforme, mieux vaut ne rien suivre ;
3. **maintien** — dernière position connue, puis retour au centre.

Trois garde-fous temporels évitent l'écueil classique du recadrage
automatique, le cadre qui tremble :

- **coupes de plan** détectées par corrélation d'histogrammes : le lissage est
  réinitialisé, le cadre se replace instantanément au lieu de traverser l'écran ;
- **zone morte** : un déplacement inférieur à 2 % de la largeur est ignoré ;
- **vitesse maximale** : 35 % de la largeur par seconde, ce qui transforme un
  saut en panoramique.

Un filtre « one euro » lisse ce qui reste. Le résultat est converti en fichier
`sendcmd` qui pilote `crop@dyn x` pendant la passe d'encodage — aucun encodage
supplémentaire.

Le suivi est **écarté automatiquement** quand il n'apporterait rien ou serait
mauvais : mise en page `blur`, source déjà verticale, visage vu dans moins de
15 % des images sans saillance constante (seuil : 70 %), OpenCV absent, script
en erreur. Dans tous ces cas le recadrage centré ajustable reprend la main,
silencieusement.

### 8.6 Sous-titres karaoké

Fichier ASS généré depuis les mots horodatés (`worker/src/lib/ass.js`), avec une
balise `\k` par mot. En ASS, un mot s'affiche en `SecondaryColour` tant qu'il n'est
pas prononcé puis passe en `PrimaryColour` : la surbrillance progresse mot à mot.

Trois préréglages : `punch` (majuscules, surbrillance jaune), `clean` (sobre,
surbrillance cyan), `boxed` (bandeau opaque). Regroupement en cartes de 1 à 3 lignes,
coupées sur les silences de plus de 0,7 s et au bout de 3,5 s.

**Accroche incrustée** (option) : la phrase d'accroche du clip est affichée en
bandeau haut sur ses 2,4 premières secondes, avec un style ASS distinct et un
fondu court. Une large partie des vues de format court se fait sans le son : un
clip qui annonce son sujet en texte dès la première image est compris même en
muet.

**Sous-titres traduits** (option) : quand la langue des sous-titres diffère de
la langue parlée, la transcription des passages retenus — et d'eux seuls, pour
ne pas gaspiller de quota — est traduite par segments, puis chaque segment
traduit est réparti sur la fenêtre temporelle d'origine proportionnellement à
la longueur des mots. Traduire mot à mot est impossible (l'ordre des mots
change d'une langue à l'autre) ; la répartition par segment garde le karaoké
synchronisé avec la voix, ce qui est tout ce qu'on demande à un sous-titre.

**Qualité audio** : le volume de chaque clip est aligné sur -14 LUFS, la cible
des plateformes, en deux passes — mesure puis gain constant. La passe unique de
`loudnorm` compresse dynamiquement et « pompe » ; deux passes appliquent un gain
linéaire. Un passage totalement silencieux n'est pas normalisé : `loudnorm`
produirait des valeurs non numériques et l'encodage échouerait.

### 8.7 Métadonnées par clip

Gabarits `metadata.system.txt` et `metadata.user.txt`, sortie JSON validée par ajv
avec une relance en cas d'invalidité. Post-traitement : `#Shorts` garanti dans le
titre YouTube sans dépasser 100 caractères et sans couper un mot, hashtags
normalisés (préfixe `#`, sans espace ni ponctuation, dédoublonnés, plafonnés),
légende TikTok ramenée à 150 caractères.

### 8.8 Stockage et nettoyage

Les MP4 finaux vivent dans `<MEDIA_DIR>/<jobId>/clip_XX.mp4`. Ils sont servis par
des liens signés HMAC à durée limitée (`SIGNED_URL_TTL`, 15 minutes par défaut).
Après succès, `source.*`, l'audio extrait, le transcript brut et les fichiers de
suivi sont supprimés. Les découpes `cut_*.mp4` sont **conservées** quand
`KEEP_CUTS_FOR_RESTYLE=1` (défaut) : c'est ce qui permet de re-styliser un clip
plus tard. En cas d'échec, **tout le dossier du job** est supprimé. La
transcription normalisée (`words.json`) reste sur le volume média, jamais en base.

### 8.9 Reprendre la main sur un clip (`worker/src/steps/restyle.js`)

Trois reprises passent par le même ré-encodage d'un seul clip : **style**,
**bornes**, **sous-titres**. Le fichier ASS est régénéré, puis le clip est
ré-encodé vers un fichier temporaire avant d'être mis en place par un
renommage — le clip servi n'est jamais un fichier à moitié écrit.

**Bornes.** Les nouvelles bornes sont ramenées dans la marge réellement
disponible (`pad_start`, `pad_end`), avec une durée minimale de 5 s. Une demande
hors limites est bornée, pas refusée : l'utilisateur obtient le maximum de ce
qui est possible. Le rendu rogne le fichier de découpe à la nouvelle position,
et la marge restante suit le déplacement.

**Sous-titres.** Le worker écrit à chaque rendu `clip_XX.lines.json` : les
lignes réellement incrustées. C'est ce que l'interface propose de corriger,
donc exactement ce qui est à l'écran. Un texte corrigé est réparti sur la
fenêtre temporelle de sa ligne proportionnellement à la longueur des mots : le
karaoké reste synchronisé. Les lignes sont stockées en **temps absolu**, ce qui
leur permet de survivre à un déplacement des bornes, et sont conservées d'un
ré-encodage à l'autre.

L'api ne touche jamais au volume média : elle valide, puis transmet les lignes
au worker, seul propriétaire des fichiers du job.

Ni téléchargement, ni transcription, ni appel LLM : **aucun quota gratuit n'est
consommé**. Si les découpes ont été nettoyées, l'api le sait avant même de mettre
la tâche en file (elle partage le volume média) : le bouton est désactivé côté
interface et l'appel répond `410 RESTYLE_UNAVAILABLE`, sans faire attendre pour rien.

### 8.11 Deux stratégies de découpage

Le choix se fait à la génération, entre deux façons de traiter la vidéo :

- **Les meilleurs moments** (défaut) — des extraits indépendants, pris là où la
  vidéo est la plus forte, triés par potentiel. Chacun se suffit à lui-même et
  se publie dans n'importe quel ordre.
- **Des épisodes à la suite** — une série numérotée dans l'ordre de la vidéo.

Quand le mode série est actif, la sélection ne cherche plus les meilleurs moments
indépendants mais une **progression** : le premier extrait porte la promesse la
plus forte, chacun laisse une question ouverte, le dernier apporte la
révélation. Les clips sortent dans l'ordre chronologique de la vidéo.

Les métadonnées de chaque épisode reçoivent son rang et **l'accroche de
l'épisode suivant**, qu'elles annoncent sans la résumer. Le titre commence par
« Partie 2/3 — » et l'appel à l'abonnement est formulé comme une raison de
revenir. Le dernier épisode ne promet pas de suite : il renvoie au début de la
série.

Les consignes vivent dans `worker/src/prompts/selection.series.txt` et
`metadata.series.txt`, éditables sans toucher au code.

### 8.10 Rétention (`worker/src/lib/retention.js`)

Un passage périodique, lancé au démarrage du worker puis toutes les
`RETENTION_INTERVAL_MINUTES` :

1. jobs terminés plus vieux que `RETENTION_DAYS`, avec leurs fichiers ;
2. fichiers envoyés jamais utilisés, plus vieux que `UPLOAD_TTL_HOURS` ;
3. dossiers média orphelins, sans job correspondant en base.

Sans ce passage, conserver les découpes remplirait le disque du VPS sans limite.

---

## 9. Sécurité

- **Aucune clé d'API n'atteint le navigateur.** Le front n'appelle que sa propre
  origine ; toutes les clés sont lues côté serveur depuis l'environnement. La
  politique de sécurité de contenu de nginx interdit toute connexion sortante
  (`connect-src 'self'`).
- **Validation systématique côté serveur** : schémas JSON compilés par ajv sur
  chaque corps, paramètre et requête ; URL YouTube revalidée par le serveur même
  si le navigateur l'a déjà vérifiée.
- **Requêtes MySQL paramétrées** partout, sans exception.
- **Appartenance** : chaque job porte une `owner_key`. Avec `AUTH_ENABLED=1` c'est
  `user:<id>` ; sinon c'est `anon:<session>`, issue d'un cookie **signé, httpOnly,
  sameSite=lax**, `secure` dès que `PUBLIC_BASE_URL` est en HTTPS. Un identifiant
  deviné dans l'URL renvoie `403`, en lecture comme en SSE. Le comportement est
  couvert par un test.
- **Téléchargements** : jamais de chemin de fichier exposé ni accepté. Le lien
  porte une signature HMAC de `(clipId, expiration)` et le fichier servi doit se
  trouver dans le volume média (garde-fou contre la traversée de chemin).
- **Mots de passe** : `scrypt` via `node:crypto`, sans dépendance native. Message
  identique pour un email inconnu et un mot de passe faux (pas d'énumération).
- **Limitation de débit** : globale par identité, plus stricte sur la création de
  jobs et sur l'authentification, adossée à Redis (donc partagée entre instances).
- **En-têtes** : Helmet côté api ; nginx ajoute CSP, `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`. HSTS est activé
  quand l'URL publique est en HTTPS.
- **Journalisation** : étapes et erreurs journalisées côté serveur avec le détail
  technique ; l'utilisateur ne reçoit qu'un message neutre et un code d'erreur.
  Les en-têtes (donc les cookies) ne sont jamais journalisés.
- **Envoi de fichier** : lecture en flux, jamais en mémoire ; extension contrôlée
  contre une liste blanche ; taille plafonnée par `MAX_UPLOAD_MB` côté Fastify
  **et** côté nginx ; **le nom du fichier stocké est entièrement généré** (jeton
  aléatoire de 32 caractères), donc rien de ce que fournit l'utilisateur ne se
  retrouve dans un chemin ; le fichier n'est jamais servi ni exécuté, seul le
  worker le lit ; un fichier refusé ne laisse rien sur le disque.
  Un `uploadId` est un jeton opaque : demander celui d'un autre renvoie
  `404`, jamais `403`, donc aucun moyen de tester l'existence d'un identifiant.
- **Commandes externes** : lancées sans shell, arguments passés en tableau — aucune
  interpolation, donc aucune injection possible via une URL, un titre de vidéo ou
  un nom de fichier envoyé.

---

## 10. Déploiement Dokploy sur OVH

1. **Préparer le dépôt.** Poussez ce monorepo sur GitHub, GitLab ou votre Gitea.

2. **Créer le projet dans Dokploy.**
   Dokploy → *Projects* → *Create Project* → nommez-le `ytshorter`.

3. **Ajouter une application de type Compose.**
   Dans le projet → *Create Service* → **Compose**.
   - *Provider* : votre dépôt Git, branche `main`.
   - *Compose Path* : `docker-compose.yml`.
   - Laissez le *Build Path* à la racine.

4. **Renseigner les variables d'environnement.**
   Onglet *Environment* du service Compose : collez le contenu de `.env.example`
   et remplissez les valeurs. À adapter impérativement :
   - `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD` ;
   - `SIGNING_SECRET`, `SESSION_SECRET` (générés, jamais réutilisés) ;
   - `PUBLIC_BASE_URL=https://votre-domaine.tld` ;
   - `NODE_ENV=production` ;
   - au moins une clé LLM.

   Ces variables sont injectées dans `docker compose` : elles alimentent
   l'interpolation du fichier Compose **et** le `env_file` des services.
   Créez donc aussi un fichier `.env` via l'onglet *Environment* si votre version
   de Dokploy le propose, ou retirez les lignes `env_file: .env` et laissez la
   section `environment:` prendre le relais.

5. **Déployer.** Bouton *Deploy*. Le premier build compile whisper.cpp : comptez
   dix à vingt minutes selon le VPS. Suivez les journaux dans l'onglet *Logs*.

6. **Associer le domaine et activer HTTPS.**
   Onglet *Domains* du service Compose :
   - *Host* : `votre-domaine.tld` ;
   - *Service Name* : `web` ;
   - *Container Port* : `80` ;
   - *HTTPS* : activé, *Certificate Provider* : Let's Encrypt.

   Faites pointer l'enregistrement DNS `A` de votre domaine vers l'IP du VPS OVH
   **avant** de demander le certificat.

7. **Vérifier la persistance des volumes.**
   Les volumes `mysql-data`, `redis-data`, `media`, `models` sont déclarés comme
   volumes Docker nommés : ils survivent aux redéploiements. Ne les recréez pas.
   Vérification :

   ```bash
   docker volume ls | grep ytshorter
   ```

8. **Mettre à jour une installation existante.** Les migrations sont suivies dans
   une table `schema_migrations` : au redéploiement, l'api applique uniquement
   celles qui manquent, une seule fois. Rien à lancer à la main. Pour vérifier :

   ```bash
   docker compose exec mysql mysql -u root -p"$MYSQL_ROOT_PASSWORD" ytshorter -e "SELECT * FROM schema_migrations"
   ```

9. **Sauvegardes.** Au minimum la base :

   ```bash
   docker compose exec mysql mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" ytshorter > sauvegarde.sql
   ```

   Le volume `media` ne contient que des clips régénérables ; le volume `models`
   se retélécharge tout seul.

### Dimensionnement du VPS

| Ressource | Minimum | Confortable |
|-----------|---------|-------------|
| vCPU | 2 | 4 et plus (whisper.cpp et x264 sont limités par le CPU) |
| RAM | 4 Go | 8 Go, et 8 Go de plus si vous activez Ollama |
| Disque | 20 Go | 40 Go (whisper.cpp compilé, images, sources temporaires) |

Ajustez `WHISPER_THREADS` au nombre de vCPU.

---

## 11. Exploitation et dépannage

**Suivre un traitement**

```bash
docker compose logs -f worker
```

**Le worker signale « OUTIL MANQUANT »** — au démarrage, il vérifie `ffmpeg`,
`ffprobe`, `yt-dlp`, `whisper-cli` et la présence du modèle, et le journalise.
Reconstruisez l'image du worker.

**`DOWNLOAD_FAILED` — « Sign in to confirm you're not a bot »** — depuis un VPS,
YouTube bloque les IP de datacenter. Deux parades :

1. **Upload direct du fichier** (`.mp4`) via l'onglet « Mon fichier vidéo » : ne
   dépend pas de YouTube, c'est la voie fiable.
2. **Cookies YouTube** pour yt-dlp, pour garder les URL YouTube. Exportez un
   fichier `cookies.txt` depuis un navigateur **connecté à YouTube** (extension
   « Get cookies.txt LOCALLY », de préférence avec un compte Google secondaire),
   encodez-le en base64 sur une seule ligne :

   ```bash
   base64 -w0 cookies.txt   # Linux   (macOS : base64 -i cookies.txt)
   ```

   Collez la chaîne obtenue dans `YTDLP_COOKIES_B64` (onglet Environment de
   Dokploy), puis redéployez. Le worker écrit les cookies dans un fichier et les
   passe à yt-dlp via `--cookies`. Les cookies YouTube **expirent au bout de
   quelques semaines** : il faudra les régénérer. Automatiser le téléchargement
   d'un compte peut aussi le faire signaler par YouTube — utilisez un compte
   dédié, pas votre compte principal.

**`DOWNLOAD_FAILED` autre cas** (vidéo privée, géobloquée, supprimée)

```bash
docker compose exec worker pip3 install --break-system-packages --upgrade yt-dlp
docker compose restart worker
```

**Transcription trop lente** — passez à `TRANSCRIBER=groq` (quota, mais rapide),
ou gardez `whispercpp` avec `ggml-base.bin` et augmentez `WHISPER_THREADS`.

**`QUOTA_EXCEEDED`** — la chaîne complète est épuisée. Ajoutez une seconde clé
(Gemini *et* Groq), ou activez Ollama comme repli sans quota.

**Sous-titres absents de la vidéo finale** — le ffmpeg utilisé n'a pas libass.
L'image Docker du worker utilise le paquet `ffmpeg` de Debian, qui l'inclut.

**Changer le modèle whisper** — modifiez `WHISPER_MODEL_PATH` (par exemple
`/models/ggml-small.bin`) et redémarrez le worker : il téléchargera le nouveau
modèle automatiquement.

**Le volume média grossit** — vérifiez que `RETENTION_DAYS` n'est pas à `0`, et
regardez ce qui occupe la place :

```bash
docker compose exec api du -sh /media/* | sort -h | tail -20
```

Conserver les découpes coûte environ 5 à 15 Mo par clip. Passez
`KEEP_CUTS_FOR_RESTYLE=0` si le disque est serré, au prix de la re-stylisation.

**« Le style de ce clip ne peut plus être changé »** — les découpes de ce job ont
été nettoyées, par la rétention ou par `KEEP_CUTS_FOR_RESTYLE=0`. C'est définitif
pour ce job : relancez une génération.

**Un envoi de fichier échoue en 413 derrière le proxy** — `MAX_UPLOAD_MB` dépasse
le `client_max_body_size` de `web/nginx.conf` (512 Mo par défaut) ou celui du
proxy Dokploy. Alignez les trois.

---

## 12. Décisions d'implémentation

Décisions prises sans arbitrage extérieur, et leur raison.

1. **Une colonne `owner_key` s'ajoute à la table `jobs`.** Le cahier des charges
   demande un contrôle d'appartenance opérationnel même sans comptes. `user_id`
   seul ne suffit pas en mode anonyme : `owner_key` porte soit `user:<id>`, soit
   `anon:<session signée>`.
2. **whisper.cpp reçoit un WAV 16 kHz, pas le MP4.** Le binaire n'accepte que du
   PCM 16 kHz ; une extraction ffmpeg préalable est donc indispensable pour que la
   commande fonctionne réellement. Le fichier temporaire est supprimé aussitôt.
3. **`-ojf` en plus de `-oj`.** Seule la sortie JSON *complète* de whisper.cpp
   contient les tokens et leurs `t_dtw` : sans elle, pas d'horodatage au mot.
4. **Recadrage et sous-titres comptent pour une seule étape (`render`).** Les deux
   se font dans la même passe d'encodage ; annoncer deux étapes distinctes aurait
   été un affichage trompeur. L'interface l'intitule « Recadrage et sous-titres ».
5. **La chaîne de filtres dépasse l'exemple du cahier des charges.** Le
   `scale`/`crop` supplémentaire évite de déformer une source déjà verticale ou de
   proportions inhabituelles.
6. **Un échec de génération des métadonnées fait échouer le job.** Le modèle de
   données n'a pas d'état « terminé avec réserves » ; renvoyer des clips sans titre
   ni description aurait été un demi-résultat silencieux. Le code d'erreur exact
   (`QUOTA_EXCEEDED`, `PROVIDER_ERROR`) est affiché.
7. **Les transcriptions longues sont traitées par fenêtres.** Une vidéo d'une heure
   dépasse le contexte utile d'un petit modèle gratuit ; chaque fenêtre reçoit un
   quota d'extraits proportionnel à sa durée, puis tout est fusionné et dédoublonné.
8. **`youtube.js` est dupliqué à l'identique dans `api` et `worker`.** Cela garde
   deux images Docker indépendantes, sans paquet partagé à publier. Un test vérifie
   que les deux copies ne divergent pas.
9. **Le mot de passe utilise `scrypt` de `node:crypto`.** Aucune dépendance native
   à compiler, donc aucun problème d'architecture sur un VPS ARM ou x86.
10. **L'interface est en français par défaut, avec l'anglais disponible.** La langue
    des métadonnées générées est un réglage séparé, comme demandé.
11. **Aucun texte légal n'est inventé.** L'accueil et le pied de page contiennent un
    emplacement explicitement marqué à remplir. Aucun faux témoignage, aucun
    compteur d'utilisateurs fictif.
12. **L'envoi direct d'un fichier vidéo est implémenté** et mis en avant dans
    l'interface. C'est la réponse au risque principal du projet : pas de
    téléchargement YouTube, pas de question de droits sur le contenu d'autrui.
    Le pipeline ne connaît qu'un `sourcePath`, quelle que soit la source.
13. **Les découpes survivent au nettoyage par défaut** (`KEEP_CUTS_FOR_RESTYLE=1`),
    ce qui s'écarte du nettoyage strict initial. Sans elles, changer un style de
    sous-titres imposerait de relancer téléchargement, transcription et appels LLM
    — plusieurs minutes et du quota gratuit brûlé pour un changement de couleur.
    L'intention du nettoyage (ne rien laisser traîner indéfiniment) est tenue par
    la rétention automatique. Passez la variable à `0` pour le comportement strict.
14. **La suppression d'un job en cours de traitement est refusée** plutôt que
    gérée par une annulation. Annuler proprement demanderait de tuer les processus
    ffmpeg en cours et de retirer la tâche de la file : beaucoup de complexité pour
    un cas rare. Le message dit d'attendre la fin.
15. **La disponibilité de la re-stylisation est calculée par l'api**, qui partage
    le volume média avec le worker. Mettre en file une tâche vouée à échouer pour
    afficher l'erreur trente secondes plus tard aurait été une mauvaise réponse.
16. **Le style de sous-titres se choisit sur un aperçu visuel**, pas dans une liste
    déroulante. Choisir un style à l'aveugle puis attendre plusieurs minutes pour
    découvrir le résultat est le genre de détail qui rend un outil pénible.
17. **L'historique est rattaché à la clé de propriétaire**, donc à la session
    anonyme quand l'authentification est désactivée. Vider ses cookies fait perdre
    l'accès à ses générations : c'est le prix du mode sans compte. Activez
    `AUTH_ENABLED=1` pour un historique durable.
18. **Le cadrage automatique est activé par défaut.** Le recadrage centré coupe
    le sujet dès qu'il n'est pas au milieu, ce qui est le cas courant. Le coût est
    une passe d'analyse Python par clip ; les replis sont automatiques et
    silencieux à chaque étape, donc le pire cas reste le comportement précédent.
19. **La normalisation audio se fait en deux passes**, pas en une. La passe
    unique de `loudnorm` compresse dynamiquement : sur une voix, cela s'entend.
    La mesure préalable coûte une lecture audio de quelques centaines de
    millisecondes et permet en prime de détecter les passages silencieux, qui
    faisaient échouer l'encodage.
20. **Pas de fondu d'ouverture.** C'est contre-intuitif pour qui vient de la
    vidéo longue, mais deux dixièmes de seconde de noir au début d'un Short, ce
    sont deux dixièmes de seconde d'accroche perdue.
21. **La traduction ne porte que sur les passages retenus**, pas sur la vidéo
    entière : c'est environ dix fois moins de texte envoyé au fournisseur, donc
    dix fois moins de quota gratuit consommé pour le même résultat.
22. **L'étape « traduction » n'apparaît dans l'interface que si elle a lieu.**
    Afficher une étape qui ne s'exécutera jamais serait un mensonge d'affichage.
23. **Les découpes débordent de 2,5 secondes de chaque côté.** C'est ce qui rend
    les bornes ajustables sans conserver la vidéo source, laquelle pèse mille
    fois plus lourd. Le coût est d'environ 10 % de disque en plus par clip.
24. **Une borne hors marge est ramenée à la limite, pas refusée.** Une erreur
    « impossible » sur un curseur qu'on vient de déplacer n'apprend rien ; obtenir
    le maximum de ce qui est possible, si.
25. **Les sous-titres s'éditent par ligne, pas par mot.** Le découpage en mots
    sert au karaoké, pas à l'écriture. Le texte corrigé est redistribué sur la
    fenêtre de la ligne : la synchronisation est conservée sans demander à
    personne de saisir des horodatages.
26. **L'api n'écrit jamais sur le volume média.** Les corrections transitent par
    la file, et le worker reste seul propriétaire des fichiers d'un job : aucune
    course possible avec un ré-encodage en cours.

---

## 13. Limites assumées et risques

- **Le « 100 % gratuit » repose sur des quotas** : par minute, par jour ou par mois.
  En usage soutenu, les plafonds sont atteints. D'où la sérialisation des jobs, la
  bascule de fournisseur et le repli Ollama sans quota.
- **Les conditions des offres gratuites changent.** Chaque fournisseur est derrière
  une interface remplaçable (`llm/`, `transcribe/`) : en ajouter un demande un
  fichier et une entrée dans la chaîne.
- **Sans GPU, whisper.cpp est lent.** Comptez un temps de transcription du même
  ordre que la durée de la vidéo avec `ggml-base.bin` sur 4 vCPU. La sélection par
  un petit modèle local est nettement moins bonne qu'avec un gros modèle.
- **yt-dlp télécharge du contenu YouTube, ce qui va contre les conditions
  d'utilisation de YouTube.** Usage personnel acceptable, produit public risqué.
  L'envoi direct de fichier est la voie sans ce risque : c'est celle à mettre en
  avant, voire la seule à laisser active, pour une ouverture au public. Retirer
  l'ingestion YouTube revient à masquer l'onglet correspondant dans
  `web/src/views/HomeView.vue` et à refuser `youtubeUrl` côté api.
- **Découper et republier la vidéo d'un tiers pose une question de droits
  d'auteur.** L'usage légitime est le recyclage de son propre contenu.
- **Le cadrage automatique reste la partie la plus délicate.** Il est désormais
  activé par défaut, testé sur des séquences de synthèse (suivi, plan fixe, coupe
  de plan, bruit) et doté de replis silencieux à chaque étape — mais aucun test
  automatique ne remplace l'œil sur du contenu réel. La mise en page « fond flou »
  est la porte de sortie quand le recadrage ne convient pas, et la re-stylisation
  permet de changer d'avis clip par clip sans tout relancer.
- **La traduction des sous-titres dépend de la qualité du modèle gratuit.** La
  répartition temporelle est fiable ; la traduction elle-même vaut ce que vaut le
  fournisseur du moment. Relisez avant publication.
