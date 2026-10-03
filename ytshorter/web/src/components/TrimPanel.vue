<script setup>
import { computed, ref } from 'vue';
import { useI18n } from '../i18n/index.js';

// Ajustement des bornes d'un clip déjà produit.
//
// Un extrait qui démarre une seconde trop tard est inutilisable, et regénérer
// toute la vidéo pour cela serait absurde. La découpe ayant été conservée avec
// une marge, ces secondes existent encore : il suffit de les reprendre.
const props = defineProps({
  clip: { type: Object, required: true },
  busy: { type: Boolean, default: false },
});
const emit = defineEmits(['apply']);

const { t } = useI18n();

const MIN_DURATION = 5;
const before = computed(() => Number(props.clip.adjustable?.before ?? 0));
const after = computed(() => Number(props.clip.adjustable?.after ?? 0));
const available = computed(() => before.value > 0.05 || after.value > 0.05);

// Décalages en secondes, relatifs aux bornes actuelles.
const deltaStart = ref(0);
const deltaEnd = ref(0);

const duration = computed(
  () => Number(props.clip.end) - Number(props.clip.start) - Number(deltaStart.value) + Number(deltaEnd.value),
);
const valid = computed(() => duration.value >= MIN_DURATION);

const format = (value) => `${value > 0 ? '+' : ''}${Number(value).toFixed(1)} s`;

function apply() {
  emit('apply', {
    startSeconds: Number(props.clip.start) + Number(deltaStart.value),
    endSeconds: Number(props.clip.end) + Number(deltaEnd.value),
  });
}
</script>

<template>
  <div class="space-y-3">
    <p class="text-xs leading-relaxed text-slate-500">{{ t('bounds.hint') }}</p>

    <p v-if="!available" class="text-xs text-slate-500">{{ t('bounds.none') }}</p>

    <template v-else>
      <div>
        <label
          :for="`trim-start-${clip.id}`"
          class="flex items-baseline justify-between text-xs font-medium text-slate-300"
        >
          <span>{{ t('bounds.start') }}</span>
          <span class="font-mono text-sky-300">{{ format(deltaStart) }}</span>
        </label>
        <input
          :id="`trim-start-${clip.id}`"
          v-model.number="deltaStart"
          type="range"
          :min="-before"
          :max="Math.max(0, clip.end - clip.start - MIN_DURATION)"
          step="0.1"
          class="mt-2 w-full accent-sky-400"
        />
      </div>

      <div>
        <label
          :for="`trim-end-${clip.id}`"
          class="flex items-baseline justify-between text-xs font-medium text-slate-300"
        >
          <span>{{ t('bounds.end') }}</span>
          <span class="font-mono text-sky-300">{{ format(deltaEnd) }}</span>
        </label>
        <input
          :id="`trim-end-${clip.id}`"
          v-model.number="deltaEnd"
          type="range"
          :min="-Math.max(0, clip.end - clip.start - MIN_DURATION)"
          :max="after"
          step="0.1"
          class="mt-2 w-full accent-sky-400"
        />
      </div>

      <p class="text-xs text-slate-400">
        {{ t('bounds.duration') }} :
        <span class="font-mono" :class="valid ? 'text-sky-300' : 'text-rose-300'">
          {{ duration.toFixed(1) }} s
        </span>
      </p>

      <button
        type="button"
        class="w-full rounded-lg bg-sky-500/90 px-4 py-2 text-sm font-semibold text-ink transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
        :disabled="busy || !valid || (deltaStart === 0 && deltaEnd === 0)"
        @click="apply"
      >
        {{ t('bounds.apply') }}
      </button>
    </template>
  </div>
</template>
