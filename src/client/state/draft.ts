// The in-progress inspection on the phone and the pure functions that change it.
import { QUESTION_IDS, type QuestionId } from '@shared/questions';
import type { Answer, Submission } from '@shared/schema';

export type AnswerValue = 'ja' | 'nee' | 'nvt';

export interface NeeDetails {
  comment: string;
  /** YYYY-MM-DD, '' until picked. */
  actionBefore: string;
  /** data URLs (JPEG or PNG) */
  photos: string[];
}

export interface Draft {
  /** Becomes the submissionId: stable across retries. */
  id: string;
  monteur: string;
  project: string;
  projectnummer: string;
  /** ISO-8601 with the device's offset. */
  startedAt: string;
  /** ISO-8601 with the device's offset. */
  updatedAt: string;
  answers: Partial<Record<QuestionId, AnswerValue>>;
  /** Kept when an answer goes back to Ja/Nvt, so switching back to Nee restores them. */
  nee: Partial<Record<QuestionId, NeeDetails>>;
  goodPractice: string;
  signature?: string;
  signedAt?: string;
  declaration: boolean;
  /** Honeypot, bound to a hidden input. */
  website: string;
}

export type DraftAction =
  | { type: 'answer'; id: QuestionId; value: AnswerValue }
  | { type: 'neeDetails'; id: QuestionId; details: Partial<NeeDetails> }
  | { type: 'goodPractice'; text: string }
  | { type: 'sign'; signature: string; at: string }
  | { type: 'declare'; value: boolean }
  | { type: 'header'; monteur?: string; project?: string; projectnummer?: string }
  | { type: 'honeypot'; value: string };

/** Thrown by toSubmission; `missing` holds dotted paths such as `answers.4B.comment`. */
export class IncompleteDraftError extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    super(`Inspectie is niet compleet: ${missing.join(', ')}`);
    this.name = 'IncompleteDraftError';
    this.missing = missing;
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `2026-11-20T09:12:00+01:00`: local wall-clock time plus the device's UTC offset. */
export function toIsoWithOffset(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

export function newDraft(monteur: string, project: string, projectnummer: string, now: Date): Draft {
  const at = toIsoWithOffset(now);
  return {
    id: crypto.randomUUID(),
    monteur,
    project,
    projectnummer,
    startedAt: at,
    updatedAt: at,
    answers: {},
    nee: {},
    goodPractice: '',
    declaration: false,
    website: '',
  };
}

const EMPTY_NEE: NeeDetails = { comment: '', actionBefore: '', photos: [] };

function apply(d: Draft, a: DraftAction): Draft {
  switch (a.type) {
    case 'answer':
      return { ...d, answers: { ...d.answers, [a.id]: a.value } };
    case 'neeDetails':
      return { ...d, nee: { ...d.nee, [a.id]: { ...EMPTY_NEE, ...d.nee[a.id], ...a.details } } };
    case 'goodPractice':
      return { ...d, goodPractice: a.text };
    case 'sign':
      return { ...d, signature: a.signature, signedAt: a.at };
    case 'declare':
      return { ...d, declaration: a.value };
    case 'header':
      return {
        ...d,
        monteur: a.monteur ?? d.monteur,
        project: a.project ?? d.project,
        projectnummer: a.projectnummer ?? d.projectnummer,
      };
    case 'honeypot':
      return { ...d, website: a.value };
  }
}

/** Pure apart from stamping `updatedAt` with the current time. */
export function draftReducer(d: Draft, a: DraftAction): Draft {
  return { ...apply(d, a), updatedAt: toIsoWithOffset(new Date()) };
}

const blank = (s: string | undefined) => !s || s.trim().length === 0;

/** Everything still needed before the draft can be sent, as dotted paths. Empty when complete. */
export function missingFields(d: Draft): string[] {
  const missing: string[] = [];
  if (blank(d.monteur)) missing.push('monteur');
  if (blank(d.project)) missing.push('project');
  if (blank(d.projectnummer)) missing.push('projectnummer');
  for (const id of QUESTION_IDS) {
    const answer = d.answers[id];
    if (!answer) {
      missing.push(`answers.${id}`);
    } else if (answer === 'nee') {
      const details = d.nee[id];
      if (blank(details?.comment)) missing.push(`answers.${id}.comment`);
      if (blank(details?.actionBefore)) missing.push(`answers.${id}.actionBefore`);
    }
  }
  if (blank(d.signature) || blank(d.signedAt)) missing.push('signature');
  if (d.declaration !== true) missing.push('declaration');
  return missing;
}

function toAnswer(d: Draft, id: QuestionId): Answer {
  const value = d.answers[id];
  if (value === 'ja' || value === 'nvt') return { answer: value };
  const details = { ...EMPTY_NEE, ...d.nee[id] };
  return {
    answer: 'nee',
    comment: details.comment.trim(),
    actionBefore: details.actionBefore,
    photos: [...details.photos],
  };
}

/** The payload for POST /api/submit. Throws IncompleteDraftError when anything is missing. */
export function toSubmission(d: Draft): Submission {
  const missing = missingFields(d);
  if (missing.length > 0) throw new IncompleteDraftError(missing);
  return {
    submissionId: d.id,
    monteur: d.monteur.trim(),
    project: d.project.trim(),
    projectnummer: d.projectnummer.trim(),
    startedAt: d.startedAt,
    signedAt: d.signedAt ?? '',
    answers: Object.fromEntries(QUESTION_IDS.map((id) => [id, toAnswer(d, id)])) as Record<
      QuestionId,
      Answer
    >,
    goodPractice: d.goodPractice,
    signature: d.signature ?? '',
    declaration: true,
    website: d.website,
  };
}

export function nextUnanswered(d: Draft): QuestionId | null {
  return QUESTION_IDS.find((id) => !d.answers[id]) ?? null;
}

export function counts(d: Draft): { ja: number; nee: number; nvt: number } {
  const c = { ja: 0, nee: 0, nvt: 0 };
  for (const id of QUESTION_IDS) {
    const value = d.answers[id];
    if (value) c[value] += 1;
  }
  return c;
}
