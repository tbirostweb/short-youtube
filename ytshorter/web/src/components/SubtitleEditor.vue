<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../lib/api.js';
import { translateError, useI18n } from '../i18n/index.js';

// Correction des sous-titres réellement incrustés.
//
// Whisper se trompe sur les noms propres, le jargon, les marques. Sans ce
// panneau, une seule erreur de transcription rend le clip inutilisable et
// oblige à tout relancer. Ici, la correction ne coûte qu'un ré-encodage :
// aucun appel à l'IA, aucun quota consommé.
const props = defineProps({
  clip: { type: Object, required: true },
  busy: { type: Boolean, default: false },
});
const emit = defineEmits(['save']);

const { t } = useI18n();
const lines = ref([]);
const loading = ref(true);
const error = ref(null);

const timecode = (seconds) => {
  const value = Math.max(0, Number(seconds) || 0);
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}.${Math.floor((value % 1) * 10)}`;
};

onMounted(async () => {
  try {
    const data = await api.getSubtitles(props.clip.id);
    lines.value = data.lines.map((line) => ({ ...line }));
  } catch (err) {
    error.value = { code: err?.code ?? 'INTERNAL', message: err?.message };
  } finally {
    loading.value = false;
  }
});

function save() {
  const payload = lines.value
    .map((line) => ({ start: line.start, end: line.end, text: String(line.text ?? '').trim() }))
    .filter((line) => line.text);
  if (payload.length) emit('save', payload);
}
</script>

<template>
  <div class="space-y-3">
    <p class="text-xs leading-relaxed text-slate-500">{{ t('subtitles.hint') }}</p>

    <p v-if="loading" class="text-xs text-slate-400" aria-busy="true">
      {{ t('subtitles.loading') }}
    </p>

    <p v-else-if="error" role="alert" class="text-xs text-rose-300">
      {{ translateError(error) }}
    </p>

    <template v-else>
      <ul class="max-h-72 space-y-2 overflow-y-auto pr-1">
        <li v-for="(line, index) in lines" :key="index" class="flex items-start gap-2">
          <span
            class="mt-2 w-16 shrink-0 font-mono text-[10px] leading-none text-slate-500"
            aria-hidden="true"
          >
            {{ timecode(line.start) }}
          </span>
          <input
            v-model="line.text"
            type="text"
            maxlength="300"
            :aria-label="t('subtitles.lineLabel', { start: timecode(line.start), end: timecode(line.end) })"
            class="min-w-0 flex-1 rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-slate-100 transition focus:border-sky-400"
          />
        </li>
      </ul>

      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="rounded-lg bg-sky-500/90 px-4 py-2 text-sm font-semibold text-ink transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          :disabled="busy || lines.length === 0"
          @click="save"
        >
          {{ busy ? t('subtitles.saving') : t('subtitles.save') }}
        </button>

        <span class="text-[11px] text-slate-500">{{ t('subtitles.export') }} :</span>
        <a
          v-for="format in ['srt', 'vtt']"
          :key="format"
          :href="`/api/clips/${clip.id}/subtitles.${format}`"
          class="rounded-md border border-white/10 px-2 py-1 text-[11px] font-medium uppercase text-slate-300 transition hover:border-sky-400/40 hover:text-white"
          download
        >
          {{ format }}
        </a>
      </div>
    </template>
  </div>
</template>
