import { afterEach, describe, expect, test, vi } from 'vitest';
import { QUESTION_IDS } from '@shared/questions';
import { submissionSchema } from '@shared/schema';
import {
  IncompleteDraftError,
  counts,
  draftReducer,
  missingFields,
  newDraft,
  nextUnanswered,
  toIsoWithOffset,
  toSubmission,
  type Draft,
  type DraftAction,
} from '../../src/client/state/draft';

const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
const SIGNATURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const START = new Date('2026-11-20T08:12:00Z');

function apply(d: Draft, ...actions: DraftAction[]): Draft {
  return actions.reduce(draftReducer, d);
}

function allJa(d: Draft): Draft {
  return apply(d, ...QUESTION_IDS.map((id): DraftAction => ({ type: 'answer', id, value: 'ja' })));
}

function signed(d: Draft): Draft {
  return apply(
    d,
    { type: 'sign', signature: SIGNATURE, at: '2026-11-20T09:40:00+01:00' },
    { type: 'declare', value: true },
  );
}

function complete(): Draft {
  return signed(allJa(newDraft('J. Jansen', 'Voorbeeld B.V. magazijn', 'P-1234', START)));
}

const originalTz = process.env.TZ;
afterEach(() => {
  vi.useRealTimers();
  process.env.TZ = originalTz;
});

describe('toIsoWithOffset', () => {
  test('writes local time with the Amsterdam offset in winter and summer', () => {
    process.env.TZ = 'Europe/Amsterdam';
    expect(toIsoWithOffset(new Date('2026-11-20T08:12:00Z'))).toBe('2026-11-20T09:12:00+01:00');
    expect(toIsoWithOffset(new Date('2026-07-01T22:30:05Z'))).toBe('2026-07-02T00:30:05+02:00');
  });

  test('handles negative, half-hour and zero offsets', () => {
    process.env.TZ = 'America/New_York';
    expect(toIsoWithOffset(new Date('2026-01-05T03:04:05Z'))).toBe('2026-01-04T22:04:05-05:00');
    process.env.TZ = 'Asia/Kolkata';
    expect(toIsoWithOffset(new Date('2026-01-05T03:04:05Z'))).toBe('2026-01-05T08:34:05+05:30');
    process.env.TZ = 'UTC';
    expect(toIsoWithOffset(new Date('2026-01-05T03:04:05Z'))).toBe('2026-01-05T03:04:05+00:00');
  });

  test('round-trips to the same instant', () => {
    const d = new Date('2026-03-29T01:30:00Z');
    expect(new Date(toIsoWithOffset(d)).getTime()).toBe(d.getTime());
  });
});

