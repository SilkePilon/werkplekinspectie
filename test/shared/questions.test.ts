import { describe, expect, test } from 'vitest';
import { QUESTIONS, SECTIONS } from '../../src/shared/questions.js';

const EXPECTED_IDS = [
  '1A', '1B', '1C', '1D', '2A', '2B', '2C', '3A', '3B', '4A', '4B', '4C',
  '5A', '6A', '7A', '7B', '8A', '8B', '8C', '9A', '9B',
];

describe('QUESTIONS', () => {
  test('has 21 questions', () => {
    expect(QUESTIONS.length).toBe(21);
  });

  test('ids follow the form, in order', () => {
    expect(QUESTIONS.map((q) => q.id)).toEqual(EXPECTED_IDS);
  });

  test('every question belongs to a known section matching its id', () => {
    const nrs = SECTIONS.map((s) => s.nr);
    for (const q of QUESTIONS) {
      expect(nrs).toContain(q.section);
      expect(q.id.startsWith(String(q.section))).toBe(true);
    }
  });

  test('1D has the app text and the original form text', () => {
    const q = QUESTIONS.find((x) => x.id === '1D');
    expect(q?.appText).toBe('Heb je je LMRA-kaart bij je?');
    expect(q?.formText).toBe('LMRA pas voorhanden');
  });
});

describe('SECTIONS', () => {
  test('has sections 1 to 9 in order with short and form titles', () => {
    expect(SECTIONS.map((s) => s.nr)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const s3 = SECTIONS.find((s) => s.nr === 3);
    expect(s3?.title).toBe('Gereedschap');
    expect(s3?.formTitle).toBe('Gereedschappen en klimmaterieel');
    expect(s3?.icon).toBe('gereedschap');
  });
});
