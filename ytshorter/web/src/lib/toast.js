import { ref } from 'vue';

// Notifications éphémères.
//
// Jusqu'ici, une copie réussie ou une publication marquée ne se signalait que
// dans le bouton lui-même — invisible dès qu'on avait fait défiler la page.
// Un retour central rend chaque action perceptible.

let nextId = 1;
export const toasts = ref([]);

export function pushToast(message, { tone = 'info', duration = 2600 } = {}) {
  const id = nextId++;
  toasts.value = [...toasts.value, { id, message, tone }];
  if (duration > 0) {
    setTimeout(() => dismissToast(id), duration);
  }
  return id;
}

export function dismissToast(id) {
  toasts.value = toasts.value.filter((toast) => toast.id !== id);
}

export const useToast = () => ({ pushToast, dismissToast });
