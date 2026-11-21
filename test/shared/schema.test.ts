import { afterEach, describe, expect, test, vi } from 'vitest';
import { QUESTIONS, type QuestionId } from '../../src/shared/questions.js';
import { LIMITS, submissionSchema, type Answer, type Submission } from '../../src/shared/schema.js';

const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
const SIGNATURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

function validSubmission(): Submission {
  const answers = Object.fromEntries(
    QUESTIONS.map((q) => [q.id, { answer: 'ja' } as Answer]),
  ) as Record<QuestionId, Answer>;
  answers['2C'] = { answer: 'nvt' };
  answers['4B'] = {
    answer: 'nee',
    comment: 'Sticker van keuring is verlopen.',
    actionBefore: '2026-11-20',
    photos: [PHOTO],
  };
  return {
    submissionId: '4f1c2b9e-8a7d-4c3b-9e2f-1a2b3c4d5e6f',
    monteur: 'J. Jansen',
    project: 'Voorbeeld B.V. magazijn',
    projectnummer: 'P-1234',
    startedAt: '2026-11-16T08:00:00+01:00',
    signedAt: '2026-11-16T08:30:00+01:00',
    answers,
    goodPractice: '',
    signature: SIGNATURE,
    declaration: true,
  };
}

function nee(overrides: Partial<Extract<Answer, { answer: 'nee' }>> = {}): Answer {
  return { answer: 'nee', comment: 'Kapot', actionBefore: '2026-11-20', photos: [], ...overrides };
}

const ok = (s: unknown) => submissionSchema.safeParse(s).success;

