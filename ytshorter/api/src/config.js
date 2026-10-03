// Configuration de l'api. Toutes les valeurs viennent de l'environnement.
// Aucune de ces valeurs n'est envoyée au navigateur.

function int(value, fallback) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}
function bool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return value === '1' || value === 'true' || value === 'yes';
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: int(process.env.API_PORT, 3000),
  host: process.env.API_HOST || '0.0.0.0',
  logLevel: process.env.LOG_LEVEL || 'info',
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || 'http://localhost:8080').replace(/\/+$/, ''),

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

  upload: {
    // Taille maximale d'un fichier vidéo envoyé par l'utilisateur, en Mo.
    maxMb: int(process.env.MAX_UPLOAD_MB, 500),
    // Extensions acceptées. Le worker vérifie ensuite le fichier avec ffprobe.
    allowedExtensions: ['.mp4', '.mov', '.m4v', '.webm', '.mkv'],
  },

  signingSecret: process.env.SIGNING_SECRET || '',
  signedUrlTtl: int(process.env.SIGNED_URL_TTL, 900),
  sessionSecret: process.env.SESSION_SECRET || '',

  authEnabled: bool(process.env.AUTH_ENABLED, false),

  rateLimit: {
    window: int(process.env.RATE_LIMIT_WINDOW, 15 * 60 * 1000),
    max: int(process.env.RATE_LIMIT_MAX, 200),
    jobsMax: int(process.env.RATE_LIMIT_JOBS_MAX, 10),
    authMax: int(process.env.RATE_LIMIT_AUTH_MAX, 10),
    restyleMax: int(process.env.RATE_LIMIT_RESTYLE_MAX, 30),
  },

  // Bornes appliquées aux options utilisateur (validées aussi par le schéma JSON).
  limits: {
    clipCountMin: 1,
    clipCountMax: 10,
    targetDurationMin: 15,
    targetDurationMax: 90,
  },

  // 'none' = aucun sous-titre incrusté (les sous-titres restent exportables en SRT).
  captionStyles: ['punch', 'clean', 'boxed', 'none'],
  layouts: ['crop', 'blur'],
  // Nombre maximum de jobs listés dans l'historique en une requête.
  historyPageSize: int(process.env.HISTORY_PAGE_SIZE, 20),
  languages: ['fr', 'en', 'es', 'de', 'it', 'pt'],
};

// Garde-fou : en production, refuser de démarrer avec des secrets par défaut.
export function assertProductionSecrets() {
  if (config.env !== 'production') return;
  const weak = [];
  if (!config.signingSecret || config.signingSecret.startsWith('change_me')) weak.push('SIGNING_SECRET');
  if (!config.sessionSecret || config.sessionSecret.startsWith('change_me')) weak.push('SESSION_SECRET');
  if (weak.length) {
    throw new Error(
      `Secrets non configurés en production : ${weak.join(', ')}. ` +
        'Générez-les avec : node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"',
    );
  }
}
