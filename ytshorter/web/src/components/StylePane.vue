<script setup>
import { ref } from 'vue';
import CaptionPreview from './CaptionPreview.vue';
import LayoutPicker from './LayoutPicker.vue';
import { useI18n } from '../i18n/index.js';

// Ré-encodage d'un clip avec un autre style : ni téléchargement, ni
// transcription, ni appel LLM.
const props = defineProps({
  clip: { type: Object, required: true },
  defaults: { type: Object, default: () => ({ captionStyle: 'punch', focusX: 0.5 }) },
  busy: { type: Boolean, default: false },
});
const emit = defineEmits(['apply']);

const { t } = useI18n();
const captionStyle = ref(props.clip.captionStyle ?? props.defaults.captionStyle);
const focusX = ref(props.clip.focusX ?? props.defaults.focusX ?? 0.5);
const layout = ref(props.clip.layout ?? props.defaults.layout ?? 'crop');
const hookOverlay = ref(props.clip.hookOverlay ?? props.defaults.hookOverlay ?? false);
</script>

<template>
  <div class="space-y-3">
    <p class="text-xs leading-relaxed text-slate-500">{{ t('restyle.hint') }}</p>

    <CaptionPreview v-model="captionStyle" />
    <LayoutPicker v-model="layout" />

    <label class="flex cursor-pointer items-start gap-2">
      <input v-model="hookOverlay" type="checkbox" class="mt-0.5 h-4 w-4 shrink-0 accent-sky-400" />
      <span class="text-xs text-slate-300">{{ t('options.hookOverlay') }}</span>
    </label>

    <div v-if="layout === 'crop'">
      <label
        :for="`focus-${clip.id}`"
        class="flex items-baseline justify-between text-xs font-medium text-slate-300"
      >
        <span>{{ t('options.focus') }}</span>
        <span class="font-mono text-sky-300">{{ Math.round(focusX * 100) }} %</span>
      </label>
      <input
        :id="`focus-${clip.id}`"
        v-model.number="focusX"
        type="range"
        min="0"
        max="1"
        step="0.05"
        class="mt-2 w-full accent-sky-400"
      />
    </div>

    <button
      type="button"
      class="w-full rounded-lg bg-sky-500/90 px-4 py-2 text-sm font-semibold text-ink transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700"
      :disabled="busy"
      @click="
        emit('apply', {
          captionStyle,
          focusX: Number(focusX),
          layout,
          hookOverlay,
        })
      "
    >
      {{ t('restyle.apply') }}
    </button>
  </div>
</template>
