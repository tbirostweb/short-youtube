<script setup>
import { computed, ref } from 'vue';
import { useI18n } from '../i18n/index.js';

// Envoi d'un fichier vidéo : la voie recommandée pour recycler son propre
// contenu. Les contrôles faits ici (extension, taille) sont un confort :
// le serveur revalide tout, et c'est lui qui fait foi.
const props = defineProps({
  modelValue: { type: Object, default: null },
  disabled: { type: Boolean, default: false },
  uploadProgress: { type: Number, default: null },
  maxMb: { type: Number, default: 500 },
  formats: {
    type: Array,
    default: () => ['.mp4', '.mov', '.m4v', '.webm', '.mkv'],
  },
});
const emit = defineEmits(['update:modelValue']);

const { t } = useI18n();
const input = ref(null);
const dragging = ref(false);
const localError = ref('');

const accept = computed(() => props.formats.join(','));
const sizeLabel = computed(() => {
  if (!props.modelValue) return '';
  const mb = props.modelValue.size / (1024 * 1024);
  return mb < 1 ? `${Math.round(props.modelValue.size / 1024)} Ko` : `${mb.toFixed(1)} Mo`;
});

function validate(file) {
  const name = file.name.toLowerCase();
  if (!props.formats.some((ext) => name.endsWith(ext))) {
    localError.value = t('source.badFormat');
    return false;
  }
  if (file.size > props.maxMb * 1024 * 1024) {
    localError.value = t('source.tooLarge', { size: props.maxMb });
    return false;
  }
  if (file.size === 0) {
    localError.value = t('source.badFormat');
    return false;
  }
  localError.value = '';
  return true;
}

function pick(file) {
  if (!file) return;
  if (!validate(file)) {
    emit('update:modelValue', null);
    return;
  }
  emit('update:modelValue', file);
}

function onDrop(event) {
  dragging.value = false;
  if (props.disabled) return;
  pick(event.dataTransfer?.files?.[0]);
}

function clear() {
  localError.value = '';
  emit('update:modelValue', null);
  if (input.value) input.value.value = '';
}
</script>

<template>
  <div>
    <!-- Zone de dépôt. Le clavier y accède par le bouton « Choisir un fichier ». -->
    <div
      class="rounded-xl border-2 border-dashed px-4 py-8 text-center transition"
      :class="[
        dragging ? 'border-sky-400 bg-sky-400/5' : 'border-white/15',
        disabled ? 'opacity-60' : '',
      ]"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <template v-if="!modelValue">
        <p class="text-sm text-slate-300">{{ t('source.drop') }}</p>
        <p class="my-2 text-xs text-slate-500">{{ t('source.or') }}</p>
        <button
          type="button"
          :disabled="disabled"
          class="rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-sky-400/50 disabled:cursor-not-allowed"
          @click="input?.click()"
        >
          {{ t('source.choose') }}
        </button>
      </template>

      <template v-else>
        <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          {{ t('source.selected') }}
        </p>
        <p class="mt-1 truncate text-sm font-medium text-slate-100" :title="modelValue.name">
          {{ modelValue.name }}
        </p>
        <p class="text-xs text-slate-500">{{ sizeLabel }}</p>
        <button
          v-if="uploadProgress === null"
          type="button"
          class="mt-2 text-xs font-medium text-slate-400 underline underline-offset-2 transition hover:text-rose-300"
          @click="clear"
        >
          {{ t('source.remove') }}
        </button>
      </template>

      <input
        ref="input"
        type="file"
        class="sr-only"
        :accept="accept"
        :disabled="disabled"
        @change="pick($event.target.files?.[0])"
      />
    </div>

    <!-- Progression de l'envoi : indispensable sur un gros fichier. -->
    <div v-if="uploadProgress !== null" class="mt-3">
      <div class="mb-1 flex justify-between text-xs text-slate-400">
        <span>{{ t('source.uploading') }}</span>
        <span class="font-mono text-sky-300">{{ Math.round(uploadProgress * 100) }} %</span>
      </div>
      <div
        class="h-1.5 w-full overflow-hidden rounded-full bg-white/5"
        role="progressbar"
        :aria-valuenow="Math.round(uploadProgress * 100)"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <div
          class="h-full rounded-full bg-sky-400 transition-all duration-200"
          :style="{ width: `${Math.max(2, uploadProgress * 100)}%` }"
        />
      </div>
    </div>

    <p class="mt-2 text-xs text-slate-500">
      {{ t('source.formats', { formats: formats.join(', '), size: maxMb }) }}
    </p>
    <p v-if="localError" role="alert" class="mt-1 text-xs font-medium text-rose-300">
      {{ localError }}
    </p>
  </div>
</template>
