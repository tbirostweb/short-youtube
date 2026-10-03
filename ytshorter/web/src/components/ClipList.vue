<script setup>
import { ref } from 'vue';
import ClipRow from './ClipRow.vue';
import { useI18n } from '../i18n/index.js';

// Liste de clips en accordéon : une seule ligne ouverte à la fois, pour
// garder la vue d'ensemble même sur une série de dix épisodes.
defineProps({
  clips: { type: Array, default: () => [] },
  defaults: { type: Object, default: () => ({}) },
});
const emit = defineEmits(['restyle', 'save-subtitles', 'published']);

const { t } = useI18n();
const openId = ref(null);

function toggle(id) {
  openId.value = openId.value === id ? null : id;
}
</script>

<template>
  <div v-if="clips.length" class="space-y-2">
    <ClipRow
      v-for="(clip, index) in clips"
      :key="clip.id"
      :clip="clip"
      :index="index"
      :defaults="defaults"
      :expanded="openId === clip.id"
      @toggle="toggle(clip.id)"
      @restyle="emit('restyle', $event)"
      @save-subtitles="emit('save-subtitles', $event)"
      @published="emit('published', $event)"
    />
  </div>

  <p
    v-else
    class="rounded-xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-slate-500"
  >
    {{ t('results.empty') }}
  </p>
</template>
