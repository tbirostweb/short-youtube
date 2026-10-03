<script setup>
import { computed } from 'vue';
import CopyBlock from './CopyBlock.vue';
import { useI18n } from '../i18n/index.js';

// Publication assistée.
//
// Les plateformes verrouillent en privé les envois d'applications non
// auditées : publier reste donc manuel. Ce panneau supprime tout ce qui peut
// l'être autour — un bouton de copie par CHAMP RÉEL du formulaire (et non par
// donnée), le lien direct vers la page d'envoi, et la mémoire de ce qui est
// déjà en ligne.
const props = defineProps({
  clip: { type: Object, required: true },
});
const emit = defineEmits(['published']);

const { t } = useI18n();

const UPLOAD_URLS = {
  youtube: 'https://www.youtube.com/upload',
  tiktok: 'https://www.tiktok.com/upload',
};

// YouTube : la description et les hashtags vont dans la même zone de texte.
const youtubeDescription = computed(() =>
  [props.clip.youtubeShorts?.description, (props.clip.youtubeShorts?.hashtags ?? []).join(' ')]
    .filter(Boolean)
    .join('\n\n'),
);

// TikTok : un seul champ pour la légende ET les hashtags.
const tiktokCaption = computed(() =>
  [props.clip.tiktok?.caption, (props.clip.tiktok?.hashtags ?? []).join(' ')]
    .filter(Boolean)
    .join(' '),
);
</script>

<template>
  <div class="space-y-3">
    <p class="text-xs leading-relaxed text-slate-500">{{ t('publish.hint') }}</p>

    <div
      v-for="platform in ['youtube', 'tiktok']"
      :key="platform"
      class="rounded-lg border p-3 transition"
      :class="
        clip.published?.[platform]
          ? 'border-emerald-400/30 bg-emerald-500/5'
          : 'border-white/10 bg-black/20'
      "
    >
      <div class="mb-2 flex items-center justify-between gap-2">
        <span class="text-xs font-semibold text-slate-200">
          {{ t(`publish.${platform}`) }}
        </span>

        <div class="flex items-center gap-2">
          <a
            :href="UPLOAD_URLS[platform]"
            target="_blank"
            rel="noopener noreferrer"
            class="rounded-md border border-white/10 px-2 py-1 text-[11px] font-medium text-slate-300 transition hover:border-sky-400/40 hover:text-white"
          >
            {{ t('publish.open') }} ↗
          </a>
          <button
            type="button"
            class="rounded-md px-2 py-1 text-[11px] font-medium transition"
            :class="
              clip.published?.[platform]
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'border border-white/10 text-slate-400 hover:border-emerald-400/40 hover:text-emerald-300'
            "
            :aria-pressed="Boolean(clip.published?.[platform])"
            @click="
              emit('published', {
                clipId: clip.id,
                platform,
                published: !clip.published?.[platform],
              })
            "
          >
            {{ clip.published?.[platform] ? `✓ ${t('publish.done')}` : t('publish.markDone') }}
          </button>
        </div>
      </div>

      <div class="space-y-2">
        <template v-if="platform === 'youtube'">
          <CopyBlock :label="t('publish.copyTitle')" :text="clip.youtubeShorts?.title" />
          <CopyBlock :label="t('publish.copyDescription')" :text="youtubeDescription" multiline />
        </template>
        <CopyBlock v-else :label="t('publish.copyCaption')" :text="tiktokCaption" multiline />
      </div>
    </div>
  </div>
</template>
