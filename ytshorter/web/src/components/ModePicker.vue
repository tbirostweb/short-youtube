<script setup>
import { useI18n } from '../i18n/index.js';

// Choix de la stratégie de découpage. C'est la décision la plus structurante
// de toute la génération : elle change la façon de choisir les extraits, leur
// ordre, et jusqu'à la rédaction des titres. Elle mérite donc deux options
// explicites plutôt qu'une case à cocher, et une illustration qui montre la
// différence sans avoir à lire.
defineProps({
  modelValue: { type: Boolean, default: false }, // true = épisodes à la suite
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue']);

const { t } = useI18n();

const MODES = [
  { value: false, key: 'highlights' },
  { value: true, key: 'series' },
];
</script>

<template>
  <div role="radiogroup" :aria-label="t('mode.label')" class="grid gap-3 sm:grid-cols-2">
    <button
      v-for="mode in MODES"
      :key="mode.key"
      type="button"
      role="radio"
      :aria-checked="modelValue === mode.value"
      :disabled="disabled"
      class="rounded-xl border p-3.5 text-left transition disabled:opacity-50"
      :class="
        modelValue === mode.value
          ? 'border-sky-400/60 bg-sky-400/[0.08]'
          : 'border-white/10 bg-black/20 hover:border-white/25'
      "
      @click="emit('update:modelValue', mode.value)"
    >
      <!-- Frise de la vidéo : les extraits retenus y sont mis en évidence. -->
      <span class="mb-3 flex h-8 w-full items-center gap-1 rounded-md bg-black/40 px-1.5">
        <template v-if="mode.key === 'highlights'">
          <!-- Moments épars, pris là où ils sont les plus forts -->
          <span class="h-1.5 flex-[2] rounded-full bg-white/10" />
          <span class="h-4 flex-[3] rounded-sm bg-sky-400" />
          <span class="h-1.5 flex-[4] rounded-full bg-white/10" />
          <span class="h-4 flex-[2] rounded-sm bg-sky-400" />
          <span class="h-1.5 flex-[1] rounded-full bg-white/10" />
          <span class="h-4 flex-[3] rounded-sm bg-sky-400" />
        </template>
        <template v-else>
          <!-- Épisodes contigus, dans l'ordre -->
          <span
            v-for="n in 3"
            :key="n"
            class="flex h-5 flex-1 items-center justify-center rounded-sm bg-fuchsia-400/90 text-[9px] font-bold text-ink"
          >
            {{ n }}
          </span>
          <span class="h-1.5 flex-[2] rounded-full bg-white/10" />
        </template>
      </span>

      <span class="block text-sm font-semibold text-slate-100">
        {{ t(`mode.${mode.key}`) }}
      </span>
      <span class="mt-1 block text-xs leading-relaxed text-slate-400">
        {{ t(`mode.${mode.key}Hint`) }}
      </span>
    </button>
  </div>
</template>
