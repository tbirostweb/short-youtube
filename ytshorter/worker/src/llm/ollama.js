import { postJson, ProviderHttpError } from './http.js';

// Ollama auto-hébergé — sans clé, sans quota, plus lent (CPU).
// Dernier maillon de la chaîne de bascule.
export function createOllamaProvider(config) {
  return {
    name: 'ollama',
    model: config.ollama.model,
    isConfigured: () => Boolean(config.ollama.url),
    async complete({ system, user, schema, temperature = 0.7, maxOutputTokens = 4096 }) {
      const data = await postJson(`${config.ollama.url}/api/chat`, {
        // Un petit modèle sur CPU peut être lent : délai large.
        timeoutMs: 600000,
        body: {
          model: config.ollama.model,
          stream: false,
          // Ollama accepte un schéma JSON complet dans "format".
          format: schema ?? 'json',
          options: { temperature, num_predict: maxOutputTokens },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        },
      });

      const text = data?.message?.content?.trim();
      if (!text) throw new ProviderHttpError('contenu vide', { retryable: true });
      return text;
    },
  };
}
