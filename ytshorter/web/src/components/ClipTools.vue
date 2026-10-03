<script setup>
import { computed, ref } from 'vue';
import StylePane from './StylePane.vue';
import TrimPanel from './TrimPanel.vue';
import SubtitleEditor from './SubtitleEditor.vue';
import { useI18n } from '../i18n/index.js';

// Reprendre la main sur un clip produit : style, bornes, sous-titres.
// Les trois passent par le même ré-encodage d'un seul clip, sans relancer
// le pipeline ni consommer de quota d'IA.
const props = defineProps({
  clip: { type: Object, required: true },
  defaults: { type: Object, default: () => ({}) },
});
const emit = defineEmits(['restyle', 'save-subtitles']);

const { t } = useI18n();
const open = ref(null);

const busy = computed(
  () => props.clip.restyleStatus === 'queued' || props.clip.restyleStatus === 'processing',
);

const tabs = computed(() => [
  { key: 'style', label: t('tools.style'), enabled: props.clip.restylable },
  { key: 'bounds', label: t('tools.bounds'), enabled: props.clip.restylable },
  { key: 'subtitles', label: t('tools.subtitles'), enabled: props.clip.subtitlesEditable },
]);

function toggle(key) {
  open.value = open.value === key ? null : key;
}
</script>

<template>
  <div class="border-t border-white/5 pt-3">
    <p v-if="busy" class="flex items-center gap-2 text-xs text-sky-300" aria-live="polite">
      <span
        class="h-3 w-3 animate-spin rounded-full border-2 border-sky-300/30 border-t-sky-300"
        aria-hidden="true"
      />
      {{ t('restyle.queued') }}
    </p>

    <p v-else-if="!clip.restylable && !clip.subtitlesEditable" class="text-xs text-slate-500">
      {{ t('restyle.unavailable') }}
    </p>

    <template v-else>
      <p v-if="clip.restyleStatus === 'error'" role="alert" class="mb-2 text-xs text-rose-300">
        {{ t('restyle.error') }}
      </p>

      <div class="flex flex-wrap items-center gap-1.5">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          :disabled="!tab.enabled"
          :aria-expanded="open === tab.key"
          class="rounded-md border px-2.5 py-1 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40"
          :class="
            open === tab.key
              ? 'border-sky-400/60 bg-sky-400/10 text-sky-200'
              : 'border-white/10 text-slate-300 hover:border-sky-400/40 hover:text-white'
          "
          @click="toggle(tab.key)"
        >
          {{ tab.label }}
        </button>

        <span
          v-if="clip.subtitlesEdited"
          class="ml-auto rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300"
        >
          {{ t('subtitles.edited') }}
        </span>
      </div>

      <div v-if="open" class="mt-3">
        <StylePane
          v-if="open === 'style'"
          :clip="clip"
          :defaults="defaults"
          :busy="busy"
          @apply="emit('restyle', { clipId: clip.id, ...$event })"
        />
        <TrimPanel
          v-else-if="open === 'bounds'"
          :clip="clip"
          :busy="busy"
          @apply="emit('restyle', { clipId: clip.id, ...$event })"
        />
        <SubtitleEditor
          v-else-if="open === 'subtitles'"
          :clip="clip"
          :busy="busy"
          @save="emit('save-subtitles', { clipId: clip.id, lines: $event })"
        />
      </div>
    </template>
  </div>
</template>
