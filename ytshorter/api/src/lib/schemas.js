import { config } from '../config.js';

// Schémas JSON des entrées HTTP. Fastify les compile avec ajv.
// Toute requête non conforme est rejetée avant d'atteindre la logique métier.

// Un job a exactement une source : une URL YouTube ou un fichier envoyé.
export const createJobBodySchema = {
  type: 'object',
  additionalProperties: false,
  anyOf: [{ required: ['youtubeUrl'] }, { required: ['uploadId'] }],
  properties: {
    youtubeUrl: { type: 'string', minLength: 8, maxLength: 500 },
    uploadId: { type: 'string', pattern: '^[a-f0-9]{32}$' },
    language: { type: 'string', enum: config.languages, default: 'fr' },
    clipCount: {
      type: 'integer',
      minimum: config.limits.clipCountMin,
      maximum: config.limits.clipCountMax,
      default: 3,
    },
    targetDuration: {
      type: 'integer',
      minimum: config.limits.targetDurationMin,
      maximum: config.limits.targetDurationMax,
      default: 45,
    },
    captionStyle: { type: 'string', enum: config.captionStyles, default: 'punch' },
    // Point de focus horizontal du recadrage centré : 0 = gauche, 1 = droite.
    focusX: { type: 'number', minimum: 0, maximum: 1, default: 0.5 },
    // crop = recadrage 9:16 ; blur = vidéo entière sur fond flou.
    layout: { type: 'string', enum: config.layouts, default: 'crop' },
    // Incruste l'accroche du clip en bandeau sur ses premières secondes.
    hookOverlay: { type: 'boolean', default: false },
    // Mode série : les extraits forment une suite numérotée, chacun appelant
    // le suivant, pour transformer une vue en abonnement.
    seriesMode: { type: 'boolean', default: false },
    // 'source' = langue parlée ; sinon les sous-titres sont traduits.
    subtitleLanguage: { type: 'string', enum: ['source', ...config.languages], default: 'source' },
  },
};

export const jobIdParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', pattern: '^[0-9]{1,19}$' } },
};

export const clipIdParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', pattern: '^[0-9]{1,19}$' } },
};

export const downloadQuerySchema = {
  type: 'object',
  required: ['exp', 'sig'],
  properties: {
    exp: { type: 'string', pattern: '^[0-9]{1,12}$' },
    sig: { type: 'string', minLength: 16, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' },
  },
};

export const listJobsQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: 50, default: config.historyPageSize },
    offset: { type: 'integer', minimum: 0, maximum: 10000, default: 0 },
  },
};

export const restyleBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    captionStyle: { type: 'string', enum: config.captionStyles },
    focusX: { type: 'number', minimum: 0, maximum: 1 },
    layout: { type: 'string', enum: config.layouts },
    hookOverlay: { type: 'boolean' },
    // Nouvelles bornes, en secondes de la vidéo source. Le serveur les ramène
    // dans la marge réellement disponible autour de la découpe.
    startSeconds: { type: 'number', minimum: 0, maximum: 100000 },
    endSeconds: { type: 'number', minimum: 0, maximum: 100000 },
  },
  anyOf: [
    { required: ['captionStyle'] },
    { required: ['focusX'] },
    { required: ['layout'] },
    { required: ['hookOverlay'] },
    { required: ['startSeconds'] },
    { required: ['endSeconds'] },
  ],
};

// Sous-titres corrigés à la main. Les temps sont locaux au clip (0 = début).
export const subtitlesBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['lines'],
  properties: {
    lines: {
      type: 'array',
      minItems: 1,
      maxItems: 300,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['start', 'end', 'text'],
        properties: {
          start: { type: 'number', minimum: 0, maximum: 100000 },
          end: { type: 'number', minimum: 0, maximum: 100000 },
          text: { type: 'string', minLength: 1, maxLength: 300 },
        },
      },
    },
  },
};

export const publishedBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['platform'],
  properties: {
    platform: { type: 'string', enum: ['youtube', 'tiktok'] },
    published: { type: 'boolean', default: true },
  },
};

export const credentialsBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['email', 'password'],
  properties: {
    email: { type: 'string', format: 'email', maxLength: 190 },
    password: { type: 'string', minLength: 10, maxLength: 200 },
  },
};
