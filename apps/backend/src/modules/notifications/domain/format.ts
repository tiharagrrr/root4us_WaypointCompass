const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
const DAYS = 'Sun Mon Tue Wed Thu Fri Sat'.split(' ');

/** A business date "2026-10-02" as "Fri 2 Oct". */
export function dayLabel(date: unknown): string | null {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return null;
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DAYS[dow]} ${d} ${MONTHS[m - 1]}`;
}

const COLOMBO_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Colombo',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** An instant as Colombo clock time, "04:10". */
export function timeLabel(instant: unknown): string | null {
  if (!(typeof instant === 'string' || instant instanceof Date)) return null;
  const at = new Date(instant);
  return Number.isNaN(at.getTime()) ? null : COLOMBO_TIME.format(at);
}

/** "NO_REEFER_CAPACITY" as "no reefer capacity". */
export const codeLabel = (code: unknown): string | null =>
  typeof code === 'string' && code
    ? code.toLowerCase().replaceAll('_', ' ')
    : null;
