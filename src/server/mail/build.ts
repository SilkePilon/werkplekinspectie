// Composes the notification mail: fixed sender and recipient from config, a
// sanitised subject, a short summary (plain text and HTML) and the PDF attached.
import type { Config } from '../config.js';
import { pdfFileName } from '../pdf/render.js';
import { formatDate, formatDay } from '../../shared/dates.js';
import { FORM_TITLE, QUESTIONS } from '../../shared/questions.js';
import type { Submission } from '../../shared/schema.js';

export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments: { filename: string; content: Buffer; contentType: 'application/pdf' }[];
}

const SUBJECT_MAX = 200;
const NO_NEE = 'Geen Nee-punten.';
const ATTACHMENT_NOTE = 'De volledige inspectie staat in de bijlage (PDF).';

/** Escapes text for use in HTML element content and attribute values. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** One line, at most SUBJECT_MAX characters (code points, so no split surrogate pairs). */
function subjectLine(s: string): string {
  return Array.from(s.replace(/[\r\n]+/g, ' '))
    .slice(0, SUBJECT_MAX)
    .join('');
}

interface Summary {
  project: string;
  projectnummer: string;
  date: string;
  counts: { ja: number; nee: number; nvt: number };
  facts: [label: string, value: string][];
  nee: { heading: string; comment: string; due: string; photos: string }[];
  /** Comments on Ja/Nvt answers, in question order. */
  notes: { heading: string; answer: string; comment: string }[];
  goodPractice: string;
}

function photoCount(n: number): string {
  if (n === 0) return '';
  return n === 1 ? '1 foto' : `${n} foto's`;
}

function summarise(sub: Submission): Summary {
  const answers = QUESTIONS.map((q) => ({ q, a: sub.answers[q.id] }));
  const count = (kind: 'ja' | 'nee' | 'nvt') => answers.filter(({ a }) => a.answer === kind).length;
  const counts = { ja: count('ja'), nee: count('nee'), nvt: count('nvt') };
  const date = formatDate(sub.startedAt);
  return {
    project: sub.project,
    projectnummer: sub.projectnummer,
    date,
    counts,
    facts: [
      ['Monteur', sub.monteur],
      ['Project', `${sub.project} (${sub.projectnummer})`],
      ['Datum', date],
      ['Resultaat', `${counts.ja} × Ja, ${counts.nee} × Nee, ${counts.nvt} × Nvt`],
    ],
    nee: answers.flatMap(({ q, a }) =>
      a.answer === 'nee'
        ? [
            {
              heading: `${q.id} ${q.appText}`,
              comment: a.comment,
              due: `Opgelost vóór ${formatDay(a.actionBefore)}`,
              photos: photoCount(a.photos.length),
            },
          ]
        : [],
    ),
    notes: answers.flatMap(({ q, a }) => {
      if (a.answer === 'nee') return [];
      const comment = (a.comment ?? '').trim();
      return comment === ''
        ? []
        : [{ heading: `${q.id} ${q.appText}`, answer: a.answer === 'ja' ? 'Ja' : 'Nvt', comment }];
    }),
    goodPractice: sub.goodPractice.trim(),
  };
}

function renderText(s: Summary): string {
  const lines = [FORM_TITLE, '', ...s.facts.map(([label, value]) => `${label}: ${value}`), '', 'Nee-punten:'];
  if (s.nee.length === 0) lines.push(NO_NEE);
  for (const item of s.nee) {
    lines.push('', item.heading, item.comment, item.photos === '' ? item.due : `${item.due} (${item.photos})`);
  }
  if (s.notes.length > 0) {
    lines.push('', 'Opmerkingen:');
    for (const note of s.notes) lines.push('', `${note.heading} (${note.answer})`, note.comment);
  }
  if (s.goodPractice !== '') lines.push('', 'Wat gaat hier goed:', s.goodPractice);
  lines.push('', ATTACHMENT_NOTE);
  return `${lines.join('\n')}\n`;
}

