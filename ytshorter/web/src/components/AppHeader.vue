<script setup>
import { RouterLink } from 'vue-router';
import LocaleSwitcher from './LocaleSwitcher.vue';
import { useI18n } from '../i18n/index.js';

const { t } = useI18n();
</script>

<template>
  <header class="border-b border-white/5 bg-ink/80 backdrop-blur">
    <div class="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
      <RouterLink
        :to="{ name: 'home' }"
        class="flex shrink-0 items-center gap-2 text-slate-100 transition hover:text-white"
      >
        <img src="/favicon.svg" alt="" width="28" height="28" class="h-7 w-7" />
        <span class="text-base font-semibold tracking-tight">{{ t('app.name') }}</span>
      </RouterLink>

      <div class="flex shrink-0 items-center gap-1 sm:gap-3">
        <RouterLink
          :to="{ name: 'library' }"
          class="whitespace-nowrap rounded-lg px-1.5 py-1.5 text-xs font-medium text-slate-300 transition hover:text-white sm:px-2"
          active-class="text-sky-300"
        >
          {{ t('nav.library') }}
        </RouterLink>
        <RouterLink
          :to="{ name: 'home' }"
          class="hidden rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-sky-400/40 hover:text-white sm:inline-block"
        >
          {{ t('nav.new') }}
        </RouterLink>
        <LocaleSwitcher />
      </div>
    </div>
  </header>
</template>
