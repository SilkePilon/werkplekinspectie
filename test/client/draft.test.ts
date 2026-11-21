import { afterEach, describe, expect, test, vi } from 'vitest';
import { QUESTION_IDS } from '@shared/questions';
import { submissionSchema } from '@shared/schema';
import {
  IncompleteDraftError,
  counts,
  draftFromSubmission,
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
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
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

describe('draftFromSubmission', () => {
  test('rebuilds the draft, keeps every answer, and asks for a new signature', () => {
    vi.useFakeTimers({ now: new Date('2026-12-03T10:00:00Z') });
    const d = apply(
      complete(),
      { type: 'answer', id: '2C', value: 'nvt' },
      { type: 'answer', id: '4B', value: 'nee' },
      { type: 'neeDetails', id: '4B', details: { comment: 'Sticker verlopen', actionBefore: '2026-11-25', photos: [PHOTO] } },
      { type: 'goodPractice', text: 'Opgeruimde werkplek' },
      { type: 'honeypot', value: 'x' },
    );
    const s = toSubmission(d);
    const back = draftFromSubmission(s);

    expect(back).toMatchObject({
      id: d.id,
      monteur: d.monteur,
      project: d.project,
      projectnummer: d.projectnummer,
      startedAt: d.startedAt,
      goodPractice: 'Opgeruimde werkplek',
      website: 'x',
      signedAt: '2026-11-20T09:40:00+01:00',
      declaration: false,
    });
    expect(back.signature).toBeUndefined();
    expect(back.answers).toEqual(d.answers);
    expect(back.nee).toEqual({ '4B': { comment: 'Sticker verlopen', actionBefore: '2026-11-25', photos: [PHOTO] } });
    // Fresh `updatedAt`, so the 14-day purge counts from now and not from the inspection date.
    expect(back.updatedAt).toBe(toIsoWithOffset(new Date('2026-12-03T10:00:00Z')));
    // Only the new signature and the declaration are missing; signing again makes it sendable.
    expect(missingFields(back)).toEqual(['signature', 'declaration']);
    expect(toSubmission(signed(back))).toEqual(s);
  });

  test('the draft does not share photo arrays with the submission', () => {
    const s = toSubmission(
      apply(
        complete(),
        { type: 'answer', id: '1A', value: 'nee' },
        { type: 'neeDetails', id: '1A', details: { comment: 'x', actionBefore: '2026-11-21', photos: [PHOTO] } },
      ),
    );
    const back = draftFromSubmission(s);
    back.nee['1A']!.photos.push(PHOTO);
    expect(s.answers['1A']).toMatchObject({ photos: [PHOTO] });
  });

  test('a submission without the honeypot key gives an empty honeypot', () => {
    const s = toSubmission(complete());
    delete s.website;
    expect(draftFromSubmission(s).website).toBe('');
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

describe('missingFields matches what the server refuses', () => {
  const NEE_IDS = ['1A', '1B', '2A', '3A', '4B', '5A'] as const;

  function withNee(ids: readonly (typeof NEE_IDS)[number][], photos: number, actionBefore = '2026-11-27'): Draft {
    let d = complete();
    for (const id of ids) {
      d = apply(
        d,
        { type: 'answer', id, value: 'nee' },
        { type: 'neeDetails', id, details: { comment: 'Kapot.', actionBefore, photos: Array(photos).fill(PHOTO) } },
      );
    }
    return d;
  }

  test('an "Opgelost vóór" date before the inspection day is missing; the inspection day itself is fine', () => {
    expect(missingFields(withNee(['4B'], 0, '2026-11-19'))).toEqual(['answers.4B.actionBefore']);
    expect(missingFields(withNee(['4B'], 0, '2026-11-20'))).toEqual([]);
  });

  test('the inspection day is the Amsterdam calendar day of startedAt', () => {
    // 23:30 UTC on the 20th is already the 21st in Amsterdam.
    const d = { ...withNee(['4B'], 0, '2026-11-20'), startedAt: '2026-11-20T23:30:00Z' };
    expect(missingFields(d)).toEqual(['answers.4B.actionBefore']);
    expect(missingFields({ ...d, nee: { '4B': { ...d.nee['4B']!, actionBefore: '2026-11-21' } } })).toEqual([]);
  });

  test('more than 3 photos on one item is missing as that item\'s photos', () => {
    expect(missingFields(withNee(['4B'], 3))).toEqual([]);
    expect(missingFields(withNee(['4B'], 4))).toEqual(['answers.4B.photos']);
  });

  test('more than 15 photos in total marks the items past the limit', () => {
    expect(missingFields(withNee(['1A', '1B', '2A', '3A', '4B'], 3))).toEqual([]);
    expect(missingFields(withNee(NEE_IDS, 3))).toEqual(['answers.5A.photos']);
  });

  test('photos kept on an item that went back to Ja do not count', () => {
    const d = apply(withNee(NEE_IDS, 3), { type: 'answer', id: '1A', value: 'ja' });
    expect(missingFields(d)).toEqual([]);
  });

  test('whenever nothing is missing the shared schema accepts the submission', () => {
    for (const d of [withNee(['4B'], 3, '2026-11-20'), withNee(['1A', '1B', '2A', '3A', '4B'], 3)]) {
      expect(missingFields(d)).toEqual([]);
      expect(submissionSchema.safeParse(toSubmission(d)).success).toBe(true);
    }
  });
});

describe('notes on Ja and Nvt', () => {
  test('a note on ja or nvt goes out trimmed as the comment; an empty note is left out', () => {
    const d = apply(
      complete(),
      { type: 'note', id: '1B', text: '  Plan hangt bij de ingang.  ' },
      { type: 'answer', id: '9B', value: 'nvt' },
      { type: 'note', id: '9B', text: 'Kort klusje.' },
      { type: 'note', id: '2A', text: '   ' },
    );
    const sub = toSubmission(d);
    expect(sub.answers['1B']).toEqual({ answer: 'ja', comment: 'Plan hangt bij de ingang.' });
    expect(sub.answers['9B']).toEqual({ answer: 'nvt', comment: 'Kort klusje.' });
    expect(sub.answers['2A']).toEqual({ answer: 'ja' });
    expect(submissionSchema.safeParse(sub).success).toBe(true);
  });

  test('a note never makes the draft incomplete', () => {
    expect(missingFields(apply(complete(), { type: 'note', id: '1A', text: '' }))).toEqual([]);
  });

  test('caps a note at the comment limit', () => {
    const d = apply(complete(), { type: 'note', id: '1A', text: 'x'.repeat(1200) });
    expect(d.notes?.['1A']).toHaveLength(1000);
  });

  test('a note written before Nee becomes the Nee comment, but never overwrites one', () => {
    const base = newDraft('J. Jansen', 'P', 'P-1', START);
    const seeded = apply(base, { type: 'note', id: '3A', text: 'Ladder los' }, { type: 'answer', id: '3A', value: 'nee' });
    expect(seeded.nee['3A']).toEqual({ comment: 'Ladder los', actionBefore: '', photos: [] });

    const kept = apply(
      base,
      { type: 'answer', id: '3A', value: 'nee' },
      { type: 'neeDetails', id: '3A', details: { comment: 'Eerdere tekst' } },
      { type: 'answer', id: '3A', value: 'ja' },
      { type: 'note', id: '3A', text: 'Nieuwe notitie' },
      { type: 'answer', id: '3A', value: 'nee' },
    );
    expect(kept.nee['3A']?.comment).toBe('Eerdere tekst');
  });

  test('a note on an item that is Nee is not sent: the Nee comment is', () => {
    const d = apply(
      complete(),
      { type: 'note', id: '4B', text: 'Notitie' },
      { type: 'answer', id: '4B', value: 'nee' },
      { type: 'neeDetails', id: '4B', details: { comment: 'Sticker van 2023', actionBefore: '2099-01-01' } },
    );
    expect(toSubmission(d).answers['4B']).toEqual({
      answer: 'nee',
      comment: 'Sticker van 2023',
      actionBefore: '2099-01-01',
      photos: [],
    });
  });

  test('a draft saved before notes existed still works', () => {
    const old: Draft = { ...complete() };
    delete old.notes;
    expect(toSubmission(old).answers['1A']).toEqual({ answer: 'ja' });
    expect(apply(old, { type: 'note', id: '1A', text: 'x' }).notes).toEqual({ '1A': 'x' });
  });

  test('draftFromSubmission restores ja and nvt comments as notes', () => {
    const sub = toSubmission(
      apply(complete(), { type: 'answer', id: '9B', value: 'nvt' }, { type: 'note', id: '9B', text: 'Kort klusje.' }),
    );
    const back = draftFromSubmission(sub);
    expect(back.notes).toEqual({ '9B': 'Kort klusje.' });
    expect(toSubmission(signed(back)).answers['9B']).toEqual({ answer: 'nvt', comment: 'Kort klusje.' });
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