// The app's theme (src/client/styles.css), rebuilt for mail clients: tables and inline styles
// only, so Outlook's Word renderer keeps the layout. Rounded corners simply drop out there.
// No web font and no images: nothing is fetched when the mail is opened.
const C = {
  ink: '#26193C',
  violet: '#431961',
  lila: '#EFE9F7',
  coral: '#F34842',
  coralD: '#C42B24',
  roze: '#FDECEB',
  grey: '#E5E5E5',
  sub: '#5F5670',
} as const;
const FONT = `'Nunito','Segoe UI',Roboto,Helvetica,Arial,sans-serif`;
const BOX = 'border-collapse:separate;mso-table-lspace:0;mso-table-rspace:0';
const CARD = `border:2px solid ${C.grey};border-bottom-width:5px;border-radius:16px;padding:12px 14px`;
const S = {
  body: `margin:0;padding:0;background:${C.lila};-webkit-text-size-adjust:100%`,
  outer: `padding:24px 12px;background:${C.lila}`,
  sheet: `max-width:560px;width:100%;background:#ffffff;border:2px solid ${C.grey};border-bottom-width:5px;border-radius:22px`,
  inner: `padding:24px 22px;font-family:${FONT};color:${C.ink};font-size:16px;line-height:1.4`,
  eyebrow: `margin:0;font-size:14px;font-weight:800;color:${C.violet}`,
  h1: `margin:6px 0 2px;font-size:26px;line-height:1.15;font-weight:900;color:${C.ink}`,
  meta: `margin:0;font-size:15px;font-weight:700;color:${C.sub}`,
  chip: `border:2px solid ${C.grey};border-radius:99px;padding:4px 12px;font-size:14px;font-weight:800;color:${C.ink};white-space:nowrap`,
  chipNee: `border:2px solid ${C.coral};border-radius:99px;padding:4px 12px;font-size:14px;font-weight:800;color:${C.coralD};background:${C.roze};white-space:nowrap`,
  section: `margin:22px 2px 8px;font-size:15px;font-weight:900;color:${C.sub}`,
  card: `${CARD};background:#ffffff`,
  label: `padding:3px 12px 3px 0;font-size:15px;font-weight:700;color:${C.sub};vertical-align:top;white-space:nowrap`,
  value: `padding:3px 0;font-size:16px;font-weight:800;color:${C.ink};vertical-align:top`,
  nee: `border:2px solid ${C.coral};border-bottom-width:5px;border-radius:16px;padding:12px 14px;background:${C.roze}`,
  neeTitle: `margin:0;font-size:17px;line-height:1.25;font-weight:900;color:${C.ink}`,
  neeComment: `margin:4px 0 0;font-size:15px;font-weight:700;color:${C.ink};white-space:pre-wrap`,
  neeDue: `margin:8px 0 0;font-size:14px;font-weight:800;color:${C.coralD}`,
  ok: `border-radius:16px;padding:12px 14px;background:${C.lila};font-size:16px;font-weight:800;color:${C.violet}`,
  noteTitle: `margin:0;font-size:16px;line-height:1.25;font-weight:900;color:${C.ink}`,
  noteAnswer: `font-size:14px;font-weight:800;color:${C.sub}`,
  noteComment: `margin:4px 0 0;font-size:15px;font-weight:700;color:${C.ink};white-space:pre-wrap`,
  good: `margin:0;font-size:15px;font-weight:700;color:${C.ink};white-space:pre-wrap`,
  note: `border-radius:14px;padding:12px 14px;background:${C.lila};font-size:15px;font-weight:700;color:${C.violet}`,
  preheader: 'display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px',
} as const;

/** A one-cell table with the given style: the box model every mail client agrees on. */
function box(style: string, content: string, gapAfter = 10): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${BOX};margin:0 0 ${gapAfter}px">` +
    `<tr><td style="${style}">${content}</td></tr></table>`
  );
}

