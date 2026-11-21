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

// Plain calendar dates (YYYY-MM-DD), counted in UTC so no daylight-saving shift can move a day.
const WEEKDAYS = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
const MONTHS_LONG = [
  'januari', 'februari', 'maart', 'april', 'mei', 'juni',
  'juli', 'augustus', 'september', 'oktober', 'november', 'december',
];

function dayToUtc(isoDate: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

function utcToDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** YYYY-MM-DD plus `n` days (n may be negative). */
export function addDays(isoDate: string, n: number): string {
  const date = dayToUtc(isoDate);
  date.setUTCDate(date.getUTCDate() + n);
  return utcToDay(date);
}

/** YYYY-MM-DD plus `n` months; 31 jan + 1 month is 28 (or 29) feb, not 3 mar. */
export function addMonths(isoDate: string, n: number): string {
  const date = dayToUtc(isoDate);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + n);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return utcToDay(date);
}

/** 0 = maandag … 6 = zondag: Dutch weeks start on Monday. */
export function weekdayIndex(isoDate: string): number {
  return (dayToUtc(isoDate).getUTCDay() + 6) % 7;
}

/** "vrijdag 27 november 2026". */
export function formatDayLong(isoDate: string): string {
  const date = dayToUtc(isoDate);
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS_LONG[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** "vr 27 nov". */
export function formatDayWeekday(isoDate: string): string {
  return `${WEEKDAYS[dayToUtc(isoDate).getUTCDay()]!.slice(0, 2)} ${formatDayShort(isoDate)}`;
}

/** "november 2026" for the month that holds the date. */
export function formatMonth(isoDate: string): string {
  const date = dayToUtc(isoDate);
  return `${MONTHS_LONG[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}
