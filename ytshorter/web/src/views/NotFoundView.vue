<script setup>
import { RouterLink } from 'vue-router';
import { useI18n } from '../i18n/index.js';

const { t } = useI18n();
</script>

<template>
  <div class="mx-auto max-w-md space-y-4 py-16 text-center">
    <p class="font-mono text-6xl font-bold text-sky-400/70">404</p>
    <h1 class="text-2xl font-bold text-white">{{ t('notFound.title') }}</h1>
    <p class="text-sm text-slate-400">{{ t('notFound.body') }}</p>
    <RouterLink
      :to="{ name: 'home' }"
      class="inline-block rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-ink transition hover:bg-sky-400"
    >
      {{ t('notFound.cta') }}
    </RouterLink>
  </div>
</template>