function renderHtml(s: Summary): string {
  const e = escapeHtml;
  const chips = [
    { text: `${s.counts.ja} × Ja`, style: S.chip },
    { text: `${s.counts.nee} × Nee`, style: s.counts.nee > 0 ? S.chipNee : S.chip },
    { text: `${s.counts.nvt} × Nvt`, style: S.chip },
  ]
    .map((c) => `<td style="padding:0 8px 0 0"><span style="${c.style};display:inline-block">${e(c.text)}</span></td>`)
    .join('');
  const facts = s.facts
    .filter(([label]) => label !== 'Resultaat')
    .map(([label, value]) => `<tr><td style="${S.label}">${e(label)}</td><td style="${S.value}">${e(value)}</td></tr>`)
    .join('');
  const nee =
    s.nee.length === 0
      ? box(S.ok, `Alles in orde. ${NO_NEE}`)
      : s.nee
          .map((item) =>
            box(
              S.nee,
              `<p style="${S.neeTitle}">${e(item.heading)}</p>` +
                (item.comment === '' ? '' : `<p style="${S.neeComment}">${e(item.comment)}</p>`) +
                `<p style="${S.neeDue}">${e(item.photos === '' ? item.due : `${item.due} · ${item.photos}`)}</p>`,
            ),
          )
          .join('');
  const notes =
    s.notes.length === 0
      ? ''
      : `<p style="${S.section}">Opmerkingen</p>` +
        s.notes
          .map((note) =>
            box(
              S.card,
              `<p style="${S.noteTitle}">${e(note.heading)} <span style="${S.noteAnswer}">· ${e(note.answer)}</span></p>` +
                `<p style="${S.noteComment}">${e(note.comment)}</p>`,
            ),
          )
          .join('');
  const good =
    s.goodPractice === ''
      ? ''
      : `<p style="${S.section}">Wat gaat hier goed</p>` + box(S.card, `<p style="${S.good}">${e(s.goodPractice)}</p>`);
  const preheader = `${s.project} · ${s.counts.nee === 0 ? 'geen Nee-punten' : `${s.counts.nee} × Nee`}`;
  const resultaat = s.facts.find(([label]) => label === 'Resultaat')![1];
  return (
    `<!doctype html><html lang="nl"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">` +
    `<title>${FORM_TITLE}</title></head>` +
    `<body style="${S.body}">` +
    `<div style="${S.preheader}">${e(preheader)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${BOX};background:${C.lila}">` +
    `<tr><td align="center" style="${S.outer}">` +
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="${BOX};${S.sheet}">` +
    `<tr><td style="${S.inner}">` +
    `<p style="${S.eyebrow}">${FORM_TITLE}</p>` +
    `<h1 style="${S.h1}">${e(s.project)}</h1>` +
    `<p style="${S.meta}">${e(s.projectnummer)} · ${e(s.date)}</p>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="${BOX};margin:16px 0 0" aria-label="${e(resultaat)}">` +
    `<tr>${chips}</tr></table>` +
    `<p style="${S.section}">Gegevens</p>` +
    box(S.card, `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="${BOX}">${facts}</table>`) +
    `<p style="${S.section}">${s.nee.length === 0 ? 'Nee-punten' : 'Niet in orde'}</p>` +
    nee +
    notes +
    good +
    `<div style="height:12px;line-height:12px;font-size:12px">&nbsp;</div>` +
    box(S.note, ATTACHMENT_NOTE, 0) +
    `</td></tr></table>` +
    `</td></tr></table>` +
    `</body></html>`
  );
}

/** Builds the mail for one inspection. Only the subject carries user input into a header. */
export function buildMail(sub: Submission, pdf: Buffer, cfg: Config): MailMessage {
  const summary = summarise(sub);
  return {
    from: cfg.mail.from,
    to: cfg.mail.to,
    subject: subjectLine(
      `Werkplekinspectie – ${sub.project} (${sub.projectnummer}) – ${formatDate(sub.startedAt)}`,
    ),
    text: renderText(summary),
    html: renderHtml(summary),
    attachments: [{ filename: pdfFileName(sub), content: pdf, contentType: 'application/pdf' }],
  };
}
