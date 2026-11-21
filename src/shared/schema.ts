// Submission shape shared by client and server. Checks shapes and sizes only;
// magic-byte checks on photos and signature happen on the server.
import { z } from 'zod';
import { amsterdamDateKey } from './dates.js';
import { QUESTION_IDS, type QuestionId } from './questions.js';

/** Every text field: at most 250 characters, on the phone and on the server. */
const TEXT_MAX = 250;

export const LIMITS = {
  monteur: TEXT_MAX,
  project: TEXT_MAX,
  projectnummer: TEXT_MAX,
  comment: TEXT_MAX,
  goodPractice: TEXT_MAX,
  photosPerItem: 3,
  photosTotal: 15,
  photoBytes: 1_500_000,
  signatureBytes: 300_000,
  bodyBytes: 12_000_000,
} as const;

export type Answer =
  // Ja and Nvt may carry an optional comment; Nee always has one.
  | { answer: 'ja'; comment?: string }
  | { answer: 'nvt'; comment?: string }
  | {
      answer: 'nee';
      comment: string;
      /** YYYY-MM-DD */
      actionBefore: string;
      /** JPEG data URLs (the phone always compresses to JPEG). */
      photos: string[];
    };

export interface Submission {
  /** UUID, stable across retries. */
  submissionId: string;
  monteur: string;
  project: string;
  projectnummer: string;
  /** ISO-8601 datetime with offset. */
  startedAt: string;
  /** ISO-8601 datetime with offset. */
  signedAt: string;
  answers: Record<QuestionId, Answer>;
  goodPractice: string;
  /** data:image/png;base64,… */
  signature: string;
  declaration: true;
  /** Honeypot. The server decides what to do when it is filled. */
  website?: string;
}

const HONEYPOT_MAX = 200;
const BASE64_BODY = /^[A-Za-z0-9+/]+={0,2}$/;

/** A base64 data URL with one of the given prefixes and at most `maxBytes` decoded bytes. */
function dataUrl(prefixes: readonly string[], maxBytes: number) {
  const maxBase64 = Math.ceil((maxBytes * 4) / 3);
  return z.string().refine(
    (s) => {
      const prefix = prefixes.find((p) => s.startsWith(p));
      if (prefix === undefined) return false;
      const body = s.slice(prefix.length);
      return body.length > 0 && body.length <= maxBase64 && BASE64_BODY.test(body);
    },
    { message: `Moet een ${prefixes.join(' of ')} data-URL zijn van maximaal ${maxBytes} bytes` },
  );
}

/** Text that must contain at least one non-space character. */
function requiredText(max: number) {
  return z
    .string()
    .max(max)
    .refine((s) => s.trim().length > 0, { message: 'Mag niet leeg zijn' });
}

// JPEG only: pdfkit embeds JPEG as is, while a PNG's pixel data is inflated in full.
const photo = dataUrl(['data:image/jpeg;base64,'], LIMITS.photoBytes);
const signature = dataUrl(['data:image/png;base64,'], LIMITS.signatureBytes);

const answerSchema = z.discriminatedUnion('answer', [
  z.strictObject({ answer: z.literal('ja'), comment: z.string().max(LIMITS.comment).optional() }),
  z.strictObject({ answer: z.literal('nvt'), comment: z.string().max(LIMITS.comment).optional() }),
  z.strictObject({
    answer: z.literal('nee'),
    comment: requiredText(LIMITS.comment),
    actionBefore: z.iso.date(),
    photos: z.array(photo).max(LIMITS.photosPerItem),
  }),
]);

const answersSchema = z.strictObject(
  Object.fromEntries(QUESTION_IDS.map((id) => [id, answerSchema])) as Record<
    QuestionId,
    typeof answerSchema
  >,
);

export const submissionSchema: z.ZodType<Submission> = z
  .strictObject({
    submissionId: z.uuid(),
    monteur: requiredText(LIMITS.monteur),
    project: requiredText(LIMITS.project),
    projectnummer: requiredText(LIMITS.projectnummer),
    startedAt: z.iso.datetime({ offset: true }),
    signedAt: z.iso.datetime({ offset: true }),
    answers: answersSchema,
    goodPractice: z.string().max(LIMITS.goodPractice),
    signature,
    declaration: z.literal(true),
    website: z.string().max(HONEYPOT_MAX).optional(),
  })
  .superRefine((s, ctx) => {
    const entries = QUESTION_IDS.map((id) => [id, s.answers[id]] as const);

    const totalPhotos = entries.reduce(
      (n, [, a]) => n + (a.answer === 'nee' ? a.photos.length : 0),
      0,
    );
    if (totalPhotos > LIMITS.photosTotal) {
      ctx.addIssue({
        code: 'custom',
        path: ['answers'],
        message: `Maximaal ${LIMITS.photosTotal} foto's in totaal`,
      });
    }

    // "Not in the past" is measured against the inspection day (startedAt in
    // Europe/Amsterdam), not the server clock, so outbox sends days later still pass.
    // Zod still runs this refinement after format issues, so startedAt may be malformed here.
    const started = new Date(s.startedAt);
    if (Number.isNaN(started.getTime())) return;
    const inspectionDay = amsterdamDateKey(s.startedAt);
    for (const [id, a] of entries) {
      if (a.answer === 'nee' && a.actionBefore < inspectionDay) {
        ctx.addIssue({
          code: 'custom',
          path: ['answers', id, 'actionBefore'],
          message: 'Datum mag niet voor de inspectiedatum liggen',
        });
      }
    }
  });
