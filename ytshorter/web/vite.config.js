import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

// En développement, l'api tourne séparément : Vite proxifie /api et /health.
// En production, c'est nginx (service web) qui joue ce rôle.
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.API_ORIGIN || 'http://localhost:3000', changeOrigin: true },
      '/health': { target: process.env.API_ORIGIN || 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
