// Composes the notification mail: fixed sender and recipient from config, a sanitised subject,
// the basics (project, who, when, result) in plain text and HTML, the logo inline and the PDF
// attached. Everything else is in the PDF.
import type { Config } from '../config.js';
import { LOGO_CID, type MailLogo } from './logo.js';
import { pdfFileName } from '../pdf/render.js';
import { formatDate } from '../../shared/dates.js';
import { FORM_TITLE, QUESTIONS } from '../../shared/questions.js';
import type { Submission } from '../../shared/schema.js';

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: 'application/pdf' | 'image/png';
  /** Set for the logo: the HTML shows it as `cid:…`, it is not a separate download. */
  cid?: string;
  contentDisposition?: 'inline';
}

export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments: MailAttachment[];
}

const SUBJECT_MAX = 200;
const FORM_LABEL = 'Werkplekinspectie';
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

/** "Alles in orde", "1 punt niet in orde", "3 punten niet in orde". */
function result(nee: number): string {
  if (nee === 0) return 'Alles in orde';
  return nee === 1 ? '1 punt niet in orde' : `${nee} punten niet in orde`;
}

interface Summary {
  project: string;
  /** Label and value, in the order the mail shows them. */
  facts: [label: string, value: string][];
  nee: number;
}

/**
 * Only the basics: where, who, when and whether anything is wrong. Answers, comments, photos
 * and "Wat gaat hier goed" are in the PDF.
 */
function summarise(sub: Submission): Summary {
  const nee = QUESTIONS.filter((q) => sub.answers[q.id].answer === 'nee').length;
  return {
    project: sub.project,
    facts: [
      ['Projectnummer', sub.projectnummer],
      ['Monteur', sub.monteur],
      ['Datum', formatDate(sub.startedAt)],
      ['Resultaat', result(nee)],
    ],
    nee,
  };
}

function renderText(s: Summary): string {
  const lines = [FORM_LABEL, s.project, '', ...s.facts.map(([label, value]) => `${label}: ${value}`), '', ATTACHMENT_NOTE];
  return `${lines.join('\n')}\n`;
}

// The app's theme (src/client/styles.css), rebuilt for mail clients: tables and inline styles
// only, so Outlook's Word renderer keeps the layout. Rounded corners simply drop out there.
// No web font and no remote images: the logo travels inside the mail (cid:).
const C = {
  ink: '#26193C',
  // Orange as text is the darker brand-d; the light tint is brand-l.
  brand: '#C44400',
  tint: '#FFF1E8',
  coralD: '#A61B12',
  grey: '#E5E5E5',
  sub: '#5F5670',
} as const;
const FONT = `'Nunito','Segoe UI',Roboto,Helvetica,Arial,sans-serif`;
const BOX = 'border-collapse:separate;mso-table-lspace:0;mso-table-rspace:0';
const S = {
  body: `margin:0;padding:0;background:${C.tint};-webkit-text-size-adjust:100%`,
  outer: `padding:24px 12px;background:${C.tint}`,
  card: `max-width:560px;width:100%;background:#ffffff;border:2px solid ${C.grey};border-bottom-width:5px;border-radius:22px`,
  inner: `padding:28px 24px;font-family:${FONT};color:${C.ink};font-size:16px;line-height:1.4;text-align:center`,
  logo: 'display:block;margin:0 auto 22px;border:0;outline:none;text-decoration:none',
  eyebrow: `margin:0;font-size:14px;font-weight:800;color:${C.brand}`,
  h1: `margin:6px 0 18px;font-size:26px;line-height:1.15;font-weight:900;color:${C.ink}`,
  label: `padding:3px 14px 3px 0;font-size:16px;font-weight:700;color:${C.sub};text-align:left;vertical-align:top;white-space:nowrap`,
  value: `padding:3px 0;font-size:16px;font-weight:800;text-align:left;vertical-align:top`,
  divider: `border-top:2px solid ${C.grey};font-size:0;line-height:0`,
  note: `margin:0;font-size:14px;font-weight:700;color:${C.sub}`,
  preheader: 'display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px',
} as const;

function renderHtml(s: Summary, cfg: Config, logo: MailLogo | undefined): string {
  const e = escapeHtml;
  const facts = s.facts
    .map(([label, value]) => {
      // The result is red only when something is wrong: the one thing to notice at a glance.
      const color = label === 'Resultaat' && s.nee > 0 ? C.coralD : C.ink;
      return `<tr><td style="${S.label}">${e(label)}</td><td style="${S.value};color:${color}">${e(value)}</td></tr>`;
    })
    .join('');
  const logoImg = logo
    ? `<img src="cid:${LOGO_CID}" width="${logo.width}" height="${logo.height}" alt="${e(cfg.branding.orgName)}" ` +
      `style="${S.logo};width:${logo.width}px;height:${logo.height}px">`
    : '';
  const preheader = `${s.project} · ${result(s.nee)}`;
  return (
    `<!doctype html><html lang="nl"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">` +
    `<title>${FORM_TITLE}</title></head>` +
    `<body style="${S.body}">` +
    `<div style="${S.preheader}">${e(preheader)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${BOX};background:${C.tint}">` +
    `<tr><td align="center" style="${S.outer}">` +
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="${BOX};${S.card}">` +
    `<tr><td align="center" style="${S.inner}">` +
    logoImg +
    `<p style="${S.eyebrow}">${FORM_LABEL}</p>` +
    `<h1 style="${S.h1}">${e(s.project)}</h1>` +
    `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="${BOX};margin:0 auto">${facts}</table>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${BOX};margin:22px 0 14px">` +
    `<tr><td height="1" style="${S.divider}">&nbsp;</td></tr></table>` +
    `<p style="${S.note}">${ATTACHMENT_NOTE}</p>` +
    `</td></tr></table>` +
    `</td></tr></table>` +
    `</body></html>`
  );
}

/**
 * Builds the mail for one inspection. Only the subject carries user input into a header.
 * With a logo, it is attached inline and shown at the top.
 */
export function buildMail(sub: Submission, pdf: Buffer, cfg: Config, logo?: MailLogo): MailMessage {
  const summary = summarise(sub);
  const attachments: MailAttachment[] = [
    { filename: pdfFileName(sub), content: pdf, contentType: 'application/pdf' },
  ];
  if (logo) {
    attachments.push({
      filename: 'logo.png',
      content: logo.png,
      contentType: 'image/png',
      cid: LOGO_CID,
      contentDisposition: 'inline',
    });
  }
  return {
    from: cfg.mail.from,
    to: cfg.mail.to,
    subject: subjectLine(
      `Werkplekinspectie – ${sub.project} (${sub.projectnummer}) – ${formatDate(sub.startedAt)}`,
    ),
    text: renderText(summary),
    html: renderHtml(summary, cfg, logo),
    attachments,
  };
}
