// Shared builder for valid submissions in server tests. Example values only.
import { QUESTION_IDS, type QuestionId } from '../../src/shared/questions.js';
import type { Answer, Submission } from '../../src/shared/schema.js';

// 1×1 pixels in brand violet, generated with ImageMagick (`convert -size 1x1 xc:'#431961' -strip`).
export const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEVDGWF0E/aVAAAACklEQVQI12NgAAAAAgAB4iG8MwAAAABJRU5ErkJggg==';
export const JPEG_DATA_URL =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCegK5j/9k=';

export interface SubmissionOptions {
  /** Questions answered Nee; all others are Ja. */
  neeIds?: QuestionId[];
  /** JPEG photos attached to every Nee item (default 0). */
  photosPerNee?: number;
}

/** A submission that passes `submissionSchema`. `overrides` replace top-level fields last. */
export function makeSubmission(
  overrides: Partial<Submission> = {},
  opts: SubmissionOptions = {},
): Submission {
  const nee = new Set(opts.neeIds ?? []);
  const photoCount = opts.photosPerNee ?? 0;
  const answers = Object.fromEntries(
    QUESTION_IDS.map((id): [QuestionId, Answer] => [
      id,
      nee.has(id)
        ? {
            answer: 'nee',
            comment: `Probleem gevonden bij punt ${id}.`,
            actionBefore: '2026-11-27',
            photos: Array.from({ length: photoCount }, () => JPEG_DATA_URL),
          }
        : { answer: 'ja' },
    ]),
  ) as Record<QuestionId, Answer>;

  return {
    submissionId: '6f1c2a4e-8b3d-4c5e-9f7a-1b2c3d4e5f60',
    monteur: 'J. Jansen',
    project: 'Nieuwbouw Voorbeeld B.V.',
    projectnummer: 'P-2026-001',
    startedAt: '2026-11-20T09:15:00+01:00',
    signedAt: '2026-11-20T09:42:00+01:00',
    answers,
    goodPractice: 'De werkplek was netjes afgezet.',
    signature: PNG_DATA_URL,
    declaration: true,
    ...overrides,
  };
}
