<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import UrlForm from '../components/UrlForm.vue';
import FileDropZone from '../components/FileDropZone.vue';
import OptionsPanel from '../components/OptionsPanel.vue';
import ErrorNotice from '../components/ErrorNotice.vue';
import AppButton from '../components/ui/AppButton.vue';
import { useJobStore, defaultOptions } from '../stores/job.js';
import { useI18n } from '../i18n/index.js';

const { t } = useI18n();
const router = useRouter();
const store = useJobStore();

const options = ref({ ...defaultOptions, ...store.options });
const mode = ref('url');
const file = ref(null);
const legalOpen = ref(false);

async function start(promise) {
  store.options = { ...options.value };
  try {
    const jobId = await promise;
    router.push({ name: 'job', params: { id: jobId } });
  } catch {
    /* affiché par ErrorNotice */
  }
}

const onSubmitUrl = (youtubeUrl) => start(store.submit({ youtubeUrl, ...options.value }));
const onSubmitFile = () => file.value && start(store.submitFile(file.value, options.value));
</script>

<template>
  <div class="space-y-8">
    <section class="space-y-3">
      <h1 class="text-3xl font-bold tracking-tight text-white sm:text-4xl">
        {{ t('home.title') }}
      </h1>
      <p class="max-w-2xl text-sm leading-relaxed text-slate-400 sm:text-base">
        {{ t('home.subtitle') }}
      </p>
    </section>

    <!-- ── 1. La source ─────────────────────────────────────────── -->
    <section class="rounded-2xl border border-white/10 bg-ink-soft p-4 sm:p-6">
      <div class="mb-5 flex gap-1 rounded-lg bg-black/30 p-1" role="tablist">
        <button
          v-for="tab in ['url', 'file']"
          :key="tab"
          type="button"
          role="tab"
          :aria-selected="mode === tab"
          :disabled="store.submitting"
          class="flex-1 rounded-md px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed"
          :class="
            mode === tab
              ? 'bg-sky-500/20 text-sky-100 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          "
          @click="mode = tab"
        >
          {{ t(`source.${tab}`) }}
        </button>
      </div>

      <UrlForm v-if="mode === 'url'" :submitting="store.submitting" @submit="onSubmitUrl" />

      <div v-else class="space-y-4">
        <p class="text-xs leading-relaxed text-emerald-300/80">{{ t('source.fileHint') }}</p>
        <FileDropZone
          v-model="file"
          :disabled="store.submitting"
          :upload-progress="store.uploadProgress"
        />
        <AppButton
          variant="primary"
          size="lg"
          block
          :loading="store.submitting"
          :disabled="!file || store.submitting"
          @click="onSubmitFile"
        >
          {{ store.submitting ? t('home.submitting') : t('source.submitFile') }}
        </AppButton>
      </div>
    </section>

    <!-- ── 2. Les réglages ──────────────────────────────────────── -->
    <section class="rounded-2xl border border-white/10 bg-ink-soft p-4 sm:p-6">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-400">
        {{ t('home.options') }}
      </h2>
      <p class="mt-1 text-xs text-slate-500">{{ t('home.optionsHint') }}</p>
      <div class="mt-5">
        <OptionsPanel v-model="options" :disabled="store.submitting" />
      </div>
    </section>

    <ErrorNotice :error="store.error" />

    <!--
      Bloc légal : emplacement clairement marqué, à remplir.
      Replié par défaut pour ne pas écraser l'écran, mais toujours accessible.
      Aucun texte légal n'est inventé.
    -->
    <section class="rounded-xl border border-amber-400/20 bg-amber-400/[0.04]">
      <button
        type="button"
        class="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        :aria-expanded="legalOpen"
        @click="legalOpen = !legalOpen"
      >
        <span class="text-sm font-medium text-amber-200">{{ t('home.legalTitle') }}</span>
        <span class="text-xs text-amber-300/70">{{ legalOpen ? '−' : '+' }}</span>
      </button>
      <p v-if="legalOpen" class="px-4 pb-4 text-sm leading-relaxed text-amber-100/80">
        {{ t('home.legalBody') }}
      </p>
    </section>
  </div>
</template>
