<script setup>
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import ErrorNotice from '../components/ErrorNotice.vue';
import { useLibraryStore } from '../stores/library.js';
import { useI18n } from '../i18n/index.js';

const { t, locale } = useI18n();
const library = useLibraryStore();

// Suppression en deux temps : pas de fenêtre modale native, et pas de
// suppression sur un clic isolé.
const confirming = ref(null);
let confirmTimer = null;

function askDelete(jobId) {
  clearTimeout(confirmTimer);
  confirming.value = jobId;
  confirmTimer = setTimeout(() => {
    confirming.value = null;
  }, 5000);
}

async function confirmDelete(jobId) {
  clearTimeout(confirmTimer);
  confirming.value = null;
  await library.remove(jobId);
}

const dateFormat = computed(
  () =>
    new Intl.DateTimeFormat(locale.value, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }),
);

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : dateFormat.value.format(date);
}

const STATUS_CLASS = {
  done: 'bg-emerald-500/15 text-emerald-300',
  error: 'bg-rose-500/15 text-rose-300',
  processing: 'bg-sky-500/15 text-sky-300',
  queued: 'bg-slate-500/15 text-slate-300',
};

onMounted(() => library.load());
</script>

<template>
  <div class="space-y-6">
    <header class="space-y-1">
      <h1 class="text-2xl font-bold tracking-tight text-white sm:text-3xl">
        {{ t('library.title') }}
      </h1>
      <p class="text-sm text-slate-400">{{ t('library.subtitle') }}</p>
    </header>

    <ErrorNotice :error="library.error" />

    <!-- Chargement -->
    <div v-if="library.loading && library.jobs.length === 0" class="space-y-3" aria-busy="true">
      <div v-for="n in 3" :key="n" class="h-20 animate-pulse rounded-xl bg-white/5" />
    </div>

    <!-- État vide -->
    <div
      v-else-if="library.isEmpty"
      class="rounded-xl border border-dashed border-white/10 px-4 py-12 text-center"
    >
      <p class="text-sm text-slate-400">{{ t('library.empty') }}</p>
      <RouterLink
        :to="{ name: 'home' }"
        class="mt-4 inline-block rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-ink transition hover:bg-sky-400"
      >
        {{ t('library.emptyCta') }}
      </RouterLink>
    </div>

    <ul v-else class="space-y-3">
      <li
        v-for="job in library.jobs"
        :key="job.id"
        class="rounded-xl border border-white/10 bg-ink-soft p-4"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span
                class="rounded-md px-2 py-0.5 text-[11px] font-semibold"
                :class="STATUS_CLASS[job.status] ?? STATUS_CLASS.queued"
              >
                {{ t(`steps.${job.status === 'processing' ? job.currentStep : job.status}`) }}
              </span>
              <span class="text-[11px] text-slate-500">
                {{ job.sourceKind === 'upload' ? t('library.sourceUpload') : t('library.sourceYoutube') }}
              </span>
              <span class="text-[11px] text-slate-500">{{ formatDate(job.createdAt) }}</span>
            </div>

            <p class="mt-1.5 truncate text-sm font-medium text-slate-100">
              {{ job.sourceTitle || job.sourceName || t('library.untitled') }}
            </p>

            <p class="mt-0.5 text-xs text-slate-500">
              <span v-if="job.status === 'done'">
                {{ t('library.clips', { count: job.clipsCount }) }}
              </span>
              <span v-else-if="job.status === 'error' && job.error">
                {{ job.error.message }}
              </span>
              <span v-else>{{ job.progress }} %</span>
            </p>
          </div>

          <div class="flex shrink-0 items-center gap-2">
            <RouterLink
              :to="{ name: job.status === 'done' ? 'results' : 'job', params: { id: job.id } }"
              class="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-sky-400/40 hover:text-white"
            >
              {{ t('library.open') }}
            </RouterLink>

            <button
              v-if="confirming !== job.id"
              type="button"
              class="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-slate-400 transition hover:border-rose-400/40 hover:text-rose-300 disabled:opacity-50"
              :disabled="library.deletingId === job.id"
              @click="askDelete(job.id)"
            >
              {{ t('library.delete') }}
            </button>
            <button
              v-else
              type="button"
              class="rounded-lg border border-rose-400/50 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/20"
              @click="confirmDelete(job.id)"
            >
              {{ t('library.delete') }} ?
            </button>
          </div>
        </div>

        <p v-if="confirming === job.id" class="mt-2 text-xs text-rose-300/80">
          {{ t('library.deleteConfirm') }}
        </p>
      </li>
    </ul>

    <button
      v-if="library.hasMore"
      type="button"
      class="w-full rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-slate-300 transition hover:border-sky-400/40 hover:text-white"
      :disabled="library.loading"
      @click="library.load({ append: true })"
    >
      {{ t('library.loadMore') }}
    </button>
  </div>
</template>
