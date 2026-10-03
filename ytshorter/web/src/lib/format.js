/** 92.4 -> "1:32" */
export function formatTimecode(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 42.7 -> "43 s" */
export function formatDuration(seconds) {
  return `${Math.round(Number(seconds) || 0)} s`;
}
