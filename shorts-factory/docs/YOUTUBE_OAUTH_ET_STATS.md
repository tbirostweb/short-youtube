# 🔌 Connecter YouTube : upload automatique + vraies stats

Ce guide t'accompagne pas à pas pour :
1. Autoriser le bot à **publier** sur tes chaînes (OAuth Google).
2. Brancher les **vraies statistiques** (vues / revenus / abonnés) dans le dashboard Analytics.

> ⏱️ Compte ~20 minutes la première fois. C'est une config unique.

---

## Partie 1 — Autoriser l'upload (OAuth)

L'API YouTube n'accepte pas une simple clé : il faut une autorisation OAuth (tu approuves une fois dans ton navigateur, le bot se ré-authentifie ensuite tout seul).

### Étape 1 — Créer un projet Google Cloud
1. Va sur **https://console.cloud.google.com/**
2. En haut, clique sur le sélecteur de projet → **Nouveau projet** → nomme-le (ex. `shorts-bot`) → **Créer**.

### Étape 2 — Activer les API nécessaires
Dans **APIs & Services → Bibliothèque**, active ces deux API (recherche + bouton *Activer*) :
- **YouTube Data API v3** → pour uploader les vidéos.
- **YouTube Analytics API** → pour les stats (partie 2).

### Étape 3 — Écran de consentement OAuth
1. **APIs & Services → Écran de consentement OAuth**.
2. Type **Externe** → *Créer*.
3. Renseigne un nom d'app + ton email. Passe les étapes.
4. Dans **Utilisateurs de test**, **ajoute l'adresse Google de CHAQUE chaîne** que tu veux gérer.
   > Tant que l'app est en mode *Test*, seuls ces comptes peuvent être utilisés — c'est parfait pour toi.

### Étape 4 — Créer les identifiants
1. **APIs & Services → Identifiants → Créer des identifiants → ID client OAuth**.
2. Type d'application : **Application de bureau**.
3. Télécharge le fichier JSON, renomme-le **`client_secret.json`**, et place-le dans le dossier **`credentials/`** du projet.

### Étape 5 — Autoriser chaque chaîne
Le `client_secret.json` est **partagé** ; tu t'authentifies une fois par chaîne avec le bon compte Google :

```bash
cd "/Users/theo/Documents/code perso/BotYt"
source .venv/bin/activate        # ou PYTHONPATH=. avant python

python main.py auth --channel fr1   # ouvre le navigateur → connecte le compte de la chaîne FR 1
python main.py auth --channel fr2
python main.py auth --channel en1
python main.py auth --channel en2
```

À chaque fois : le navigateur s'ouvre → tu choisis le compte Google de cette chaîne → tu approuves → un fichier `credentials/token_<chaîne>.json` est créé. C'est terminé pour cette chaîne.

Vérifie l'état :
```bash
python main.py channels
```

### Étape 6 — Publier
- Depuis le dashboard : coche **« Publier sur YouTube »** avant de générer.
- Depuis l'Excel : mets `oui` dans la colonne **publier** (et une date dans **date_publication** pour programmer).
- En ligne de commande : `python main.py batch mon_fichier.xlsx` (upload selon la colonne `publier`).

> ⚠️ **Quota** : un projet Google autorise ~**6 uploads/jour** (un upload = 1600 unités sur 10 000). Pour 4 chaînes → vise ~6/jour au total au début, ou demande une augmentation de quota à Google. Commence en `privacy: unlisted` le temps de valider tes rendus (dans `config.yaml` → `youtube.privacy` et par chaîne).

---

## Partie 2 — Brancher les vraies statistiques

Aujourd'hui, la page **Analytics** du dashboard affiche des chiffres **factices** (bannière « Aperçu »). Voici comment la connecter aux vraies données une fois l'OAuth en place.

### Ce qu'il faut
- Les mêmes tokens OAuth que la partie 1, **mais avec un scope lecture en plus** :
  - `https://www.googleapis.com/auth/yt-analytics.readonly` (stats vues/rétention)
  - `https://www.googleapis.com/auth/youtube.readonly` (abonnés, liste vidéos)
- Les revenus (`estimatedRevenue`) nécessitent en plus `yt-analytics-monetary.readonly` **et** une chaîne **monétisée** (dans le Programme Partenaire YouTube). Sans monétisation, on affiche vues + abonnés + rétention seulement.

### Étape 1 — Ajouter les scopes
Dans `src/youtube/auth.py`, la constante `SCOPES` ne contient que l'upload. Ajoute la lecture :
```python
SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/yt-analytics.readonly",
    # "https://www.googleapis.com/auth/yt-analytics-monetary.readonly",  # revenus
]
```
Puis **ré-autorise** chaque chaîne (`python main.py auth --channel fr1` …) pour que les nouveaux tokens incluent ces droits.

### Étape 2 — Récupérer les données
- **Abonnés + nb de vidéos** : YouTube Data API v3 → `channels().list(part="statistics")`.
- **Vues / rétention / revenus par jour** : YouTube Analytics API →
  ```
  reports.query(
      ids="channel==MINE",
      startDate=..., endDate=...,
      metrics="views,estimatedMinutesWatched,averageViewPercentage,estimatedRevenue",
      dimensions="day",
  )
  ```

### Étape 3 — Remplacer le mock
Dans **`app.py`**, l'endpoint `GET /api/analytics` renvoie actuellement des données aléatoires. Il suffira de :
1. Pour chaque chaîne (`fr1, fr2, en1, en2`), charger son token (`credentials/token_<id>.json`) via `get_service`.
2. Appeler les deux API ci-dessus, agréger, et renvoyer le **même format JSON** que le mock (clés `total` et `channels[]` avec `subscribers`, `views_30d`, `revenue_30d`, `avg_retention`, `views_series`). La page `analytics.html` fonctionnera **sans aucune modification**.

> Le format de sortie est déjà défini : garde exactement les mêmes clés et la maquette se remplira automatiquement avec les vraies valeurs. Enlève juste `"mock": true`.

### Étape 4 — Fréquence
L'API Analytics a un quota confortable, mais évite d'appeler à chaque rafraîchissement de page : mets un **cache** (ex. recalcule toutes les 30 min) côté serveur.

---

## Récap express
| Objectif | Ce qu'il faut |
|---|---|
| Publier | client_secret.json + `auth --channel` pour chaque chaîne |
| Stats réelles | + scopes readonly, ré-auth, brancher `/api/analytics` sur les API |
| Revenus | + monétisation active + scope monetary |

Quand tu es prêt, je peux coder l'étape 2 (branchement réel des stats) — dis-moi juste quand tes chaînes sont créées et autorisées.
