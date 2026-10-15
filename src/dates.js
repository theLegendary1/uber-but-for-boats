/** Today's date (YYYY-MM-DD) in the server's time zone (TZ in docker-compose.yml), plus n days. */
export function localDay(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, '0')).join('-');
}
/** The hour (0-23) now, in the server's time zone. */
export const localHour = () => new Date().getHours();
/** A YYYY-MM-DD day plus n days. */
export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
