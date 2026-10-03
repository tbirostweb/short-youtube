import test from 'node:test';
import assert from 'node:assert/strict';
import { createLlmClient, extractJson } from '../src/llm/index.js';
import { ProviderHttpError, classifyStatus } from '../src/llm/http.js';
import { toGeminiSchema } from '../src/llm/gemini.js';
import { selectionSchema, metadataSchema } from '../src/lib/llm-schemas.js';
import { CODES } from '../src/lib/errors.js';

const silentLogger = { warn() {}, info() {}, debug() {}, error() {} };
const baseConfig = { llmAttemptsPerProvider: 2, providerChain: [] };

function fakeProvider(name, responses) {
  const calls = [];
  return {
    provider: {
      name,
      isConfigured: () => true,
      async complete(payload) {
        calls.push(payload);
        const next = responses.shift();
        if (next instanceof Error) throw next;
        if (typeof next === 'function') return next();
        return next;
      },
    },
    calls,
  };
}

test('extractJson tolère les blocs Markdown et le texte parasite', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('```\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Voici le résultat :\n{"a":1}\nVoilà.'), { a: 1 });
  assert.equal(extractJson('pas de json ici'), null);
  assert.equal(extractJson(null), null);
});

test('une sortie conforme est renvoyée telle quelle', async () => {
  const payload = JSON.stringify({
    clips: [{ start: 10, end: 40, score: 88, hook: 'Accroche', transcript: 'texte' }],
  });
  const { provider } = fakeProvider('fake', [payload]);
  const llm = createLlmClient({ config: baseConfig, logger: silentLogger, providers: [provider] });

  const { data } = await llm.completeJson({ system: 's', user: 'u', schema: selectionSchema });
  assert.equal(data.clips.length, 1);
  assert.equal(data.clips[0].score, 88);
});

test('une sortie invalide déclenche une relance unique avec l’erreur de validation', async () => {
  const invalid = JSON.stringify({ clips: [{ start: 10, end: 40 }] }); // champs manquants
  const valid = JSON.stringify({
    clips: [{ start: 10, end: 40, score: 70, hook: 'h', transcript: 't' }],
  });
  const { provider, calls } = fakeProvider('fake', [invalid, valid]);
  const llm = createLlmClient({ config: baseConfig, logger: silentLogger, providers: [provider] });

  const { data } = await llm.completeJson({ system: 's', user: 'u', schema: selectionSchema });
  assert.equal(data.clips[0].hook, 'h');
  assert.equal(calls.length, 2, 'exactement une relance');
  assert.match(calls[1].user, /invalide/i);
  assert.match(calls[1].user, /score/, "l'erreur de validation est jointe au prompt");
});

test('deux sorties invalides de suite remontent PROVIDER_ERROR', async () => {
  const { provider } = fakeProvider('fake', ['pas du json', 'toujours pas']);
  const llm = createLlmClient({ config: baseConfig, logger: silentLogger, providers: [provider] });

  await assert.rejects(
    () => llm.completeJson({ system: 's', user: 'u', schema: metadataSchema }),
    (err) => err.code === CODES.PROVIDER_ERROR,
  );
});

test('un 429 fait basculer vers le fournisseur suivant', async () => {
  const quota = new ProviderHttpError('429', { status: 429, quota: true, retryable: true, retryAfterMs: 1 });
  const first = fakeProvider('quota', [quota, quota]);
  const second = fakeProvider('repli', [
    JSON.stringify({ clips: [{ start: 1, end: 20, score: 50, hook: 'h', transcript: 't' }] }),
  ]);
  const llm = createLlmClient({
    config: baseConfig,
    logger: silentLogger,
    providers: [first.provider, second.provider],
  });

  const { data, provider } = await llm.completeJson({ system: 's', user: 'u', schema: selectionSchema });
  assert.equal(provider, 'repli');
  assert.equal(data.clips.length, 1);
  assert.equal(first.calls.length, 2, 'deux tentatives avant bascule');
});

