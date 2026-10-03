<script setup>
import { computed, ref, watch } from 'vue';
import CaptionPreview from './CaptionPreview.vue';
import ModePicker from './ModePicker.vue';
import LayoutPicker from './LayoutPicker.vue';
import AppField from './ui/AppField.vue';
import { useI18n } from '../i18n/index.js';

// Réglages de génération, en deux niveaux.
//
// Auparavant les huit contrôles se suivaient avec le même poids visuel :
// impossible de savoir lesquels comptent. Les quatre qui changent vraiment le
// résultat sont désormais visibles, le reste est replié.
const props = defineProps({
  modelValue: { type: Object, required: true },
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue']);

const { t } = useI18n();
const advancedOpen = ref(false);

// Copie locale mise à jour de façon synchrone : les props ne sont rafraîchies
// qu'au prochain rendu, si bien que deux réglages modifiés dans le même tick
// partiraient du même instantané et le premier serait écrasé.
const local = ref({ ...props.modelValue });
watch(
  () => props.modelValue,
  (value) => {
    local.value = { ...value };
  },
  { deep: true },
);

function update(key, value) {
  local.value = { ...local.value, [key]: value };
  emit('update:modelValue', { ...local.value });
}

const metadataLanguages = [
  { code: 'fr', label: 'Français' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'pt', label: 'Português' },
];

const focusLabel = computed(() => {
  const x = Number(local.value.focusX);
  if (x < 0.35) return t('options.focusLeft');
  if (x > 0.65) return t('options.focusRight');
  return t('options.focusCenter');
});

const selectClass =
  'w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-slate-100 transition focus:border-sky-400';
</script>

<template>
  <fieldset class="space-y-6" :disabled="disabled">
    <legend class="sr-only">{{ t('home.options') }}</legend>

    <!-- ── Stratégie : la décision qui conditionne tout le reste ── -->
    <AppField :label="t('mode.label')">
      <ModePicker
        :model-value="local.seriesMode"
        :disabled="disabled"
        @update:model-value="update('seriesMode', $event)"
      />
    </AppField>

    <!-- ── Réglages essentiels ─────────────────────────────────── -->
    <div class="grid gap-5 sm:grid-cols-2">
      <AppField
        :label="t('options.clipCount')"
        :value="String(local.clipCount)"
        for-id="opt-count"
      >
        <input
          id="opt-count"
          type="range"
          min="1"
          max="10"
          step="1"
          class="w-full accent-sky-400"
          :value="local.clipCount"
          @input="update('clipCount', Number($event.target.value))"
        />
      </AppField>

      <AppField
        :label="t('options.targetDuration')"
        :value="`${local.targetDuration} s`"
        for-id="opt-duration"
      >
        <input
          id="opt-duration"
          type="range"
          min="15"
          max="90"
          step="5"
          class="w-full accent-sky-400"
          :value="local.targetDuration"
          @input="update('targetDuration', Number($event.target.value))"
        />
      </AppField>
    </div>

    <AppField :label="t('options.captionStyle')">
      <CaptionPreview
        :model-value="local.captionStyle"
        :disabled="disabled"
        @update:model-value="update('captionStyle', $event)"
      />
    </AppField>

    <AppField
      :label="t('options.language')"
      :hint="t('options.languageHint')"
      for-id="opt-language"
    >
      <select
        id="opt-language"
        :class="selectClass"
        :value="local.language"
        @change="update('language', $event.target.value)"
      >
        <option v-for="lang in metadataLanguages" :key="lang.code" :value="lang.code">
          {{ lang.label }}
        </option>
      </select>
    </AppField>

    <!-- ── Réglages avancés ────────────────────────────────────── -->
    <div class="rounded-xl border border-white/10">
      <button
        type="button"
        class="flex w-full items-center justify-between gap-2 px-3.5 py-3 text-left"
        :aria-expanded="advancedOpen"
        @click="advancedOpen = !advancedOpen"
      >
        <span class="text-sm font-medium text-slate-200">{{ t('options.advanced') }}</span>
        <span class="text-xs text-slate-500">
          {{ advancedOpen ? '−' : '+' }}
        </span>
      </button>

      <div v-if="advancedOpen" class="space-y-5 border-t border-white/5 p-3.5">
        <AppField :label="t('options.layout')">
          <LayoutPicker
            :model-value="local.layout"
            :disabled="disabled"
            @update:model-value="update('layout', $event)"
          />
        </AppField>

        <AppField
          v-if="local.layout === 'crop'"
          :label="t('options.focus')"
          :value="focusLabel"
          :hint="t('options.trackingHint')"
          for-id="opt-focus"
        >
          <input
            id="opt-focus"
            type="range"
            min="0"
            max="1"
            step="0.05"
            class="w-full accent-sky-400"
            :value="local.focusX"
            @input="update('focusX', Number($event.target.value))"
          />
          <div class="mt-1 flex justify-between text-[11px] text-slate-500">
            <span>{{ t('options.focusLeft') }}</span>
            <span>{{ t('options.focusCenter') }}</span>
            <span>{{ t('options.focusRight') }}</span>
          </div>
        </AppField>

        <AppField
          :label="t('options.subtitleLanguage')"
          :hint="t('options.subtitleLanguageHint')"
          for-id="opt-subtitle-language"
        >
          <select
            id="opt-subtitle-language"
            :class="selectClass"
            :value="local.subtitleLanguage"
            @change="update('subtitleLanguage', $event.target.value)"
          >
            <option value="source">{{ t('options.subtitleSource') }}</option>
            <option v-for="lang in metadataLanguages" :key="lang.code" :value="lang.code">
              {{ lang.label }}
            </option>
          </select>
        </AppField>

        <label class="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            class="mt-0.5 h-4 w-4 shrink-0 accent-sky-400"
            :checked="local.hookOverlay"
            @change="update('hookOverlay', $event.target.checked)"
          />
          <span>
            <span class="block text-sm font-medium text-slate-200">
              {{ t('options.hookOverlay') }}
            </span>
            <span class="mt-0.5 block text-xs leading-relaxed text-slate-500">
              {{ t('options.hookOverlayHint') }}
            </span>
          </span>
        </label>
      </div>
    </div>
  </fieldset>
</template>
