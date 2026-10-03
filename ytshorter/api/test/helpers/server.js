import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../../src/app.js';
import { config as baseConfig } from '../../src/config.js';
import { createMemoryStore, createMemoryBus, createMemoryQueue } from './memory.js';

export const VALID_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

/** Démarre l'application réelle sur un port libre, avec des dépendances en mémoire. */
export async function startServer(overrides = {}) {
  const mediaDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ytsh-test-'));
  const config = {
    ...baseConfig,
    env: 'test',
    publicBaseUrl: 'http://localhost',
    signingSecret: 'secret-de-test-signature',
    sessionSecret: 'secret-de-test-session',
    mediaDir,
    authEnabled: false,
    rateLimit: { window: 60000, max: 1000, jobsMax: 5, authMax: 5, restyleMax: 20 },
    ...overrides,
  };
  const store = createMemoryStore();
  const bus = createMemoryBus();
  const queue = createMemoryQueue();
  const app = await buildApp({ store, bus, queue, config, loggerOptions: false });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address();
  return {
    app,
    base: `http://127.0.0.1:${port}`,
    store,
    bus,
    queue,
    config,
    mediaDir,
    async close() {
      await app.close();
      await fs.rm(mediaDir, { recursive: true, force: true });
    },
  };
}

/** Client conservant ses cookies : simule un navigateur distinct. */
export function createClient(base) {
  const jar = new Map();
  return {
    get cookieHeader() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    async fetch(pathname, options = {}) {
      const headers = new Headers(options.headers || {});
      if (jar.size) headers.set('cookie', this.cookieHeader);
      const res = await fetch(base + pathname, { ...options, headers });
      for (const raw of res.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(';');
        const idx = pair.indexOf('=');
        jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
      }
      return res;
    },
    async json(pathname, options) {
      const res = await this.fetch(pathname, options);
      const text = await res.text();
      return { res, body: text ? JSON.parse(text) : null };
    },
    async postJson(pathname, payload) {
      return this.json(pathname, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    },
    /** Envoi de fichier en multipart, comme le ferait un navigateur. */
    async postFile(pathname, { filename, content, type = 'video/mp4' }) {
      const form = new FormData();
      form.append('file', new Blob([content], { type }), filename);
      return this.json(pathname, { method: 'POST', body: form });
    },
  };
}
