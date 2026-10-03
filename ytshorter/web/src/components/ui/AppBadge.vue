<script setup>
import { computed } from 'vue';

// Pastille d'état, lisible d'un coup d'œil.
const props = defineProps({
  tone: { type: String, default: 'neutral' }, // neutral | info | success | warning | danger
});

const TONES = {
  neutral: 'bg-white/[0.06] text-slate-300',
  info: 'bg-sky-500/15 text-sky-300',
  success: 'bg-emerald-500/15 text-emerald-300',
  warning: 'bg-amber-500/15 text-amber-300',
  danger: 'bg-rose-500/15 text-rose-300',
};

const classes = computed(() => [
  'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
  TONES[props.tone] ?? TONES.neutral,
]);
</script>

<template>
  <span :class="classes"><slot /></span>
</template>
