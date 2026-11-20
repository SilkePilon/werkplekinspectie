// The one place that turns timestamps into calendar dates. Every inspection date
// (schema check, PDF, file name, mail) is read in Europe/Amsterdam, whatever the
// server's or phone's own time zone is.

const amsterdam = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Amsterdam',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export interface DateParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
}

/** Zero-padded parts of an ISO-8601 datetime in Europe/Amsterdam. Throws RangeError on an invalid date. */
export function amsterdamParts(iso: string): DateParts {
  const parts = Object.fromEntries(
    amsterdam.formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  ) as Partial<Record<Intl.DateTimeFormatPartTypes, string>>;
  const { year = '', month = '', day = '', hour = '', minute = '' } = parts;
  return { year, month, day, hour, minute };
}

/** YYYY-MM-DD in Europe/Amsterdam; compares correctly as a string with `z.iso.date()` values. */
export function amsterdamDateKey(iso: string): string {
  const p = amsterdamParts(iso);
  return `${p.year}-${p.month}-${p.day}`;
}

/** dd-mm-yyyy in Europe/Amsterdam. */
export function formatDate(iso: string): string {
  const p = amsterdamParts(iso);
  return `${p.day}-${p.month}-${p.year}`;
}

/** dd-mm-yyyy HH:mm in Europe/Amsterdam. */
export function formatDateTime(iso: string): string {
  const p = amsterdamParts(iso);
  return `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute}`;
}

/** A plain calendar date YYYY-MM-DD → dd-mm-yyyy (no time zone involved). */
export function formatDay(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}-${m}-${y}`;
}

// Fixed list instead of Intl: browsers differ on dots ("dec.") in Dutch short months.
const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

/** A plain calendar date YYYY-MM-DD → "4 dec" (no time zone involved). */
export function formatDayShort(isoDate: string): string {
  const [, m, d] = isoDate.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? ''}`;
}

/** "20 nov 2026" in Europe/Amsterdam. */
export function formatDateLong(iso: string): string {
  const p = amsterdamParts(iso);
  return `${Number(p.day)} ${MONTHS[Number(p.month) - 1] ?? ''} ${p.year}`;
}
