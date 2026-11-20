import { describe, expect, test } from 'vitest';
import {
  amsterdamDateKey,
  amsterdamParts,
  formatDate,
  formatDateTime,
  formatDay,
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
});
