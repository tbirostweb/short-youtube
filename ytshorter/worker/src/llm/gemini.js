import { postJson, ProviderHttpError } from './http.js';

// Google Gemini — offre gratuite à quota, sortie JSON native (responseSchema).
// https://ai.google.dev/gemini-api/docs/structured-output

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

// Le schéma Gemini est un sous-ensemble d'OpenAPI : on retire les mots-clés
// non supportés (additionalProperties, $schema…) et on met les types en capitales.
export function toGeminiSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  if (schema.type) out.type = String(schema.type).toUpperCase();
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.items) out.items = toGeminiSchema(schema.items);
  if (schema.minItems !== undefined) out.minItems = schema.minItems;
  if (schema.maxItems !== undefined) out.maxItems = schema.maxItems;
  if (schema.properties) {
    out.properties = {};
    for (const [key, value] of Object.entries(schema.properties)) {
      out.properties[key] = toGeminiSchema(value);
    }
    out.propertyOrdering = Object.keys(schema.properties);
  }
  if (schema.required) out.required = schema.required;
  return out;
}

export function createGeminiProvider(config) {
  return {
    name: 'gemini',
    model: config.gemini.model,
    isConfigured: () => Boolean(config.gemini.apiKey),
    async complete({ system, user, schema, temperature = 0.7, maxOutputTokens = 4096 }) {
      const url = `${ENDPOINT}/${encodeURIComponent(config.gemini.model)}:generateContent`;
      const payload = {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: {
          temperature,
          maxOutputTokens,
          responseMimeType: 'application/json',
          ...(schema ? { responseSchema: toGeminiSchema(schema) } : {}),
        },
      };

      const data = await postJson(url, {
        headers: { 'x-goog-api-key': config.gemini.apiKey },
        body: payload,
      });

      const candidate = data?.candidates?.[0];
      if (!candidate) {
        const reason = data?.promptFeedback?.blockReason;
        throw new ProviderHttpError(`réponse vide${reason ? ` (${reason})` : ''}`, { retryable: !reason });
      }
      const text = (candidate.content?.parts ?? [])
        .map((p) => p.text ?? '')
        .join('')
        .trim();
      if (candidate.finishReason === 'MAX_TOKENS') {
        throw new ProviderHttpError(
          `réponse tronquée (maxOutputTokens=${maxOutputTokens} atteint)`,
          { retryable: false, truncated: true },
        );
      }
      if (!text) {
        throw new ProviderHttpError(
          `contenu vide (finishReason=${candidate.finishReason ?? 'inconnu'})`,
          { retryable: true },
        );
      }
      return text;
    },
  };
}