describe('newDraft', () => {
  test('starts empty with a uuid, timestamps with offset and an empty honeypot', () => {
    process.env.TZ = 'Europe/Amsterdam';
    const d = newDraft('J. Jansen', 'Voorbeeld B.V.', 'P-1', START);
    expect(d.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(d).toMatchObject({
      monteur: 'J. Jansen',
      project: 'Voorbeeld B.V.',
      projectnummer: 'P-1',
      startedAt: '2026-11-20T09:12:00+01:00',
      updatedAt: '2026-11-20T09:12:00+01:00',
      answers: {},
      nee: {},
      goodPractice: '',
      declaration: false,
      website: '',
    });
    expect(d.signature).toBeUndefined();
    expect(newDraft('a', 'b', 'c', START).id).not.toBe(d.id);
  });
});

describe('draftReducer', () => {
  test('sets updatedAt on every action and does not mutate the input', () => {
    process.env.TZ = 'Europe/Amsterdam';
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-20T08:30:00Z'));
    const d = newDraft('J. Jansen', 'X', 'P-1', START);
    const next = draftReducer(d, { type: 'answer', id: '1A', value: 'ja' });
    expect(next.updatedAt).toBe('2026-11-20T09:30:00+01:00');
    expect(next.answers['1A']).toBe('ja');
    expect(d.answers['1A']).toBeUndefined();
    expect(d.updatedAt).toBe('2026-11-20T09:12:00+01:00');
  });

  test('merges nee details and updates header, good practice, signature, declaration and honeypot', () => {
    const d = apply(
      newDraft('J. Jansen', 'X', 'P-1', START),
      { type: 'neeDetails', id: '2A', details: { comment: 'Kabel ligt los' } },
      { type: 'neeDetails', id: '2A', details: { actionBefore: '2026-11-25' } },
      { type: 'header', project: 'Y' },
      { type: 'goodPractice', text: 'Netjes' },
      { type: 'sign', signature: SIGNATURE, at: '2026-11-20T09:40:00+01:00' },
      { type: 'declare', value: true },
      { type: 'honeypot', value: 'spam' },
    );
    expect(d.nee['2A']).toEqual({ comment: 'Kabel ligt los', actionBefore: '2026-11-25', photos: [] });
    expect(d).toMatchObject({
      monteur: 'J. Jansen',
      project: 'Y',
      projectnummer: 'P-1',
      goodPractice: 'Netjes',
      signature: SIGNATURE,
      signedAt: '2026-11-20T09:40:00+01:00',
      declaration: true,
      website: 'spam',
    });
  });
});

describe('Review Focus 3: changing Nee to Ja', () => {
  test('emits only {answer:"ja"} but keeps the details for switching back', () => {
    let d = apply(
      complete(),
      { type: 'answer', id: '4B', value: 'nee' },
      {
        type: 'neeDetails',
        id: '4B',
        details: { comment: 'Sticker verlopen', actionBefore: '2026-11-27', photos: [PHOTO] },
      },
      { type: 'answer', id: '4B', value: 'ja' },
    );
    const s = toSubmission(d);
    expect(s.answers['4B']).toStrictEqual({ answer: 'ja' });
    expect(JSON.stringify(s)).not.toContain(PHOTO);
    expect(JSON.stringify(s)).not.toContain('Sticker verlopen');
    expect(counts(d)).toEqual({ ja: 21, nee: 0, nvt: 0 });

    d = draftReducer(d, { type: 'answer', id: '4B', value: 'nee' });
    expect(d.nee['4B']?.comment).toBe('Sticker verlopen');
    expect(toSubmission(d).answers['4B']).toStrictEqual({
      answer: 'nee',
      comment: 'Sticker verlopen',
      actionBefore: '2026-11-27',
      photos: [PHOTO],
    });
  });
});

describe('toSubmission', () => {
  test('passes submissionSchema.parse with ja, nee and nvt answers', () => {
    const d = apply(
      complete(),
      { type: 'answer', id: '2C', value: 'nvt' },
      { type: 'answer', id: '4B', value: 'nee' },
      { type: 'neeDetails', id: '4B', details: { comment: '  Sticker verlopen \n', actionBefore: '2026-11-20' } },
      { type: 'answer', id: '9A', value: 'nee' },
      { type: 'neeDetails', id: '9A', details: { comment: 'Leeg', actionBefore: '2026-12-01', photos: [PHOTO] } },
      { type: 'goodPractice', text: 'Opgeruimde werkplek' },
    );
    const s = toSubmission(d);
    expect(submissionSchema.parse(s)).toStrictEqual(s);
    expect(s).toMatchObject({
      submissionId: d.id,
      startedAt: d.startedAt,
      signedAt: '2026-11-20T09:40:00+01:00',
      declaration: true,
      website: '',
      goodPractice: 'Opgeruimde werkplek',
    });
    expect(s.answers['2C']).toStrictEqual({ answer: 'nvt' });
    expect(s.answers['4B']).toStrictEqual({
      answer: 'nee',
      comment: 'Sticker verlopen',
      actionBefore: '2026-11-20',
      photos: [],
    });
    expect(Object.keys(s.answers)).toEqual([...QUESTION_IDS]);
  });

  test('always emits the honeypot value', () => {
    const s = toSubmission(draftReducer(complete(), { type: 'honeypot', value: 'http://spam' }));
    expect(s.website).toBe('http://spam');
  });

  test('the emitted photos array is not shared with the draft', () => {
    const d = apply(
      complete(),
      { type: 'answer', id: '1A', value: 'nee' },
      { type: 'neeDetails', id: '1A', details: { comment: 'x', actionBefore: '2026-11-21', photos: [PHOTO] } },
    );
    const a = toSubmission(d).answers['1A'];
    if (a?.answer !== 'nee') throw new Error('expected nee');
    a.photos.push(PHOTO);
    expect(d.nee['1A']?.photos).toHaveLength(1);
  });

  test('throws IncompleteDraftError listing an unanswered question', () => {
    const d = apply(newDraft('J. Jansen', 'X', 'P-1', START), { type: 'answer', id: '1A', value: 'ja' });
    const err = (() => {
      try {
        toSubmission(signed(d));
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(IncompleteDraftError);
    expect((err as IncompleteDraftError).missing).toContain('answers.1B');
    expect((err as IncompleteDraftError).missing).not.toContain('answers.1A');
  });

  test('throws when a nee item lacks a comment', () => {
    const d = apply(
      complete(),
      { type: 'answer', id: '4B', value: 'nee' },
      { type: 'neeDetails', id: '4B', details: { comment: '   ', actionBefore: '2026-11-27' } },
    );
    expect(() => toSubmission(d)).toThrow(IncompleteDraftError);
    expect(missingFields(d)).toEqual(['answers.4B.comment']);
  });

  test('throws when a nee item lacks a date, also without any details yet', () => {
    const d = apply(
      complete(),
      { type: 'answer', id: '4B', value: 'nee' },
      { type: 'neeDetails', id: '4B', details: { comment: 'Kapot' } },
      { type: 'answer', id: '5A', value: 'nee' },
    );
    expect(() => toSubmission(d)).toThrow(IncompleteDraftError);
    expect(missingFields(d)).toEqual([
      'answers.4B.actionBefore',
      'answers.5A.comment',
      'answers.5A.actionBefore',
    ]);
  });
});

describe('missingFields', () => {
  test('is empty for a complete draft', () => {
    expect(missingFields(complete())).toEqual([]);
  });

  test('lists header, every question, signature and declaration on a blank draft', () => {
    const m = missingFields(newDraft(' ', '', '', START));
    expect(m).toEqual([
      'monteur',
      'project',
      'projectnummer',
      ...QUESTION_IDS.map((id) => `answers.${id}`),
      'signature',
      'declaration',
    ]);
  });
});

describe('nextUnanswered', () => {
  test("returns '1A' on a new draft and null when all are answered", () => {
    const d = newDraft('J. Jansen', 'X', 'P-1', START);
    expect(nextUnanswered(d)).toBe('1A');
    expect(nextUnanswered(allJa(d))).toBeNull();
  });

  test('returns the first gap in question order', () => {
    const d = apply(
      newDraft('J. Jansen', 'X', 'P-1', START),
      { type: 'answer', id: '1A', value: 'ja' },
      { type: 'answer', id: '1C', value: 'nvt' },
    );
    expect(nextUnanswered(d)).toBe('1B');
  });
});

describe('counts', () => {
  test('counts ja, nee and nvt answers', () => {
    const d = apply(
      newDraft('J. Jansen', 'X', 'P-1', START),
      { type: 'answer', id: '1A', value: 'ja' },
      { type: 'answer', id: '1B', value: 'nee' },
      { type: 'answer', id: '1C', value: 'nvt' },
      { type: 'answer', id: '1D', value: 'nvt' },
      { type: 'answer', id: '2A', value: 'ja' },
      { type: 'answer', id: '2A', value: 'nee' },
    );
    expect(counts(d)).toEqual({ ja: 1, nee: 2, nvt: 2 });
    expect(counts(newDraft('a', 'b', 'c', START))).toEqual({ ja: 0, nee: 0, nvt: 0 });
  });
});
