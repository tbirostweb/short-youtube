<script setup>
import { toasts, dismissToast } from '../../lib/toast.js';

const TONES = {
  info: 'border-sky-400/30 bg-sky-500/10 text-sky-100',
  success: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100',
  danger: 'border-rose-400/30 bg-rose-500/10 text-rose-100',
};
</script>

<template>
  <!-- aria-live : les lecteurs d'écran annoncent aussi ces retours. -->
  <div
    class="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
    role="status"
    aria-live="polite"
  >
    <TransitionGroup
      enter-from-class="translate-y-2 opacity-0"
      enter-active-class="transition duration-200"
      leave-to-class="translate-y-1 opacity-0"
      leave-active-class="transition duration-150"
    >
      <button
        v-for="toast in toasts"
        :key="toast.id"
        type="button"
        class="pointer-events-auto max-w-sm rounded-lg border px-4 py-2.5 text-sm font-medium shadow-lg backdrop-blur"
        :class="TONES[toast.tone] ?? TONES.info"
        @click="dismissToast(toast.id)"
      >
        {{ toast.message }}
      </button>
    </TransitionGroup>
  </div>
</template>
