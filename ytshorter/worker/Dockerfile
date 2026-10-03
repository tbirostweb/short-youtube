# --- Étape 1 : compilation de whisper.cpp (CPU uniquement, aucun GPU requis) ---
FROM debian:bookworm-slim AS whisper-build

# Épingler une révision précise pour des builds reproductibles :
#   docker compose build --build-arg WHISPER_CPP_REF=v1.7.4 worker
ARG WHISPER_CPP_REF=master

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential cmake git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 --branch "${WHISPER_CPP_REF}" https://github.com/ggml-org/whisper.cpp /src
WORKDIR /src
RUN cmake -B build \
      -DCMAKE_BUILD_TYPE=Release \
      -DBUILD_SHARED_LIBS=OFF \
      -DWHISPER_BUILD_TESTS=OFF \
      -DWHISPER_BUILD_SERVER=OFF \
    && cmake --build build -j"$(nproc)" --config Release

# --- Étape 2 : image d'exécution ---
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PYTHONUNBUFFERED=1

# ffmpeg : découpe, recadrage, incrustation des sous-titres
# fonts-dejavu-core : police utilisée par les styles de sous-titres ASS
# python3 + pip : yt-dlp et le module de recadrage suivi
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      python3 \
      python3-pip \
      curl \
      ca-certificates \
      fonts-dejavu-core \
      fontconfig \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp : téléchargement de la source.
# opencv-python-headless : détection de visage du recadrage suivi (sans GUI).
RUN pip3 install --no-cache-dir --break-system-packages \
      yt-dlp \
      opencv-python-headless \
    && fc-cache -f

COPY --from=whisper-build /src/build/bin/whisper-cli /usr/local/bin/whisper-cli

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src
COPY python ./python
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

RUN mkdir -p /media /models

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "src/index.js"]
