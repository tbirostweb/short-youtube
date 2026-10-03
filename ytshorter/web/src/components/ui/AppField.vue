<script setup>
// Enveloppe d'un réglage : intitulé, valeur courante, aide.
// Uniformise l'alignement et la typographie de tous les contrôles.
defineProps({
  label: { type: String, required: true },
  hint: { type: String, default: '' },
  value: { type: String, default: '' },
  forId: { type: String, default: '' },
});
</script>

<template>
  <div>
    <component
      :is="forId ? 'label' : 'span'"
      :for="forId || undefined"
      class="flex items-baseline justify-between gap-3 text-sm font-medium text-slate-200"
    >
      <span>{{ label }}</span>
      <span v-if="value" class="font-mono text-xs text-sky-300">{{ value }}</span>
    </component>
    <div class="mt-2"><slot /></div>
    <p v-if="hint" class="mt-1.5 text-xs leading-relaxed text-slate-500">{{ hint }}</p>
  </div>
</template>
