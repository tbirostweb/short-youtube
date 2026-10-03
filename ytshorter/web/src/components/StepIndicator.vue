<script setup>
import { computed } from 'vue';
import { useI18n } from '../i18n/index.js';

const props = defineProps({
  currentStep: { type: String, default: 'queued' },
  progress: { type: Number, default: 0 },
  status: { type: String, default: 'queued' },
  sourceKind: { type: String, default: 'youtube' },
  subtitleLanguage: { type: String, default: 'source' },
});

const { t } = useI18n();

// Les étapes suivent exactement celles émises par le worker. L'étape de
// traduction n'est affichée que lorsqu'elle a réellement lieu : montrer une
// étape qui ne s'exécutera jamais serait trompeur.
const STEPS = computed(() => {
  const steps = ['download', 'transcribe', 'select'];
  if (props.subtitleLanguage && props.subtitleLanguage !== 'source') steps.push('translate');
  return [...steps, 'cut', 'render', 'metadata', 'finalize'];
});

const currentIndex = computed(() => {
  if (props.status === 'done') return STEPS.value.length;
  const index = STEPS.value.indexOf(props.currentStep);
  return index === -1 ? -1 : index;
});

// Un fichier envoyé n'est pas « téléchargé » : le libellé le dit.
function labelFor(step) {
  if (step === 'download' && props.sourceKind === 'upload') return t('steps.prepare');
  return t(`steps.${step}`);
}

function descriptionFor(step) {
  if (step === 'download' && props.sourceKind === 'upload') return t('steps.desc.prepare');
  return t(`steps.desc.${step}`);
}

function stateOf(index) {
  if (props.status === 'error') {
    if (index === currentIndex.value) return 'error';
    return index < currentIndex.value ? 'done' : 'pending';
  }
  if (index < currentIndex.value) return 'done';
  if (index === currentIndex.value) return 'current';
  return 'pending';
}
</script>

<template>
  <div>
    <div class="mb-2 flex items-baseline justify-between text-sm">
      <span class="font-medium text-slate-200">{{ t('job.progress') }}</span>
      <span class="font-mono text-sky-300">{{ Math.round(progress) }} %</span>
    </div>

    <div
      class="h-2 w-full overflow-hidden rounded-full bg-white/5"
      role="progressbar"
      :aria-valuenow="Math.round(progress)"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="t('job.progress')"
    >
      <div
        class="h-full rounded-full transition-all duration-500"
        :class="status === 'error' ? 'bg-rose-500' : 'bg-gradient-to-r from-sky-500 to-fuchsia-400'"
        :style="{ width: `${Math.max(2, Math.min(100, progress))}%` }"
      />
    </div>

    <ol class="mt-6 space-y-2" aria-live="polite">
      <li
        v-for="(step, index) in STEPS"
        :key="step"
        class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition"
        :class="{
          'bg-sky-500/10 text-sky-100': stateOf(index) === 'current',
          'text-slate-400': stateOf(index) === 'pending',
          'text-slate-300': stateOf(index) === 'done',
          'bg-rose-500/10 text-rose-100': stateOf(index) === 'error',
        }"
      >
        <span
          class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold"
          :class="{
            'border-sky-400 bg-sky-400 text-ink': stateOf(index) === 'done',
            'border-sky-400 text-sky-200': stateOf(index) === 'current',
            'border-white/10 text-slate-500': stateOf(index) === 'pending',
            'border-rose-400 text-rose-200': stateOf(index) === 'error',
          }"
          aria-hidden="true"
        >
          <template v-if="stateOf(index) === 'done'">✓</template>
          <template v-else-if="stateOf(index) === 'error'">!</template>
          <template v-else>{{ index + 1 }}</template>
        </span>

        <span class="flex-1">
          {{ labelFor(step) }}
          <!-- L'explication n'apparaît que sur l'étape en cours : sinon la
               liste devient un pavé illisible. -->
          <span
            v-if="stateOf(index) === 'current'"
            class="mt-0.5 block text-xs font-normal leading-relaxed text-sky-200/70"
          >
            {{ descriptionFor(step) }}
          </span>
        </span>

        <span
          v-if="stateOf(index) === 'current' && status !== 'error'"
          class="h-3 w-3 animate-spin rounded-full border-2 border-sky-300/30 border-t-sky-300"
          :aria-label="labelFor(step)"
        />
      </li>
    </ol>
  </div>
</template>
