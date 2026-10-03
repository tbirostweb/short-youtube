<script setup>
import { ref } from 'vue';
import { useI18n } from '../i18n/index.js';

const props = defineProps({
  label: { type: String, required: true },
  text: { type: String, default: '' },
  multiline: { type: Boolean, default: false },
});

const { t } = useI18n();
const state = ref('idle'); // idle | copied | failed

async function copy() {
  const value = props.text ?? '';
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      // Repli pour les contextes sans API presse-papiers (HTTP simple).
      const area = document.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      if (!ok) throw new Error('execCommand a échoué');
    }
    state.value = 'copied';
  } catch {
    state.value = 'failed';
  }
  setTimeout(() => {
    state.value = 'idle';
  }, 2500);
}
</script>

<template>
  <div class="rounded-lg border border-white/5 bg-black/20 p-3">
    <div class="flex items-start justify-between gap-2">
      <span class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {{ label }}
      </span>
      <button
        type="button"
        class="shrink-0 rounded-md border border-white/10 px-2 py-1 text-[11px] font-medium transition"
        :class="
          state === 'copied'
            ? 'border-emerald-400/40 text-emerald-300'
            : state === 'failed'
              ? 'border-rose-400/40 text-rose-300'
              : 'text-slate-300 hover:border-sky-400/40 hover:text-white'
        "
        @click="copy"
      >
        {{ state === 'copied' ? t('results.copied') : t('results.copy') }}
      </button>
    </div>

    <p
      class="mt-1.5 text-sm text-slate-200"
      :class="multiline ? 'whitespace-pre-line' : 'break-words'"
    >
      {{ text || '—' }}
    </p>

    <p v-if="state === 'failed'" role="alert" class="mt-1 text-xs text-rose-300">
      {{ t('results.copyFailed') }}
    </p>
    <!-- Confirmation annoncée aux lecteurs d'écran. -->
    <p class="sr-only" aria-live="polite">
      {{ state === 'copied' ? `${label} : ${t('results.copied')}` : '' }}
    </p>
  </div>
</template>