describe('submissionSchema', () => {
  test('accepts the fixture', () => {
    const r = submissionSchema.safeParse(validSubmission());
    expect(r.error).toBeUndefined();
    expect(r.success).toBe(true);
  });

  test('accepts the honeypot field when present', () => {
    expect(ok({ ...validSubmission(), website: '' })).toBe(true);
  });

  test('rejects a missing question id', () => {
    const s = validSubmission();
    delete (s.answers as Partial<Record<QuestionId, Answer>>)['9B'];
    expect(ok(s)).toBe(false);
  });

  test('rejects an extra unknown question id', () => {
    const s = validSubmission();
    expect(ok({ ...s, answers: { ...s.answers, '9C': { answer: 'ja' } } })).toBe(false);
  });

  test("rejects answer 'misschien'", () => {
    const s = validSubmission();
    expect(ok({ ...s, answers: { ...s.answers, '1A': { answer: 'misschien' } } })).toBe(false);
  });

  test('rejects nee with an empty comment', () => {
    const s = validSubmission();
    s.answers['1A'] = nee({ comment: '' });
    expect(ok(s)).toBe(false);
  });

  test('rejects nee with a whitespace-only comment', () => {
    const s = validSubmission();
    s.answers['1A'] = nee({ comment: '   ' });
    expect(ok(s)).toBe(false);
  });

  test('rejects a comment of 1001 chars but accepts 1000', () => {
    const s = validSubmission();
    s.answers['1A'] = nee({ comment: 'x'.repeat(LIMITS.comment) });
    expect(ok(s)).toBe(true);
    s.answers['1A'] = nee({ comment: 'x'.repeat(LIMITS.comment + 1) });
    expect(ok(s)).toBe(false);
  });

  test('accepts an optional comment on ja and nvt, up to the comment limit', () => {
    const s = validSubmission();
    const withAnswer = (a: unknown) => ({ ...s, answers: { ...s.answers, '1A': a } });
    expect(ok(withAnswer({ answer: 'ja', comment: 'Plan hangt bij de ingang.' }))).toBe(true);
    expect(ok(withAnswer({ answer: 'nvt', comment: '' }))).toBe(true);
    expect(ok(withAnswer({ answer: 'ja', comment: 'x'.repeat(LIMITS.comment) }))).toBe(true);
    expect(ok(withAnswer({ answer: 'ja', comment: 'x'.repeat(LIMITS.comment + 1) }))).toBe(false);
  });

  test('rejects nee details other than the comment on a ja answer', () => {
    const s = validSubmission();
    const withAnswer = (a: unknown) => ({ ...s, answers: { ...s.answers, '1A': a } });
    expect(ok(withAnswer({ answer: 'ja', actionBefore: '2099-01-01' }))).toBe(false);
    expect(ok(withAnswer({ answer: 'nvt', photos: [] }))).toBe(false);
  });

  test('rejects 4 photos on one item', () => {
    const s = validSubmission();
    s.answers['1A'] = nee({ photos: [PHOTO, PHOTO, PHOTO] });
    expect(ok(s)).toBe(true);
    s.answers['1A'] = nee({ photos: [PHOTO, PHOTO, PHOTO, PHOTO] });
    expect(ok(s)).toBe(false);
  });

  test('rejects 16 photos in total but accepts 15', () => {
    const s = validSubmission();
    const ids: QuestionId[] = ['1A', '1B', '1C', '1D', '2A'];
    for (const id of ids) s.answers[id] = nee({ photos: [PHOTO, PHOTO, PHOTO] });
    s.answers['4B'] = nee({ photos: [] });
    expect(ok(s)).toBe(true);
    s.answers['4B'] = nee({ photos: [PHOTO] });
    const r = submissionSchema.safeParse(s);
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path.join('.'))).toContain('answers');
  });

  test('rejects a photo that is not a JPEG data URL', () => {
    const s = validSubmission();
    s.answers['1A'] = nee({ photos: ['data:image/gif;base64,R0lGODlh'] });
    expect(ok(s)).toBe(false);
    s.answers['1A'] = nee({ photos: ['https://example.com/a.jpg'] });
    expect(ok(s)).toBe(false);
  });

  // The phone always sends JPEG; a PNG photo could hide a decompression bomb from the PDF step.
  test('rejects a PNG photo', () => {
    const s = validSubmission();
    s.answers['1A'] = nee({ photos: ['data:image/png;base64,iVBORw0KGgo='] });
    expect(ok(s)).toBe(false);
  });

  test('rejects a photo larger than the byte limit', () => {
    const s = validSubmission();
    const maxB64 = Math.ceil((LIMITS.photoBytes * 4) / 3);
    s.answers['1A'] = nee({ photos: ['data:image/jpeg;base64,' + 'A'.repeat(maxB64)] });
    expect(ok(s)).toBe(true);
    s.answers['1A'] = nee({ photos: ['data:image/jpeg;base64,' + 'A'.repeat(maxB64 + 4)] });
    expect(ok(s)).toBe(false);
  });

  test('rejects declaration:false', () => {
    expect(ok({ ...validSubmission(), declaration: false })).toBe(false);
  });

  test("rejects a signature that isn't data:image/png;base64,", () => {
    expect(ok({ ...validSubmission(), signature: 'data:image/jpeg;base64,/9j/4AAQ' })).toBe(false);
    expect(ok({ ...validSubmission(), signature: '' })).toBe(false);
    expect(ok({ ...validSubmission(), signature: 'data:image/png;base64,' })).toBe(false);
  });

  test('rejects a signature larger than the byte limit', () => {
    const maxB64 = Math.ceil((LIMITS.signatureBytes * 4) / 3);
    const big = 'data:image/png;base64,' + 'A'.repeat(maxB64 + 4);
    expect(ok({ ...validSubmission(), signature: big })).toBe(false);
  });

  test('rejects unknown top-level keys (strict)', () => {
    expect(ok({ ...validSubmission(), extra: 1 })).toBe(false);
  });

  test('rejects text fields over their limits and blank required text', () => {
    const s = validSubmission();
    expect(ok({ ...s, monteur: 'x'.repeat(LIMITS.monteur + 1) })).toBe(false);
    expect(ok({ ...s, project: 'x'.repeat(LIMITS.project + 1) })).toBe(false);
    expect(ok({ ...s, projectnummer: 'x'.repeat(LIMITS.projectnummer + 1) })).toBe(false);
    expect(ok({ ...s, goodPractice: 'x'.repeat(LIMITS.goodPractice + 1) })).toBe(false);
    expect(ok({ ...s, monteur: ' ' })).toBe(false);
  });

  test('rejects a non-uuid submissionId and non-ISO datetimes', () => {
    const s = validSubmission();
    expect(ok({ ...s, submissionId: 'abc' })).toBe(false);
    expect(ok({ ...s, startedAt: '16-11-2026 08:00' })).toBe(false);
    expect(ok({ ...s, signedAt: '2026-11-16T08:30:00' })).toBe(false);
  });

  test('rejects an invalid actionBefore date', () => {
    const s = validSubmission();
    s.answers['1A'] = nee({ actionBefore: '2026-02-30' });
    expect(ok(s)).toBe(false);
    s.answers['1A'] = nee({ actionBefore: '' });
    expect(ok(s)).toBe(false);
  });

  // Review Focus 1: "not in the past" is measured against the inspection date, not the clock.
  test('rejects actionBefore earlier than the Amsterdam date of startedAt', () => {
    const s = validSubmission();
    s.answers['1A'] = nee({ actionBefore: '2026-11-15' });
    const r = submissionSchema.safeParse(s);
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path.join('.'))).toContain('answers.1A.actionBefore');
  });

  test('uses the Amsterdam calendar day, not UTC', () => {
    // 23:30 UTC on 15 Nov is already 16 Nov in Amsterdam.
    const s = { ...validSubmission(), startedAt: '2026-11-15T23:30:00Z' };
    s.answers['1A'] = nee({ actionBefore: '2026-11-15' });
    expect(ok(s)).toBe(false);
    s.answers['1A'] = nee({ actionBefore: '2026-11-16' });
    expect(ok(s)).toBe(true);
  });

  test('accepts actionBefore on the inspection day itself', () => {
    const s = validSubmission();
    s.answers['1A'] = nee({ actionBefore: '2026-11-16' });
    expect(ok(s)).toBe(true);
  });

  describe('regardless of the current date', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    test.each(['2026-11-19T15:00:00+01:00', '2027-06-01T12:00:00+02:00'])(
      'accepts startedAt Monday with actionBefore Tuesday when sent at %s',
      (now) => {
        vi.useFakeTimers({ now: new Date(now) });
        const s = { ...validSubmission(), startedAt: '2026-11-16T08:00:00+01:00' };
        s.answers['1A'] = nee({ actionBefore: '2026-11-17' });
        expect(ok(s)).toBe(true);
      },
    );
  });
});