test('tous les fournisseurs en quota remontent QUOTA_EXCEEDED', async () => {
  const quota = () => new ProviderHttpError('429', { status: 429, quota: true, retryable: true, retryAfterMs: 1 });
  const a = fakeProvider('a', [quota(), quota()]);
  const b = fakeProvider('b', [quota(), quota()]);
  const llm = createLlmClient({
    config: baseConfig,
    logger: silentLogger,
    providers: [a.provider, b.provider],
  });

  await assert.rejects(
    () => llm.completeJson({ system: 's', user: 'u', schema: selectionSchema }),
    (err) => err.code === CODES.QUOTA_EXCEEDED,
  );
});

test('une clé invalide ne consomme pas de tentative supplémentaire', async () => {
  const denied = new ProviderHttpError('401', { status: 401 });
  const a = fakeProvider('a', [denied, denied]);
  const b = fakeProvider('b', [
    JSON.stringify({ clips: [{ start: 1, end: 20, score: 50, hook: 'h', transcript: 't' }] }),
  ]);
  const llm = createLlmClient({
    config: baseConfig,
    logger: silentLogger,
    providers: [a.provider, b.provider],
  });

  const { provider } = await llm.completeJson({ system: 's', user: 'u', schema: selectionSchema });
  assert.equal(provider, 'b');
  assert.equal(a.calls.length, 1, 'pas de réessai sur une authentification refusée');
});

test('sans fournisseur configuré, l’erreur est explicite', async () => {
  const llm = createLlmClient({ config: baseConfig, logger: silentLogger, providers: [] });
  await assert.rejects(
    () => llm.completeJson({ system: 's', user: 'u', schema: metadataSchema }),
    (err) => err.code === CODES.PROVIDER_ERROR && /configuré/.test(err.message),
  );
});

test('classifyStatus distingue quota, authentification et erreurs serveur', () => {
  assert.equal(classifyStatus(429, 'rate limit').quota, true);
  assert.equal(classifyStatus(429, 'rate limit').retryable, true);
  assert.equal(classifyStatus(401, 'bad key').retryable, false);
  assert.equal(classifyStatus(503, 'oops').retryable, true);
  assert.equal(classifyStatus(400, 'RESOURCE_EXHAUSTED').quota, true);
  assert.equal(classifyStatus(400, 'champ manquant').quota, false);
});

test('le schéma est converti au format attendu par Gemini', () => {
  const converted = toGeminiSchema(metadataSchema);
  assert.equal(converted.type, 'OBJECT');
  assert.equal(converted.properties.tiktok.type, 'OBJECT');
  assert.equal(converted.properties.tiktok.properties.hashtags.type, 'ARRAY');
  assert.equal(converted.properties.tiktok.properties.hashtags.items.type, 'STRING');
  assert.deepEqual(converted.required, ['youtube_shorts', 'tiktok']);
  assert.ok(Array.isArray(converted.propertyOrdering));
});

test('un modèle retiré donne une erreur de configuration explicite', async () => {
  // C'est exactement ce qui est arrivé en production : les deux fournisseurs
  // ont renvoyé 404 parce que leurs modèles avaient été retirés.
  const gone = () =>
    new ProviderHttpError('404 modèle indisponible : no longer available', {
      status: 404,
      retryable: false,
      modelMissing: true,
    });

  const a = fakeProvider('gemini', [gone()]);
  a.provider.model = 'gemini-2.5-flash';
  const b = fakeProvider('groq', [gone()]);
  b.provider.model = 'llama-3.3-70b-versatile';

  const llm = createLlmClient({
    config: { llmAttemptsPerProvider: 3, providerChain: [] },
    logger: silentLogger,
    providers: [a.provider, b.provider],
  });

  await assert.rejects(
    () => llm.completeJson({ system: 's', user: 'u', schema: selectionSchema }),
    (err) => {
      assert.equal(err.code, CODES.MODEL_UNAVAILABLE, 'code dédié, pas PROVIDER_ERROR');
      // Le message nomme les modèles fautifs : l'admin sait quoi corriger.
      assert.match(err.message, /gemini=gemini-2\.5-flash/);
      assert.match(err.message, /groq=llama-3\.3-70b-versatile/);
      assert.match(err.message, /GEMINI_MODEL/);
      return true;
    },
  );

  // Un 404 n'est pas réessayé : inutile d'insister sur un modèle qui n'existe plus.
  assert.equal(a.calls.length, 1);
  assert.equal(b.calls.length, 1);
});

