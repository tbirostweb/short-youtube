<script setup>
import { useI18n } from '../i18n/index.js';

// Sélecteur visuel du style de sous-titres.
// Choisir dans une liste déroulante revient à choisir à l'aveugle, puis à
// attendre plusieurs minutes pour découvrir le résultat : ici l'aperçu montre
// le rendu réel de chaque préréglage (casse, couleurs, contour, bandeau).
defineProps({
  modelValue: { type: String, required: true },
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue']);

const { t } = useI18n();

const STYLES = [
  { value: 'punch', sample: 'LE MOMENT CLÉ' },
  { value: 'clean', sample: 'Le moment clé' },
  { value: 'boxed', sample: 'Le moment clé' },
  // Aucun sous-titre incrusté : les sous-titres restent exportables en SRT.
  { value: 'none', sample: '' },
];
</script>

<template>
  <div role="radiogroup" :aria-label="t('options.captionStyle')" class="grid grid-cols-2 gap-3 sm:grid-cols-4">
    <button
      v-for="style in STYLES"
      :key="style.value"
      type="button"
      role="radio"
      :aria-checked="modelValue === style.value"
      :disabled="disabled"
      class="group rounded-xl border p-2 text-left transition disabled:opacity-50"
      :class="
        modelValue === style.value
          ? 'border-sky-400 bg-sky-400/10'
          : 'border-white/10 hover:border-white/25'
      "
      @click="emit('update:modelValue', style.value)"
    >
      <span
        class="mx-auto flex aspect-[9/16] w-20 items-end justify-center overflow-hidden rounded-lg bg-gradient-to-br from-slate-600 via-slate-700 to-slate-900 p-1.5"
      >
        <!-- Aperçu : reproduit les couleurs et la casse du préréglage ASS. -->
        <span
          v-if="style.value === 'punch'"
          class="preview-text text-[9px] font-extrabold uppercase leading-tight text-[#FFE500]"
          style="-webkit-text-stroke: 0.6px #000"
        >
          {{ style.sample }}
        </span>
        <span
          v-else-if="style.value === 'clean'"
          class="preview-text text-[9px] font-bold leading-tight text-[#00E5FF]"
          style="-webkit-text-stroke: 0.4px #000"
        >
          {{ style.sample }}
        </span>
        <span
          v-else-if="style.value === 'boxed'"
          class="rounded bg-black/70 px-1 py-0.5 text-[9px] font-bold leading-tight text-white"
        >
          {{ style.sample }}
        </span>
        <!-- Aucun sous-titre : image nue -->
        <span v-else class="text-[9px] font-medium text-slate-400/70">—</span>
      </span>

      <span class="mt-2 block text-center text-[11px] font-medium text-slate-300">
        {{ t(`options.style.${style.value}`).split('—')[0].trim() }}
      </span>
    </button>
  </div>
</template>

<style scoped>
.preview-text {
  text-align: center;
  text-shadow:
    0 1px 2px rgba(0, 0, 0, 0.9),
    0 0 4px rgba(0, 0, 0, 0.6);
}
</style>
