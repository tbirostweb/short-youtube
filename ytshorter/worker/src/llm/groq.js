import { postJson, ProviderHttpError } from './http.js';

// Groq — offre gratuite à quota, API compatible OpenAI, très rapide.
const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

export function createGroqProvider(config) {
  return {
    name: 'groq',
    model: config.groq.model,
    isConfigured: () => Boolean(config.groq.apiKey),
    async complete({ system, user, schema, temperature = 0.7, maxOutputTokens = 4096 }) {
      // Le mode json_object ne prend pas de schéma : on le joint aux consignes.
      const systemPrompt = schema
        ? `${system}\n\nSchéma JSON attendu :\n${JSON.stringify(schema)}`
        : system;

      const body = {
        model: config.groq.model,
        temperature,
        max_tokens: maxOutputTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: user },
        ],
      };
      const effort = config.groq.reasoningEffort;
      if (effort) body.reasoning_effort = effort;

      let data;
      try {
        data = await postJson(ENDPOINT, {
          headers: { authorization: `Bearer ${config.groq.apiKey}` },
          body,
        });
      } catch (err) {
        // Tous les modèles n'acceptent pas reasoning_effort : on réessaie sans.
        if (effort && err?.status === 400 && /reasoning_effort/i.test(err.message)) {
          delete body.reasoning_effort;
          data = await postJson(ENDPOINT, {
            headers: { authorization: `Bearer ${config.groq.apiKey}` },
            body,
          });
        } else {
          throw err;
        }
      }

      const choice = data?.choices?.[0];
      const text = choice?.message?.content?.trim();

      // Réponse coupée en cours de route : le JSON sera forcément invalide,
      // autant le dire précisément plutôt que de laisser ajv s'en plaindre.
      if (choice?.finish_reason === 'length') {
        throw new ProviderHttpError(
          `réponse tronquée (max_tokens=${maxOutputTokens} atteint, ` +
            `dont ${data?.usage?.completion_tokens_details?.reasoning_tokens ?? '?'} tokens de raisonnement)`,
          { retryable: false, truncated: true },
        );
      }
      if (!text) throw new ProviderHttpError('contenu vide', { retryable: true });
      return text;
    },
  };
}
