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
  facts: [label: string, value: string][];
  nee: { heading: string; comment: string; due: string }[];
}

function summarise(sub: Submission): Summary {
  const answers = QUESTIONS.map((q) => ({ q, a: sub.answers[q.id] }));
  const count = (kind: 'ja' | 'nee' | 'nvt') => answers.filter(({ a }) => a.answer === kind).length;
  return {
    facts: [
      ['Monteur', sub.monteur],
      ['Project', `${sub.project} (${sub.projectnummer})`],
      ['Datum', formatDate(sub.startedAt)],
      ['Resultaat', `${count('ja')} × Ja, ${count('nee')} × Nee, ${count('nvt')} × Nvt`],
    ],
    nee: answers.flatMap(({ q, a }) =>
      a.answer === 'nee'
        ? [
            {
              heading: `${q.id} ${q.appText}`,
              comment: a.comment,
              due: `Opgelost vóór ${formatDay(a.actionBefore)}`,
            },
          ]
        : [],
    ),
  };
}

function renderText(s: Summary): string {
  const lines = [FORM_TITLE, '', ...s.facts.map(([label, value]) => `${label}: ${value}`), '', 'Nee-punten:'];
  if (s.nee.length === 0) lines.push(NO_NEE);
  for (const item of s.nee) lines.push('', item.heading, item.comment, item.due);
  lines.push('', ATTACHMENT_NOTE);
  return `${lines.join('\n')}\n`;
}

const STYLE = {
  body: 'margin:0;padding:16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#26193C;background:#ffffff',
  h1: 'margin:0 0 12px;font-size:20px;color:#431961',
  h2: 'margin:20px 0 8px;font-size:17px;color:#431961',
  label: 'padding:2px 12px 2px 0;font-weight:bold;vertical-align:top',
  cell: 'padding:2px 0;vertical-align:top',
  item: 'margin:0 0 12px;padding:8px 12px;border-left:4px solid #F34842;background:#FDECEB',
  heading: 'margin:0;font-weight:bold',
  comment: 'margin:4px 0;white-space:pre-wrap',
  due: 'margin:0;color:#C42B24',
  note: 'margin:20px 0 0;color:#5F5670',
} as const;

function renderHtml(s: Summary): string {
  const e = escapeHtml;
  const facts = s.facts
    .map(
      ([label, value]) =>
        `<tr><td style="${STYLE.label}">${e(label)}:</td><td style="${STYLE.cell}">${e(value)}</td></tr>`,
    )
    .join('');
  const nee =
    s.nee.length === 0
      ? `<p style="${STYLE.cell}">${NO_NEE}</p>`
      : s.nee
          .map(
            (item) =>
              `<div style="${STYLE.item}">` +
              `<p style="${STYLE.heading}">${e(item.heading)}</p>` +
              `<p style="${STYLE.comment}">${e(item.comment)}</p>` +
              `<p style="${STYLE.due}">${e(item.due)}</p>` +
              `</div>`,
          )
          .join('');
  return (
    `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>${FORM_TITLE}</title></head>` +
    `<body style="${STYLE.body}">` +
    `<h1 style="${STYLE.h1}">${FORM_TITLE}</h1>` +
    `<table role="presentation" style="border-collapse:collapse">${facts}</table>` +
    `<h2 style="${STYLE.h2}">Nee-punten:</h2>${nee}` +
    `<p style="${STYLE.note}">${ATTACHMENT_NOTE}</p>` +
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
