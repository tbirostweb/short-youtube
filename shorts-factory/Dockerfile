# =====================================================================
#  Shorts Factory — image de production (dashboard web)
#  Conçue pour un déploiement Dokploy / Docker (voir docs/DEPLOY_DOKPLOY.md)
# =====================================================================
FROM python:3.11-slim

# FFmpeg (le paquet Debian inclut libass -> filtre `subtitles` OK),
# polices (Anton est fournie dans le repo) + Noto Color Emoji (emojis couleur
# sur Linux, sinon ils ne s'affichent pas) + fontconfig.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        fontconfig \
        fonts-dejavu-core \
        fonts-liberation \
        fonts-noto-color-emoji \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dépendances Python d'abord (cache Docker)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Code + assets (polices, b-roll, musique). Les secrets/sorties sont exclus
# via .dockerignore et fournis à l'exécution (variables d'env + volumes).
COPY . .

# En conteneur, FFmpeg par défaut a libass : pas de binaire custom.
ENV FFMPEG_BINARY="" \
    FFPROBE_BINARY="" \
    PYTHONUNBUFFERED=1

EXPOSE 8000

# Dashboard web : Dokploy le place derrière son reverse-proxy + ton domaine.
# (Pour lancer plutôt la boucle autonome : override la commande en `python main.py schedule`.)
CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
