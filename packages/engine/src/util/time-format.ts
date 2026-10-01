/** Minutes after midnight as HH:MM, for messages. */
export function formatMinutes(minutes: number): string {
  const total = Math.round(minutes);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
