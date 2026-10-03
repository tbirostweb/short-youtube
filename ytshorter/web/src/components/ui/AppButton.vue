<script setup>
import { computed } from 'vue';

// Bouton unique de l'application. Avant, chaque bouton répétait sa propre
// chaîne de classes : les tailles, les rayons et les états de survol
// divergeaient d'un écran à l'autre. Tout passe désormais par ici.
const props = defineProps({
  variant: { type: String, default: 'secondary' }, // primary | secondary | ghost | danger | success
  size: { type: String, default: 'md' }, // sm | md | lg
  loading: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  block: { type: Boolean, default: false },
  as: { type: String, default: 'button' }, // 'a' pour un lien
});

const VARIANTS = {
  primary: 'bg-sky-500 text-ink hover:bg-sky-400 disabled:bg-slate-700 disabled:text-slate-400',
  secondary:
    'border border-white/10 bg-white/[0.03] text-slate-200 hover:border-sky-400/40 hover:bg-white/[0.06] hover:text-white',
  ghost: 'text-slate-400 hover:bg-white/5 hover:text-slate-100',
  danger: 'border border-rose-400/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20',
  success: 'border border-emerald-400/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20',
};

const SIZES = {
  sm: 'px-2.5 py-1.5 text-xs gap-1.5',
  md: 'px-4 py-2 text-sm gap-2',
  lg: 'px-5 py-2.5 text-sm gap-2',
};

const classes = computed(() => [
  'inline-flex items-center justify-center rounded-lg font-semibold transition',
  'disabled:cursor-not-allowed disabled:opacity-60',
  VARIANTS[props.variant] ?? VARIANTS.secondary,
  SIZES[props.size] ?? SIZES.md,
  props.block ? 'w-full' : '',
]);
</script>

<template>
  <component
    :is="as"
    :class="classes"
    :disabled="as === 'button' ? disabled || loading : undefined"
    :aria-busy="loading || undefined"
  >
    <span
      v-if="loading"
      class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current/30 border-t-current"
      aria-hidden="true"
    />
    <slot />
  </component>
</template>
