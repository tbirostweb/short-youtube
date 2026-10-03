<script setup>
import { useI18n } from '../i18n/index.js';

const { t } = useI18n();
</script>

<template>
  <footer class="mt-16 border-t border-white/5">
    <div
      class="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6"
    >
      <p>{{ t('app.name') }} — {{ t('footer.selfHosted') }}</p>
      <!--
        Emplacement légal : à compléter avant toute mise en ligne publique.
        Aucun texte légal n'est inventé ici.
      -->
      <p class="max-w-md text-slate-600">
        [{{ t('home.legalTitle') }}]
      </p>
    </div>
  </footer>
</template>
