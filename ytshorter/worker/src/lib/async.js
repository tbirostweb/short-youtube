/**
 * Applique `fn` à chaque élément, en limitant le nombre d'exécutions
 * simultanées. Les résultats sont renvoyés dans l'ordre d'entrée.
 *
 * Utile pour les étapes réseau indépendantes (appels LLM par clip) : les lancer
 * en parallèle borné divise le temps d'attente sans marteler le quota gratuit.
 */
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  const max = Math.max(1, Math.min(limit, items.length));
  let next = 0;

  async function worker() {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: max }, () => worker()));
  return results;
}
