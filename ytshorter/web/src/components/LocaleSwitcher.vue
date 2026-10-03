<script setup>
import { useI18n } from '../i18n/index.js';

const { t, locale, setLocale, availableLocales } = useI18n();
</script>

<template>
  <div class="flex items-center gap-1" role="group" :aria-label="t('nav.language')">
    <button
      v-for="item in availableLocales"
      :key="item.code"
      type="button"
      class="rounded-md px-2 py-1 text-xs font-medium transition"
      :class="
        locale === item.code
          ? 'bg-sky-500/20 text-sky-200'
          : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
      "
      :aria-pressed="locale === item.code"
      @click="setLocale(item.code)"
    >
      {{ item.label }}
    </button>
  </div>
</template>
