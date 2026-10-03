<script setup>
import { computed } from 'vue';
import { translateError, useI18n } from '../i18n/index.js';

const props = defineProps({
  error: { type: Object, default: null },
  title: { type: String, default: '' },
  // Le titre est masqué quand la page porte déjà le même intitulé.
  showTitle: { type: Boolean, default: true },
});

const { t } = useI18n();
const text = computed(() => translateError(props.error));
</script>

<template>
  <div
    v-if="error"
    role="alert"
    aria-live="assertive"
    class="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-100"
  >
    <p v-if="showTitle" class="font-semibold">{{ title || t('error.title') }}</p>
    <p class="text-rose-200/90" :class="showTitle && 'mt-1'">{{ text }}</p>
    <p v-if="error.code" class="mt-2 font-mono text-xs text-rose-300/60">{{ error.code }}</p>
  </div>
</template>
