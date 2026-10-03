# 🚀 Déployer le dashboard avec Dokploy

Ce guide met **le dashboard web** en ligne (génération + suivi depuis n'importe où).
La génération tourne alors sur ton serveur (FFmpeg inclus dans l'image).

> ⚠️ **Sécurité** : le dashboard peut générer ET publier sur tes chaînes.
> Une fois en ligne, il DOIT être protégé par un mot de passe (variable
> `DASHBOARD_PASSWORD`, voir plus bas). Ne déploie jamais sans.

---

## Prérequis
- Une instance **Dokploy** installée sur ton VPS.
- Ton code poussé sur un dépôt **Git** (GitHub/GitLab) — Dokploy build depuis le repo.
- Un **domaine** (ou sous-domaine) pointant vers ton serveur Dokploy.

Le `.dockerignore` exclut déjà `.env`, `credentials/*.json`, `output/`, la base et le venv :
tes secrets ne partent PAS dans l'image.

---

## Méthode recommandée : type « Application » (Dockerfile)

1. Dans Dokploy : **Create → Application**.
2. **Source** : connecte ton dépôt Git (branche `main`).
3. **Build Type** : **Dockerfile** (Dokploy détecte le `Dockerfile` à la racine).
4. **Port** : `8000`.
5. **Environment** (onglet Environment) — colle au minimum :
   ```
   DASHBOARD_USER=admin
   DASHBOARD_PASSWORD=un-mot-de-passe-long-et-unique
   PEXELS_API_KEY=ta_cle_pexels
   ```
   (facultatif : `ANTHROPIC_API_KEY` pour générer scripts/traductions par IA.)
6. **Domains** : ajoute ton domaine → port `8000` → active **HTTPS** (Let's Encrypt).
7. **Volumes** (onglet Advanced → Volumes) pour la persistance :
   | Type | Source | Destination |
   |---|---|---|
   | Volume | `sf_output` | `/app/output` |
   | Volume | `sf_data` | `/app/data` |
   | Volume | `sf_credentials` | `/app/credentials` |
8. **Deploy**. Dokploy build l'image et lance le conteneur.

Accède à `https://ton-domaine` → login `admin` + ton mot de passe. 🎉

---

## Alternative : type « Compose »
Le repo contient un `docker-compose.yml` prêt. Dans Dokploy : **Create → Compose**,
pointe le repo, renseigne les mêmes variables d'environnement, deploy.

---

## Ressources conseillées
Le montage FFmpeg (Ken Burns + sous-titres + audio) est gourmand en CPU.
Prévois au moins **2 vCPU / 2 Go RAM** pour un rendu fluide. Une vidéo ≈ 20–40 s de calcul.

---

## Publier sur YouTube depuis le serveur (OAuth)
L'autorisation OAuth a besoin d'un navigateur → **fais-la en local**, puis copie les
tokens sur le serveur :
1. En local : `python main.py auth --channel fr1` (crée `credentials/token_fr1.json`).
2. Copie le contenu de `credentials/` dans le volume `sf_credentials` du conteneur
   (via l'explorateur de fichiers Dokploy, ou `docker cp`).
3. Le `client_secret.json` aussi.
Ensuite, l'upload depuis le dashboard/serveur fonctionne (le token se rafraîchit seul).

Sans ces tokens, tout marche **sauf** l'upload (génération seule).

---

## Mettre à jour
Pousse sur Git → **Redeploy** dans Dokploy. Les volumes (vidéos, base, tokens) sont conservés.

---

## Dépannage
| Souci | Cause / fix |
|---|---|
| 401 en boucle | Mauvais `DASHBOARD_PASSWORD`, ou navigateur qui a mémorisé un mauvais login |
| Pas de sous-titres | Improbable (le paquet ffmpeg Debian a libass) ; vérifie les logs du build |
| Pas d'emojis | La police `fonts-noto-color-emoji` doit être installée (elle est dans le Dockerfile) |
| Rendu lent / OOM | Donne plus de CPU/RAM au conteneur |
| Upload échoue | Tokens OAuth absents dans `/app/credentials` (voir section OAuth) |