test('un modèle retiré chez un seul fournisseur laisse la bascule opérer', async () => {
  const gone = new ProviderHttpError('404', { status: 404, retryable: false, modelMissing: true });
  const a = fakeProvider('gemini', [gone]);
  a.provider.model = 'modele-retire';
  const b = fakeProvider('groq', [
    JSON.stringify({ clips: [{ start: 1, end: 20, score: 50, hook: 'h', transcript: 't' }] }),
  ]);

  const llm = createLlmClient({
    config: { llmAttemptsPerProvider: 2, providerChain: [] },
    logger: silentLogger,
    providers: [a.provider, b.provider],
  });

  const { provider } = await llm.completeJson({ system: 's', user: 'u', schema: selectionSchema });
  assert.equal(provider, 'groq', 'le second fournisseur prend le relais');
});

test('classifyStatus marque les 404 comme problème de modèle', () => {
  const err = classifyStatus(404, 'model not found');
  assert.equal(err.modelMissing, true);
  assert.equal(err.retryable, false);
  assert.equal(err.quota, false);
});

test('une réponse tronquée est signalée comme telle, pas comme du JSON invalide', async () => {
  // Cas réel : un modèle de raisonnement épuise max_tokens en réfléchissant,
  // la réponse est coupée et le JSON forcément invalide.
  const { createGroqProvider } = await import('../src/llm/groq.js');
  const config = {
    groq: { apiKey: 'k', model: 'openai/gpt-oss-120b', reasoningEffort: 'low' },
  };
  const provider = createGroqProvider(config);

  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [{ finish_reason: 'length', message: { content: '{"youtube_shorts":{"tit' } }],
        usage: { completion_tokens_details: { reasoning_tokens: 805 } },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );

  try {
    await assert.rejects(
      () => provider.complete({ system: 's', user: 'u', maxOutputTokens: 1024 }),
      (err) => {
        assert.equal(err.truncated, true);
        assert.match(err.message, /tronquée/);
        assert.match(err.message, /805 tokens de raisonnement/);
        assert.equal(err.retryable, false, 'réessayer à l’identique ne sert à rien');
        return true;
      },
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('reasoning_effort est envoyé, et retiré si le modèle le refuse', async () => {
  const { createGroqProvider } = await import('../src/llm/groq.js');
  const provider = createGroqProvider({
    groq: { apiKey: 'k', model: 'un-modele', reasoningEffort: 'low' },
  });

  const bodies = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    bodies.push(body);
    if (body.reasoning_effort) {
      // Premier appel : le modèle rejette le paramètre.
      return new Response(
        JSON.stringify({ error: { message: "'reasoning_effort' is not supported" } }),
        { status: 400 },
      );
    }
    return new Response(
      JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":1}' } }] }),
      { status: 200 },
    );
  };

  try {
    const text = await provider.complete({ system: 's', user: 'u' });
    assert.equal(text, '{"ok":1}');
    assert.equal(bodies.length, 2, 'un second essai sans le paramètre');
    assert.equal(bodies[0].reasoning_effort, 'low');
    assert.equal(bodies[1].reasoning_effort, undefined);
  } finally {
    globalThis.fetch = original;
  }
});
