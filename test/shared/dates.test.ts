import { describe, expect, test } from 'vitest';
import {
  amsterdamDateKey,
  amsterdamParts,
  formatDate,
  formatDateTime,
  formatDay,
  formatDayShort,
  formatDateLong,
  addDays,
  addMonths,
  weekdayIndex,
  formatDayLong,
  formatDayWeekday,
  formatMonth,
} from '../../src/shared/dates.js';

describe('Amsterdam dates', () => {
  test('winter time (CET, UTC+1)', () => {
    expect(amsterdamParts('2026-11-20T08:15:00Z')).toEqual({
      year: '2026',
      month: '11',
      day: '20',
      hour: '09',
      minute: '15',
    });
    expect(formatDateTime('2026-11-20T08:15:00Z')).toBe('20-11-2026 09:15');
  });

  test('summer time (CEST, UTC+2)', () => {
    expect(formatDateTime('2026-07-01T22:30:00Z')).toBe('02-07-2026 00:30');
    expect(amsterdamDateKey('2026-07-01T21:59:00Z')).toBe('2026-07-01');
    expect(amsterdamDateKey('2026-07-01T22:00:00Z')).toBe('2026-07-02');
  });

  test('DST switches', () => {
    // 29 March 2026 01:00Z: clocks jump from 02:00 to 03:00.
    expect(formatDateTime('2026-03-29T00:59:00Z')).toBe('29-03-2026 01:59');
    expect(formatDateTime('2026-03-29T01:00:00Z')).toBe('29-03-2026 03:00');
    // 25 October 2026 01:00Z: clocks fall back from 03:00 to 02:00.
    expect(formatDateTime('2026-10-25T00:59:00Z')).toBe('25-10-2026 02:59');
    expect(formatDateTime('2026-10-25T01:00:00Z')).toBe('25-10-2026 02:00');
  });

  test('New Year boundary', () => {
    expect(amsterdamDateKey('2026-12-31T22:59:59Z')).toBe('2026-12-31');
    expect(amsterdamDateKey('2026-12-31T23:00:00Z')).toBe('2027-01-01');
    expect(formatDate('2026-12-31T23:00:00Z')).toBe('01-01-2027');
    expect(formatDateTime('2026-12-31T23:00:00Z')).toBe('01-01-2027 00:00');
  });

  test('respects the offset in the input', () => {
    expect(amsterdamDateKey('2026-11-20T00:30:00+05:00')).toBe('2026-11-19');
    expect(formatDate('2026-11-20T09:15:00+01:00')).toBe('20-11-2026');
  });

  test('formatDay turns YYYY-MM-DD into dd-mm-yyyy without time-zone shifts', () => {
    expect(formatDay('2026-11-27')).toBe('27-11-2026');
    expect(formatDay('2027-01-01')).toBe('01-01-2027');
  });

  test('formatDayShort: "4 dec" with Dutch month abbreviations, no time-zone shifts', () => {
    expect(formatDayShort('2026-12-04')).toBe('4 dec');
    expect(formatDayShort('2027-03-31')).toBe('31 mrt');
    expect(formatDayShort('2027-01-01')).toBe('1 jan');
  });

  test('formatDateLong: "20 nov 2026" in Europe/Amsterdam', () => {
    expect(formatDateLong('2026-11-20T09:15:00+01:00')).toBe('20 nov 2026');
    expect(formatDateLong('2026-05-31T23:30:00Z')).toBe('1 jun 2026');
  });
});

describe('plain calendar dates', () => {
  test('addDays crosses months, years and the daylight-saving change without shifting', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  test('addMonths keeps the day, or takes the last day of a shorter month', () => {
    expect(addMonths('2026-11-20', 1)).toBe('2026-12-20');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
  });

  test('weeks start on Monday', () => {
    expect(weekdayIndex('2026-11-16')).toBe(0);
    expect(weekdayIndex('2026-11-20')).toBe(4);
    expect(weekdayIndex('2026-11-22')).toBe(6);
  });

  test('Dutch names', () => {
    expect(formatDayLong('2026-11-20')).toBe('vrijdag 20 november 2026');
    expect(formatDayWeekday('2026-12-04')).toBe('vr 4 dec');
    expect(formatMonth('2027-03-31')).toBe('maart 2027');
  });
});
