<script setup>
import { useI18n } from '../i18n/index.js';

// Choix de la mise en page verticale, montré plutôt qu'expliqué.
// Le recadrage remplit l'écran mais coupe les bords ; le fond flou garde toute
// l'image. Sur un plan large ou deux interlocuteurs, le second sauve le clip.
defineProps({
  modelValue: { type: String, required: true },
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue']);

const { t } = useI18n();
</script>

<template>
  <div role="radiogroup" :aria-label="t('options.layout')" class="grid grid-cols-2 gap-3">
    <button
      v-for="value in ['crop', 'blur']"
      :key="value"
      type="button"
      role="radio"
      :aria-checked="modelValue === value"
      :disabled="disabled"
      class="rounded-xl border p-2 text-left transition disabled:opacity-50"
      :class="
        modelValue === value ? 'border-sky-400 bg-sky-400/10' : 'border-white/10 hover:border-white/25'
      "
      @click="emit('update:modelValue', value)"
    >
      <span class="flex items-center justify-center overflow-hidden rounded-lg bg-black/40 p-2">
        <!-- Recadré : l'image occupe tout le cadre vertical. -->
        <span
          v-if="value === 'crop'"
          class="flex aspect-[9/16] w-14 items-center justify-center bg-gradient-to-br from-sky-500 via-indigo-500 to-fuchsia-500"
        >
          <span class="text-[9px] font-bold text-white/90">16:9 →</span>
        </span>
        <!-- Fond flou : l'image entière, centrée, sur un fond diffus. -->
        <span
          v-else
          class="relative flex aspect-[9/16] w-14 items-center justify-center overflow-hidden"
        >
          <span
            class="absolute inset-0 bg-gradient-to-br from-sky-500 via-indigo-500 to-fuchsia-500 opacity-60 blur-[6px]"
          />
          <span
            class="relative h-1/2 w-full bg-gradient-to-br from-sky-400 via-indigo-400 to-fuchsia-400"
          />
        </span>
      </span>

      <span class="mt-2 block text-center text-[11px] font-medium text-slate-200">
        {{ t(`options.layout.${value}`) }}
      </span>
      <span class="mt-0.5 block text-center text-[10px] leading-tight text-slate-500">
        {{ t(`options.layout.${value}Hint`) }}
      </span>
    </button>
  </div>
</template>
