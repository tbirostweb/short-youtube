// Schémas JSON stricts des sorties LLM, validés par ajv.

export const selectionSchema = {
  type: 'object',
  required: ['clips'],
  properties: {
    clips: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['start', 'end', 'score', 'hook', 'transcript'],
        properties: {
          start: { type: 'number', minimum: 0 },
          end: { type: 'number', minimum: 0 },
          score: { type: 'number', minimum: 0, maximum: 100 },
          hook: { type: 'string' },
          transcript: { type: 'string' },
        },
      },
    },
  },
};

export const metadataSchema = {
  type: 'object',
  required: ['youtube_shorts', 'tiktok'],
  properties: {
    youtube_shorts: {
      type: 'object',
      required: ['title', 'description', 'hashtags'],
      properties: {
        title: { type: 'string', minLength: 1 },
        description: { type: 'string' },
        hashtags: { type: 'array', items: { type: 'string' } },
      },
    },
    tiktok: {
      type: 'object',
      required: ['caption', 'hashtags'],
      properties: {
        caption: { type: 'string', minLength: 1 },
        hashtags: { type: 'array', items: { type: 'string' } },
      },
    },
  },
};

export const translationSchema = {
  type: 'object',
  required: ['segments'],
  properties: {
    segments: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['i', 'text'],
        properties: {
          i: { type: 'integer', minimum: 0 },
          text: { type: 'string' },
        },
      },
    },
  },
};
