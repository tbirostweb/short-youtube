<script setup>
import { computed, ref } from 'vue';
import { parseYoutubeUrl } from '../lib/youtube.js';
import { useI18n } from '../i18n/index.js';

const props = defineProps({
  submitting: { type: Boolean, default: false },
});
const emit = defineEmits(['submit']);

const { t } = useI18n();
const url = ref('');
const touched = ref(false);

const parsed = computed(() => parseYoutubeUrl(url.value));
const isEmpty = computed(() => url.value.trim().length === 0);
// L'erreur ne s'affiche qu'une fois le champ quitté ou la saisie commencée.
const showError = computed(() => touched.value && !isEmpty.value && !parsed.value);
const canSubmit = computed(() => Boolean(parsed.value) && !props.submitting);

function onSubmit() {
  touched.value = true;
  if (!parsed.value) return;
  emit('submit', url.value.trim());
}
</script>

<template>
  <form class="space-y-2" novalidate @submit.prevent="onSubmit">
    <label for="youtube-url" class="block text-sm font-medium text-slate-200">
      {{ t('home.urlLabel') }}
    </label>

    <div class="flex flex-col gap-2 sm:flex-row">
      <input
        id="youtube-url"
        v-model="url"
        type="url"
        inputmode="url"
        autocomplete="off"
        spellcheck="false"
        required
        :placeholder="t('home.urlPlaceholder')"
        :aria-invalid="showError ? 'true' : 'false'"
        aria-describedby="url-hint url-error"
        class="min-w-0 flex-1 rounded-lg border bg-ink-soft px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 transition focus:border-sky-400"
        :class="showError ? 'border-rose-500/60' : 'border-white/10'"
        @blur="touched = true"
      />
      <button
        type="submit"
        class="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-500 px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
        :disabled="!canSubmit"
      >
        <span
          v-if="submitting"
          class="h-4 w-4 animate-spin rounded-full border-2 border-ink/40 border-t-ink"
          aria-hidden="true"
        />
        {{ submitting ? t('home.submitting') : t('home.submit') }}
      </button>
    </div>

    <p id="url-hint" class="text-xs text-slate-500">{{ t('home.urlHint') }}</p>
    <p v-if="showError" id="url-error" role="alert" class="text-xs font-medium text-rose-300">
      {{ t('error.INVALID_URL') }}
    </p>
  </form>
</template>
