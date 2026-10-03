import Ajv from 'ajv';
import { createGeminiProvider } from './gemini.js';
import { createGroqProvider } from './groq.js';
import { createOllamaProvider } from './ollama.js';
import { ProviderHttpError } from './http.js';
import { PipelineError, CODES } from '../lib/errors.js';

const FACTORIES = {
  gemini: createGeminiProvider,
  groq: createGroqProvider,
  ollama: createOllamaProvider,
};

/**
 * Extrait un objet JSON d'une réponse de modèle : tolère les blocs Markdown
 * et le texte parasite autour de l'objet.
 */
export function extractJson(text) {
  if (typeof text !== 'string') return null;
  let candidate = text.trim();

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(candidate);
  if (fenced) candidate = fenced[1].trim();

  try {
    return JSON.parse(candidate);
  } catch {
    /* on tente une extraction par accolades */
  }

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Client LLM avec chaîne de bascule et sortie JSON validée par ajv.
 *
 * Stratégie : pour chaque fournisseur de la chaîne, N tentatives avec délai
 * croissant sur 429 et 5xx ; en cas d'échec définitif, bascule vers le
 * fournisseur suivant ; Ollama en dernier recours (sans quota).
 */
export function createLlmClient({ config, logger, providers: injected } = {}) {
  const ajv = new Ajv({ allErrors: true, strict: false });

  const providers =
    injected ??
    config.providerChain
      .map((name) => {
        const factory = FACTORIES[name];
        if (!factory) {
          logger?.warn({ provider: name }, 'fournisseur LLM inconnu, ignoré');
          return null;
        }
        return factory(config);
      })
      .filter(Boolean)
      .filter((p) => {
        const ok = p.isConfigured();
        if (!ok) logger?.warn({ provider: p.name }, 'fournisseur LLM non configuré, ignoré');
        return ok;
      });

  if (providers.length === 0) {
    logger?.warn(
      {},
      "aucun fournisseur LLM configuré : renseignez GEMINI_API_KEY, GROQ_API_KEY ou démarrez Ollama",
    );
  }

  const attemptsPerProvider = config?.llmAttemptsPerProvider ?? 3;

  /** Appelle la chaîne jusqu'à obtenir un texte de réponse. */
  async function completeText({ system, user, schema, temperature, maxOutputTokens }) {
    let quotaSeen = false;
    let lastError = null;
    // Modèles refusés en 404 : on les collecte pour nommer précisément ce qui
    // doit être corrigé dans la configuration.
    const missingModels = [];

    for (const provider of providers) {
      for (let attempt = 1; attempt <= attemptsPerProvider; attempt += 1) {
        try {
          const text = await provider.complete({ system, user, schema, temperature, maxOutputTokens });
          logger?.debug({ provider: provider.name, attempt }, 'réponse LLM reçue');
          return { text, provider: provider.name };
        } catch (err) {
          lastError = err;
          const isProviderError = err instanceof ProviderHttpError;
          if (isProviderError && err.quota) quotaSeen = true;
          if (isProviderError && err.modelMissing) {
            missingModels.push(`${provider.name}=${provider.model ?? '?'}`);
          }

          const retryable = isProviderError ? err.retryable : false;
          logger?.warn(
            { provider: provider.name, attempt, status: err.status, err: err.message, retryable },
            'échec LLM',
          );

          if (!retryable || attempt === attemptsPerProvider) break;

          // Délai croissant : 2s, 4s, 8s… borné, ou Retry-After si fourni.
          const backoff = err.retryAfterMs || Math.min(2000 * 2 ** (attempt - 1), 30000);
          await sleep(backoff);
        }
      }
      logger?.warn({ provider: provider.name }, 'bascule vers le fournisseur suivant');
    }

    // Tous les fournisseurs disponibles ont refusé leur modèle : c'est une
    // erreur de configuration, et le message doit le dire sans détour.
    if (missingModels.length > 0 && missingModels.length >= providers.length) {
      throw new PipelineError(
        CODES.MODEL_UNAVAILABLE,
        `Modèle d'IA indisponible (${missingModels.join(', ')}). ` +
          'Mettez à jour GEMINI_MODEL / GROQ_MODEL avec un modèle accessible à votre clé.',
        lastError,
      );
    }
    if (quotaSeen) {
      throw new PipelineError(CODES.QUOTA_EXCEEDED, undefined, lastError);
    }
    throw new PipelineError(
      CODES.PROVIDER_ERROR,
      providers.length === 0
        ? "Aucun fournisseur d'IA n'est configuré côté serveur."
        : undefined,
      lastError,
    );
  }

  /**
   * Sortie JSON stricte validée par ajv.
   * En cas de sortie non conforme, une seule relance est effectuée en joignant
   * l'erreur de validation au prompt.
   */
  async function completeJson({ system, user, schema, temperature, maxOutputTokens }) {
    const validate = ajv.compile(schema);

    let currentUser = user;
    for (let round = 0; round < 2; round += 1) {
      const { text, provider } = await completeText({
        system,
        user: currentUser,
        schema,
        temperature,
        maxOutputTokens,
      });

      const parsed = extractJson(text);
      if (parsed && validate(parsed)) return { data: parsed, provider };

      const reason = parsed
        ? ajv.errorsText(validate.errors, { separator: '; ' })
        : "la réponse n'est pas du JSON exploitable";
      logger?.warn({ provider, round, reason }, 'sortie LLM non conforme');

      if (round === 1) {
        throw new PipelineError(
          CODES.PROVIDER_ERROR,
          `Réponse du modèle non conforme au schéma après relance (${reason}).`,
        );
      }

      currentUser =
        `${user}\n\n---\nTa réponse précédente était invalide : ${reason}.\n` +
        `Renvoie UNIQUEMENT du JSON valide conforme à ce schéma, sans texte autour, sans balise Markdown :\n` +
        `${JSON.stringify(schema)}`;
    }
    throw new PipelineError(CODES.PROVIDER_ERROR);
  }

  return {
    providers: providers.map((p) => p.name),
    completeText,
    completeJson,
    // Interface courte demandée par le cahier des charges : complete(prompt, schema)
    async complete(prompt, schema) {
      const { data } = await completeJson({
        system: prompt.system ?? '',
        user: prompt.user ?? String(prompt),
        schema,
      });
      return data;
    },
  };
}
