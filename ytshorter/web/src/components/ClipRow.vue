<script setup>
import { computed } from 'vue';
import AppBadge from './ui/AppBadge.vue';
import AppButton from './ui/AppButton.vue';
import PublishPanel from './PublishPanel.vue';
import ClipTools from './ClipTools.vue';
import { formatTimecode, formatDuration } from '../lib/format.js';
import { useI18n } from '../i18n/index.js';

// Une ligne de clip, repliée par défaut.
//
// L'ancienne carte affichait lecteur, métadonnées et outils en permanence :
// près de 1 700 pixels de haut par clip, donc aucune vue d'ensemble possible.
// Repliée, la ligne tient en une centaine de pixels et montre l'essentiel ;
// dépliée, elle donne accès à tout, sans quitter la page.
const props = defineProps({
  clip: { type: Object, required: true },
  index: { type: Number, required: true },
  expanded: { type: Boolean, default: false },
  defaults: { type: Object, default: () => ({}) },
});
const emit = defineEmits(['toggle', 'restyle', 'save-subtitles', 'published']);

const { t } = useI18n();

const range = computed(() =>
  t('results.range', {
    start: formatTimecode(props.clip.start),
    end: formatTimecode(props.clip.end),
  }),
);

const publishedOn = computed(() =>
  [props.clip.published?.youtube ? 'YouTube' : null, props.clip.published?.tiktok ? 'TikTok' : null]
    .filter(Boolean),
);

const busy = computed(
  () => props.clip.restyleStatus === 'queued' || props.clip.restyleStatus === 'processing',
);

// #t=0.5 : le navigateur affiche l'image d'une demi-seconde plutôt qu'un
// rectangle noir, ce qui donne une vraie vignette sans fichier séparé.
const posterSrc = computed(() => `${props.clip.downloadUrl}#t=0.5`);
</script>

<template>
  <article
    class="overflow-hidden rounded-xl border bg-ink-soft transition"
    :class="expanded ? 'border-sky-400/40' : 'border-white/10 hover:border-white/20'"
  >
    <!-- Ligne repliée : tout ce qu'il faut pour choisir, rien de plus. -->
    <button
      type="button"
      class="flex w-full items-center gap-3 p-3 text-left"
      :aria-expanded="expanded"
      @click="emit('toggle')"
    >
      <span class="relative shrink-0 overflow-hidden rounded-lg bg-black">
        <video
          :src="posterSrc"
          class="h-20 w-[45px] object-cover"
          preload="metadata"
          muted
          playsinline
          tabindex="-1"
          aria-hidden="true"
        />
        <span
          class="absolute left-1 top-1 rounded bg-black/75 px-1 text-[10px] font-bold text-white"
        >
          {{ index + 1 }}
        </span>
      </span>

      <span class="min-w-0 flex-1">
        <span class="flex flex-wrap items-center gap-1.5">
          <AppBadge>{{ formatDuration(clip.duration) }}</AppBadge>
          <AppBadge v-if="clip.score" tone="info">{{ clip.score }}/100</AppBadge>
          <AppBadge v-for="name in publishedOn" :key="name" tone="success">✓ {{ name }}</AppBadge>
          <AppBadge v-if="busy" tone="warning">{{ t('restyle.queued') }}</AppBadge>
          <AppBadge v-if="clip.subtitlesEdited" tone="neutral">{{ t('subtitles.edited') }}</AppBadge>
        </span>
        <span class="mt-1 block truncate text-sm font-medium text-slate-100">
          {{ clip.youtubeShorts?.title || clip.hook || range }}
        </span>
        <span class="mt-0.5 block truncate text-xs text-slate-500">{{ range }}</span>
      </span>

      <span class="shrink-0 text-slate-500 transition" :class="expanded ? 'rotate-180' : ''">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" />
        </svg>
      </span>
    </button>

    <!-- Contenu déplié -->
    <div v-if="expanded" class="border-t border-white/5 p-4 pt-3">
      <div class="grid gap-5 lg:grid-cols-[minmax(0,260px)_1fr]">
        <div class="space-y-3">
          <video
            class="mx-auto aspect-[9/16] w-full max-w-[260px] rounded-lg bg-black object-contain"
            :src="clip.downloadUrl"
            controls
            preload="metadata"
            playsinline
          >
            {{ t('results.videoUnsupported') }}
          </video>

          <AppButton :as="'a'" :href="clip.downloadUrl" download variant="primary" block>
            {{ t('results.download') }}
          </AppButton>

          <p v-if="clip.hook" class="text-xs italic leading-relaxed text-slate-400">
            « {{ clip.hook }} »
          </p>
        </div>

        <div class="min-w-0 space-y-4">
          <PublishPanel :clip="clip" @published="emit('published', $event)" />
          <ClipTools
            :clip="clip"
            :defaults="defaults"
            @restyle="emit('restyle', $event)"
            @save-subtitles="emit('save-subtitles', $event)"
          />
        </div>
      </div>
    </div>
  </article>
</template>
