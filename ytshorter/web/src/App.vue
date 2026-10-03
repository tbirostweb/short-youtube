<script setup>
import { watch } from 'vue';
import { RouterView, useRoute } from 'vue-router';
import AppHeader from './components/AppHeader.vue';
import AppFooter from './components/AppFooter.vue';
import ToastHost from './components/ui/ToastHost.vue';
import { useI18n, applyPageMeta } from './i18n/index.js';

const { t, locale } = useI18n();
const route = useRoute();

// Le titre et la description de page suivent la langue choisie,
// sans attendre une navigation.
watch(locale, () => applyPageMeta(route.name ?? 'home'));
</script>

<template>
  <a
    href="#contenu"
    class="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-sky-500 focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink"
  >
    {{ t('nav.skipToContent') }}
  </a>

  <div class="flex min-h-screen flex-col">
    <AppHeader />
    <main id="contenu" class="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <RouterView />
    </main>
    <AppFooter />
  </div>

  <ToastHost />
</template>
