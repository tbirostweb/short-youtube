// Configuration du worker. Toutes les clés restent côté serveur.

function int(value, fallback) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}
function float(value, fallback) {
  const n = Number.parseFloat(value ?? '');
  return Number.isFinite(n) ? n : fallback;
}
function bool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return value === '1' || value === 'true' || value === 'yes';
}

const preferred = (process.env.LLM_PROVIDER || '').trim();
const chain = (process.env.LLM_PROVIDER_CHAIN || 'gemini,groq,ollama')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Le fournisseur préféré passe en tête de la chaîne de bascule.
const providerChain = preferred ? [preferred, ...chain.filter((p) => p !== preferred)] : chain;

export const config = {
  env: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',

  mysql: {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: int(process.env.MYSQL_PORT, 3306),
    database: process.env.MYSQL_DATABASE || 'ytshorter',
    user: process.env.MYSQL_USER || 'ytshorter',
    password: process.env.MYSQL_PASSWORD || '',
  },

  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',

  mediaDir: process.env.MEDIA_DIR || '/media',
  maxVideoMinutes: int(process.env.MAX_VIDEO_MINUTES, 90),
  maxSourceMb: int(process.env.MAX_SOURCE_MB, 2048),

  // --- LLM ---
  providerChain,
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
  },
  groq: {
    apiKey: process.env.GROQ_API_KEY || '',
    model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
    transcribeModel: process.env.GROQ_TRANSCRIBE_MODEL || 'whisper-large-v3-turbo',
    // Les modèles de raisonnement (gpt-oss…) dépensent leurs tokens à réfléchir
    // AVANT de répondre : la réponse est alors tronquée et le JSON invalide.
    // 'low' réduit cette dépense d'un facteur ~20 sans perte de qualité ici.
    // Vider la variable pour ne pas envoyer le paramètre du tout.
    reasoningEffort: process.env.GROQ_REASONING_EFFORT ?? 'low',
  },
  ollama: {
    url: (process.env.OLLAMA_URL || 'http://ollama:11434').replace(/\/+$/, ''),
    model: process.env.OLLAMA_MODEL || 'qwen2.5:3b',
  },

  // --- Transcription ---
  transcriber: process.env.TRANSCRIBER || 'whispercpp',
  whisper: {
    binary: process.env.WHISPER_BIN || 'whisper-cli',
    modelPath: process.env.WHISPER_MODEL_PATH || '/models/ggml-base.bin',
    threads: int(process.env.WHISPER_THREADS, 4),
    language: process.env.WHISPER_LANGUAGE || 'auto',
  },

  // --- Outils externes ---
  ytDlp: process.env.YTDLP_BIN || 'yt-dlp',
  // Cookies YouTube pour contourner le blocage « prove you're not a bot » des
  // IP de datacenter. Le fichier est écrit par l'entrypoint (depuis la variable
  // YTDLP_COOKIES_B64) ou fourni par l'utilisateur sur le volume. S'il n'existe
  // pas, yt-dlp est appelé sans cookies (comportement d'origine).
  ytDlpCookiesFile: process.env.YTDLP_COOKIES_FILE || '/tmp/yt-cookies.txt',
  ffmpeg: process.env.FFMPEG_BIN || 'ffmpeg',
  ffprobe: process.env.FFPROBE_BIN || 'ffprobe',
  python: process.env.PYTHON_BIN || 'python3',

  // --- Recadrage ---
  // Activé par défaut : le recadrage centré coupe le sujet dès qu'il n'est pas
  // au milieu. En cas d'échec ou de suivi peu fiable, le repli centré reprend
  // la main automatiquement.
  trackingCrop: bool(process.env.TRACKING_CROP, true),

  // Marge conservée de part et d'autre de chaque découpe, en secondes.
  // C'est elle qui rend possible l'ajustement des bornes après coup, sans
  // conserver la vidéo source. 0 la désactive.
  cutPadSeconds: float(process.env.CUT_PAD_SECONDS, 2.5),

  // --- Rendu ---
  render: {
    // Aligne le volume sur -14 LUFS, la cible des plateformes.
    normalizeAudio: bool(process.env.AUDIO_NORMALIZE, true),
    // Fondu de fermeture, en secondes. 0 le désactive.
    // Il n'y a délibérément pas de fondu d'ouverture sur un format court.
    fadeOutSeconds: float(process.env.RENDER_FADE_OUT, 0.25),
    preset: process.env.X264_PRESET || 'veryfast',
    crf: int(process.env.X264_CRF, 21),
  },

  // --- Divers pipeline ---
  // Taille maximale de transcription envoyée en une fois au LLM.
  // Au-delà, la transcription est découpée en fenêtres traitées séparément.
  maxTranscriptChars: int(process.env.MAX_TRANSCRIPT_CHARS, 45000),
  // Nombre de tentatives par fournisseur avant bascule.
  llmAttemptsPerProvider: int(process.env.LLM_ATTEMPTS, 3),
  // Conserver les fichiers intermédiaires (débogage).
  keepIntermediates: bool(process.env.KEEP_INTERMEDIATES, false),
  // Conserver les découpes après succès : indispensable pour re-styliser un
  // clip sans refaire tout le pipeline. La rétention borne l'usage disque.
  keepCutsForRestyle: bool(process.env.KEEP_CUTS_FOR_RESTYLE, true),

  retention: {
    // Âge au-delà duquel un job et ses fichiers sont supprimés. 0 = jamais.
    days: int(process.env.RETENTION_DAYS, 7),
    // Âge au-delà duquel un fichier envoyé mais jamais utilisé est supprimé.
    uploadTtlHours: int(process.env.UPLOAD_TTL_HOURS, 24),
    // Périodicité du passage de nettoyage.
    intervalMinutes: int(process.env.RETENTION_INTERVAL_MINUTES, 60),
  },
};
