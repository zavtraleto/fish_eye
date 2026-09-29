// Number formats of the HUD and screens (GDD §14.3).

/** `12.48` */
export function formatSeconds(seconds: number): string {
  return Math.max(0, seconds).toFixed(2);
}

/** `02:41.22` */
export function formatClock(seconds: number): string {
  const cs = Math.floor(Math.max(0, seconds) * 100 + 1e-6);
  const m = Math.floor(cs / 6000);
  const s = Math.floor(cs / 100) % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

/** `07` */
export function formatCount(n: number): string {
  return String(n).padStart(2, '0');
}
