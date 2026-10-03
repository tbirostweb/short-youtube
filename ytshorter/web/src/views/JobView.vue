<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import StepIndicator from '../components/StepIndicator.vue';
import ErrorNotice from '../components/ErrorNotice.vue';
import AppButton from '../components/ui/AppButton.vue';
import AppBadge from '../components/ui/AppBadge.vue';
import { useJobStore } from '../stores/job.js';
import { useI18n } from '../i18n/index.js';

const props = defineProps({ id: { type: String, required: true } });

const { t } = useI18n();
const store = useJobStore();
const router = useRouter();

// Chronomètre : sur un traitement de plusieurs minutes, voir le temps avancer
// distingue une machine qui travaille d'une machine bloquée.
const startedAt = ref(Date.now());
const now = ref(Date.now());
let ticker = null;

const elapsed = computed(() => {
  const seconds = Math.max(0, Math.floor((now.value - startedAt.value) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
});

const showFallbackNotice = computed(
  () => !store.live && store.status !== 'done' && store.status !== 'error' && !store.loading,
);

const settings = computed(() => {
  const out = [`${store.clipCount ?? '?'} ${t('results.clipsWord')}`];
  out.push(store.seriesMode ? t('mode.series') : t('mode.highlights'));
  return out;
});

onMounted(async () => {
  ticker = setInterval(() => {
    now.value = Date.now();
  }, 1000);

  try {
    const job = await store.load(props.id);
    if (job.status === 'done') {
      router.replace({ name: 'results', params: { id: props.id } });
      return;
    }
    if (job.status !== 'error') store.trackProgress(props.id);
  } catch {
    /* affiché par ErrorNotice */
  }
});

watch(
  () => store.status,
  (status) => {
    if (status === 'done') router.replace({ name: 'results', params: { id: props.id } });
  },
);

onBeforeUnmount(() => {
  store.stopTracking();
  if (ticker) clearInterval(ticker);
});
</script>

<template>
  <div class="space-y-6">
    <header class="space-y-2">
      <h1 class="text-2xl font-bold tracking-tight text-white sm:text-3xl">
        {{ store.status === 'error' ? t('error.title') : t('job.title') }}
      </h1>
      <p v-if="store.status !== 'error'" class="text-sm text-slate-400">{{ t('job.subtitle') }}</p>
      <p v-if="store.sourceTitle" class="truncate text-sm text-slate-300">
        {{ store.sourceTitle }}
      </p>
      <div v-if="store.status !== 'error'" class="flex flex-wrap gap-1.5 pt-1">
        <AppBadge v-for="item in settings" :key="item" tone="neutral">{{ item }}</AppBadge>
        <AppBadge tone="info">{{ t('job.elapsed') }} {{ elapsed }}</AppBadge>
      </div>
    </header>

    <div v-if="store.loading" class="space-y-3" aria-busy="true">
      <div class="h-2 w-full animate-pulse rounded-full bg-white/5" />
      <div v-for="n in 5" :key="n" class="h-11 animate-pulse rounded-lg bg-white/5" />
      <p class="sr-only">{{ t('loading.job') }}</p>
    </div>

    <template v-else>
      <ErrorNotice :error="store.status === 'error' ? store.error : null" :show-title="false" />

      <section
        v-if="store.status !== 'error'"
        class="rounded-2xl border border-white/10 bg-ink-soft p-4 sm:p-6"
      >
        <StepIndicator
          :current-step="store.currentStep"
          :progress="store.progress"
          :status="store.status"
          :source-kind="store.sourceKind"
          :subtitle-language="store.subtitleLanguage"
        />

        <p
          v-if="store.status === 'queued' && store.queuePosition"
          class="mt-4 text-xs text-sky-300/90"
          aria-live="polite"
        >
          {{
            store.queuePosition === 1
              ? t('job.queueFirst')
              : t('job.queuePosition', { position: store.queuePosition })
          }}
        </p>
        <p v-if="showFallbackNotice" class="mt-4 text-xs text-amber-300/80">
          {{ t('job.liveOffFallback') }}
        </p>
      </section>

      <div class="flex flex-wrap gap-3">
        <AppButton
          v-if="store.status === 'done'"
          variant="primary"
          @click="router.push({ name: 'results', params: { id } })"
        >
          {{ t('job.viewResults') }}
        </AppButton>
        <AppButton @click="router.push({ name: 'home' })">
          {{ store.status === 'error' ? t('job.retry') : t('job.backHome') }}
        </AppButton>
      </div>
    </template>
  </div>
</template>
