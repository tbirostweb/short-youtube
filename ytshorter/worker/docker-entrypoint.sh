#!/bin/sh
# Prépare le worker avant de lancer le processus Node :
#  1. met yt-dlp à jour (best-effort) ;
#  2. installe les cookies YouTube s'ils sont fournis ;
#  3. télécharge le modèle whisper.cpp s'il est absent du volume.
set -e

# --- 1. Mise à jour de yt-dlp (best-effort) ---------------------------------
# YouTube casse régulièrement l'extracteur ; une version fraîche règle une
# partie des échecs de téléchargement. Ne bloque jamais le démarrage.
# IMPORTANT : en arrière-plan (&) et avec timeout, pour ne JAMAIS bloquer le
# démarrage du worker. Un pip lent ou bloqué ne doit pas empêcher le worker de
# consommer la file : il tournera avec la version de yt-dlp déjà installée, et
# la mise à jour s'appliquera quand elle sera prête.
if [ "${YTDLP_AUTO_UPDATE:-1}" = "1" ]; then
  echo "Mise à jour de yt-dlp lancée en arrière-plan…"
  (
    timeout 120 pip3 install --no-cache-dir --break-system-packages --upgrade yt-dlp >/dev/null 2>&1 \
      && echo "yt-dlp mis à jour : $(yt-dlp --version 2>/dev/null)" \
      || echo "yt-dlp : mise à jour ignorée (réseau/timeout), version en place conservée." >&2
  ) &
fi

# --- 2. Cookies YouTube ------------------------------------------------------
# Contourne le blocage « Sign in to confirm you're not a bot » des IP de
# datacenter. Les cookies sont fournis en base64 dans YTDLP_COOKIES_B64
# (une seule ligne, pratique pour l'onglet Environment de Dokploy) et décodés
# vers le fichier que le worker lira (config.ytDlpCookiesFile).
COOKIES_FILE="${YTDLP_COOKIES_FILE:-/tmp/yt-cookies.txt}"
if [ -n "$YTDLP_COOKIES_B64" ]; then
  if echo "$YTDLP_COOKIES_B64" | base64 -d > "$COOKIES_FILE" 2>/dev/null && [ -s "$COOKIES_FILE" ]; then
    chmod 600 "$COOKIES_FILE"
    echo "Cookies YouTube installés ($(wc -l < "$COOKIES_FILE") lignes) → téléchargements authentifiés."
  else
    rm -f "$COOKIES_FILE"
    echo "ATTENTION : YTDLP_COOKIES_B64 illisible (base64 invalide ?). yt-dlp tournera sans cookies." >&2
  fi
fi

# --- 3. Modèle whisper.cpp ---------------------------------------------------
MODEL_PATH="${WHISPER_MODEL_PATH:-/models/ggml-base.bin}"
TRANSCRIBER="${TRANSCRIBER:-whispercpp}"

if [ "$TRANSCRIBER" = "whispercpp" ] && [ ! -f "$MODEL_PATH" ]; then
  MODEL_NAME=$(basename "$MODEL_PATH")
  MODEL_DIR=$(dirname "$MODEL_PATH")
  mkdir -p "$MODEL_DIR"
  echo "Modèle whisper absent, téléchargement de ${MODEL_NAME}…"
  if curl -L --fail --retry 3 --retry-delay 5 \
      -o "${MODEL_PATH}.download" \
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_NAME}"; then
    mv "${MODEL_PATH}.download" "$MODEL_PATH"
    echo "Modèle installé dans ${MODEL_PATH}"
  else
    rm -f "${MODEL_PATH}.download"
    echo "ATTENTION : téléchargement du modèle impossible. La transcription locale échouera." >&2
  fi
fi

exec "$@"
