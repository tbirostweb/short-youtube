// Journalisation minimale en JSON sur stdout.
// Les secrets ne sont jamais passés au logger : seules des métadonnées le sont.
const LEVELS = { fatal: 60, error: 50, warn: 40, info: 30, debug: 20, trace: 10 };

export function createLogger(level = 'info', base = {}) {
  const threshold = LEVELS[level] ?? 30;
  function emit(lvl, obj, msg) {
    if (LEVELS[lvl] < threshold) return;
    const payload =
      typeof obj === 'string' ? { msg: obj } : { ...obj, msg: msg ?? obj?.msg ?? '' };
    process.stdout.write(
      JSON.stringify({ time: new Date().toISOString(), level: lvl, ...base, ...payload }) + '\n',
    );
  }
  return {
    child(extra) {
      return createLogger(level, { ...base, ...extra });
    },
    fatal: (o, m) => emit('fatal', o, m),
    error: (o, m) => emit('error', o, m),
    warn: (o, m) => emit('warn', o, m),
    info: (o, m) => emit('info', o, m),
    debug: (o, m) => emit('debug', o, m),
    trace: (o, m) => emit('trace', o, m),
  };
}
