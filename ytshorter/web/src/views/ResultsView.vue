<script setup>
import { computed, onMounted } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import ClipList from '../components/ClipList.vue';
import ErrorNotice from '../components/ErrorNotice.vue';
import AppButton from '../components/ui/AppButton.vue';
import AppBadge from '../components/ui/AppBadge.vue';
import { useJobStore } from '../stores/job.js';
import { useI18n } from '../i18n/index.js';
import { pushToast } from '../lib/toast.js';

const props = defineProps({ id: { type: String, required: true } });

const { t } = useI18n();
const store = useJobStore();
const router = useRouter();

const total = computed(() => store.clips.length);
const publishedCount = computed(
  () => store.clips.filter((c) => c.published?.youtube || c.published?.tiktok).length,
);
const publishedRatio = computed(() =>
  total.value ? Math.round((publishedCount.value / total.value) * 100) : 0,
);

// Réglages utilisés pour cette génération : utile pour comprendre un résultat
// et pour reproduire (ou corriger) le suivant.
const settings = computed(() => {
  const out = [];
  out.push({
    label: store.seriesMode ? t('mode.series') : t('mode.highlights'),
    tone: store.seriesMode ? 'info' : 'neutral',
  });
  if (store.subtitleLanguage && store.subtitleLanguage !== 'source') {
    out.push({ label: store.subtitleLanguage.toUpperCase(), tone: 'neutral' });
  }
  return out;
});

async function onRestyle({ clipId, ...settingsPayload }) {
  try {
    await store.restyleClip(clipId, settingsPayload);
    pushToast(t('restyle.queued'), { tone: 'info' });
  } catch {
    /* affiché par ErrorNotice */
  }
}

async function onSaveSubtitles({ clipId, lines }) {
  try {
    await store.saveSubtitles(clipId, lines);
    pushToast(t('subtitles.saved'), { tone: 'success' });
  } catch {
    /* affiché par ErrorNotice */
  }
}

async function onPublished({ clipId, platform, published }) {
  try {
    await store.setPublished(clipId, platform, published);
    if (published) pushToast(t('publish.markedDone', { platform: t(`publish.${platform}`) }), { tone: 'success' });
  } catch {
    /* affiché par ErrorNotice */
  }
}

onMounted(async () => {
  try {
    const job = await store.load(props.id);
    if (job.status !== 'done' && job.status !== 'error') {
      router.replace({ name: 'job', params: { id: props.id } });
    }
  } catch {
    /* affiché par ErrorNotice */
  }
});
</script>

<template>
  <div class="space-y-6">
    <!-- En-tête : ce qu'on a produit, et où on en est -->
    <header class="space-y-4">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="min-w-0 space-y-1.5">
          <h1 class="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            {{ t('results.title') }}
          </h1>
          <p v-if="store.sourceTitle" class="truncate text-sm text-slate-400">
            {{ store.sourceTitle }}
          </p>
          <div v-if="settings.length" class="flex flex-wrap gap-1.5 pt-0.5">
            <AppBadge v-for="item in settings" :key="item.label" :tone="item.tone">
              {{ item.label }}
            </AppBadge>
          </div>
        </div>

        <div class="flex shrink-0 flex-wrap items-center gap-2">
          <AppButton
            v-if="store.hasClips"
            as="a"
            :href="`/api/jobs/${id}/clips.zip`"
            download
            variant="primary"
          >
            {{ t('publish.downloadAll') }}
          </AppButton>
          <AppButton as="a" href="/" @click.prevent="router.push({ name: 'home' })">
            {{ t('results.newJob') }}
          </AppButton>
        </div>
      </div>

      <!-- Avancement de publication -->
      <div v-if="store.hasClips" class="rounded-xl border border-white/10 bg-ink-soft p-4">
        <div class="mb-2 flex items-baseline justify-between gap-3">
          <span class="text-sm font-medium text-slate-200">
            {{ t('publish.progress', { done: publishedCount, total }) }}
          </span>
          <span class="font-mono text-xs text-emerald-300">{{ publishedRatio }} %</span>
        </div>
        <div class="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
          <div
            class="h-full rounded-full bg-emerald-400 transition-all duration-500"
            :style="{ width: `${publishedRatio}%` }"
          />
        </div>
        <p v-if="store.seriesMode" class="mt-2 text-xs text-sky-300/80">
          {{ t('publish.seriesOrder') }}
        </p>
      </div>
    </header>

    <!-- Chargement -->
    <div v-if="store.loading" class="space-y-2" aria-busy="true">
      <div v-for="n in 3" :key="n" class="h-[104px] animate-pulse rounded-xl bg-white/5" />
      <p class="sr-only">{{ t('loading.job') }}</p>
    </div>

    <template v-else>
      <ErrorNotice :error="store.error" />
      <ClipList
        v-if="!store.error"
        :clips="store.clips"
        :defaults="{
          captionStyle: store.options.captionStyle,
          focusX: store.options.focusX,
          layout: store.options.layout,
          hookOverlay: store.options.hookOverlay,
        }"
        @restyle="onRestyle"
        @save-subtitles="onSaveSubtitles"
        @published="onPublished"
      />
    </template>
  </div>
</template>
