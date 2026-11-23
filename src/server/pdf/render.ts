// Turns a validated submission into the landscape A4 PDF that mirrors the paper
// "Werkplekinspectie Arbo en Milieu" form. All dates come from the submission.
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import type { Config } from '../config.js';
import { decodeDataUrl } from '../images.js';
import { amsterdamParts, formatDateTime, formatDay } from '../../shared/dates.js';
import { FORM_TITLE, QUESTIONS, SECTIONS, type Question } from '../../shared/questions.js';
import type { Answer, Submission } from '../../shared/schema.js';
import {
  COLORS,
  CONTENT,
  FOOTER_TOP,
  Flow,
  MAIN_COLUMNS,
  SIZE,
  Table,
  drawRow,
  measureRow,
  registerFonts,
  textHeight,
  writeText,
  type Doc,
  type Row,
} from './layout.js';

const GOOD_PRACTICE = 'Wat gaat hier goed en waar kan de rest van het bedrijf iets van leren?';
const PROJECT_MAX = 60;

/** `Werkplekinspectie {YYYY}-{project}-{YYYY-MM-DD}.pdf`, dated by startedAt in Europe/Amsterdam. */
export function pdfFileName(sub: Submission): string {
  const p = amsterdamParts(sub.startedAt);
  const project = sub.project
    .replace(/\s+/g, ' ')
    .replace(/[^A-Za-z0-9 _-]/g, '')
    .replace(/ +/g, ' ')
    .trim()
    .slice(0, PROJECT_MAX)
    .trim();
  return `Werkplekinspectie ${p.year}-${project}-${p.year}-${p.month}-${p.day}.pdf`;
}

/** Renders the inspection PDF into a Buffer. Throws InvalidImageError on a bad photo or signature. */
export async function renderInspectionPdf(
  sub: Submission,
  branding: Config['branding'],
  logo?: Buffer,
  logoKind?: 'svg' | 'png',
): Promise<Buffer> {
  const doc: Doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: 0,
    bufferPages: true,
    info: { Title: FORM_TITLE, CreationDate: new Date(sub.signedAt) },
  });
  registerFonts(doc);
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const flow = new Flow(doc);
  drawHeader(doc, flow, sub, branding, logo, logoKind);
  drawSignatures(doc, flow, sub, branding);
  drawGoodPractice(doc, flow, sub);
  drawChecklist(doc, flow, sub);
  drawActionLine(doc, flow, sub);
  drawPhotos(doc, flow, sub);
  drawFooters(doc, sub);

  doc.end();
  return done;
}

function drawHeader(
  doc: Doc,
  flow: Flow,
  sub: Submission,
  branding: Config['branding'],
  logo: Buffer | undefined,
  logoKind: 'svg' | 'png' | undefined,
): void {
  const top = flow.y;
  const leftWidth = 470;
  let left = top + writeText(doc, FORM_TITLE, CONTENT.left, top, leftWidth, { size: SIZE.title, bold: true });
  left += 6;

  const widths = [90, leftWidth - 90];
  const fields: [string, string][] = [
    ['Origineel:', `Afdeling ${branding.department}`.trim()],
    ['Kopie:', 'VG functionaris'],
    ['Project:', sub.project],
    ['Projectnummer:', sub.projectnummer],
  ];
  for (const [label, value] of fields) {
    const row: Row = {
      cells: [
        { text: label, bold: true, size: SIZE.body },
        { text: value, size: SIZE.body },
      ],
      minHeight: 16,
    };
    const h = measureRow(doc, widths, row);
    drawRow(doc, CONTENT.left, widths, row, left, h);
    left += h;
  }

  // Logo and address block on the right, like the original.
  const rightWidth = 240;
  const rx = CONTENT.right - rightWidth;
  let right = top;
  if (logo && logoKind) {
    const box = { width: 170, height: 44 };
    if (logoKind === 'svg') {
      SVGtoPDF(doc, logo.toString('utf8'), rx, right, {
        ...box,
        preserveAspectRatio: 'xMinYMin meet',
      });
    } else {
      doc.image(logo, rx, right, { fit: [box.width, box.height] });
    }
    right += box.height + 6;
  }
  right += writeText(doc, branding.orgName, rx, right, rightWidth, { bold: true });
  for (const line of branding.orgAddress) {
    right += writeText(doc, line, rx, right, rightWidth, { size: SIZE.cell, color: COLORS.sub });
  }

  flow.y = Math.max(left, right) + 10;
}

function drawSignatures(doc: Doc, flow: Flow, sub: Submission, branding: Config['branding']): void {
  const top = flow.y;
  const pad = 5;
  const boxWidth = CONTENT.width / 4;
  const inner = boxWidth - 2 * pad;
  const label = { size: SIZE.cell, bold: true };
  const small = { size: SIZE.cell, color: COLORS.sub };
  const x = (i: number) => CONTENT.left + i * boxWidth + pad;
  const bottoms: number[] = [];

  // 1. Inspectie uitgevoerd door
  let y = top + pad;
  y += writeText(doc, 'Inspectie uitgevoerd door:', x(0), y, inner, label) + 2;
  y += writeText(doc, sub.monteur, x(0), y, inner) + 4;
  y += writeText(doc, `datum + tijd: ${formatDateTime(sub.startedAt)}`, x(0), y, inner, small);
  bottoms.push(y);

  // 2. Handtekening monteur
  y = top + pad;
  y += writeText(doc, 'Handtekening monteur:', x(1), y, inner, label) + 2;
  const signature = decodeDataUrl(sub.signature);
  const sigHeight = 38;
  doc.image(signature.data, x(1), y, { fit: [inner, sigHeight], align: 'center', valign: 'center' });
  y += sigHeight + 4;
  y += writeText(doc, `datum + tijd: ${formatDateTime(sub.signedAt)}`, x(1), y, inner, small);
  bottoms.push(y);

  // 3. Handtekening VGM functionaris: laid out like the monteur's box, signed on paper later
  y = top + pad;
  y += writeText(doc, `Handtekening VGM functionaris: ${branding.vgmName}`.trim(), x(2), y, inner, label) + 2;
  y += sigHeight + 4;
  y += writeText(doc, 'datum + tijd:', x(2), y, inner, small);
  bottoms.push(y);

  // 4. Afmelding, left empty
  y = top + pad;
  y += writeText(doc, 'Afmelding:', x(3), y, inner, label) + 6;
  for (const field of ['gezien d.d.:', 'paraaf:']) {
    const h = writeText(doc, field, x(3), y, inner, small);
    doc
      .lineWidth(0.5)
      .strokeColor(COLORS.line)
      .moveTo(x(3) + 50, y + h - 2)
      .lineTo(x(3) + inner, y + h - 2)
      .stroke();
    y += h + 10;
  }
  bottoms.push(y);

  const height = Math.max(...bottoms) - top + pad;
  for (let i = 0; i < 4; i++) {
    doc.lineWidth(0.5).strokeColor(COLORS.line).rect(CONTENT.left + i * boxWidth, top, boxWidth, height).stroke();
  }
  flow.y = top + height + 10;
}

function drawGoodPractice(doc: Doc, flow: Flow, sub: Submission): void {
  const header: Row = { cells: [{ text: GOOD_PRACTICE, bold: true, size: SIZE.body }], fill: COLORS.headerFill };
  const body: Row = { cells: [{ text: sub.goodPractice, size: SIZE.body }], minHeight: 30 };
  const table = new Table(doc, flow, [CONTENT.width], [header]);
  table.start(table.measure(body));
  table.add(body);
  flow.y += 10;
}

const X = { text: 'X', bold: true, align: 'center' } as const;

function questionRow(q: Question, answer: Answer, monteur: string): Row {
  const description = `${q.id.slice(1)} - ${q.formText}`;
  const cells = [
    { text: description },
    answer.answer === 'ja' ? X : {},
    answer.answer === 'nee' ? X : {},
    answer.answer === 'nvt' ? X : {},
  ];
  if (answer.answer !== 'nee') {
    const comment = answer.comment ?? '';
    return {
      ...(comment === '' ? {} : { continuation: `${description} (vervolg)` }),
      cells: [...cells, comment === '' ? {} : { text: comment }, {}, {}, {}, {}],
    };
  }
  return {
    fill: COLORS.neeFill,
    continuation: `${description} (vervolg)`,
    cells: [...cells, { text: answer.comment }, { text: monteur }, { text: formatDay(answer.actionBefore) }, {}, {}],
  };
}

function drawChecklist(doc: Doc, flow: Flow, sub: Submission): void {
  const head = { bold: true, size: SIZE.small } as const;
  const header: Row[] = [
    {
      fill: COLORS.headerFill,
      cells: [
        {},
        { ...head, text: 'In orde', span: 3, align: 'center' },
        { ...head, text: 'Constatering / Opmerkingen tekortkoming', span: 2, align: 'center' },
        { ...head, text: 'Afhandeling tekortkoming', span: 3, align: 'center' },
      ],
    },
    {
      fill: COLORS.headerFill,
      cells: [
        { ...head, text: 'Omschrijving van controlepunten' },
        { ...head, text: 'Ja', align: 'center' },
        { ...head, text: 'Nee', align: 'center' },
        { ...head, text: 'Nvt', align: 'center' },
        { ...head, text: 'Commentaar' },
        { ...head, text: 'Vastgesteld door:' },
        { ...head, text: 'Actie vóór (datum)' },
        { ...head, text: 'Actie uitgevoerd door:' },
        { ...head, text: 'Uitgevoerd (datum)' },
      ],
    },
  ];
  const table = new Table(doc, flow, MAIN_COLUMNS, header);

  SECTIONS.forEach((section, i) => {
    const rows = QUESTIONS.filter((q) => q.section === section.nr).map((q) =>
      questionRow(q, sub.answers[q.id], sub.monteur),
    );
    const heading: Row = {
      fill: COLORS.sectionFill,
      cells: [{ text: `${section.nr}) ${section.formTitle}`, bold: true, span: MAIN_COLUMNS.length }],
    };
    const firstHeight = rows[0] ? table.measure(rows[0]) : 0;
    if (i === 0) table.start(table.measure(heading) + firstHeight);
    table.add(heading, firstHeight);
    for (const row of rows) table.add(row);
  });
  flow.y += 10;
}

function drawActionLine(doc: Doc, flow: Flow, sub: Submission): void {
  const ids = QUESTIONS.filter((q) => sub.answers[q.id].answer === 'nee').map((q) => q.id);
  const text = `Te nemen actie op punt: ${ids.length > 0 ? ids.join(', ') : 'geen'}`;
  const style = { bold: true };
  flow.ensureSpace(textHeight(doc, text, CONTENT.width, style));
  flow.y += writeText(doc, text, CONTENT.left, flow.y, CONTENT.width, style);
}

function drawPhotos(doc: Doc, flow: Flow, sub: Submission): void {
  const photos = [
    ...QUESTIONS.flatMap((q) => {
      const a = sub.answers[q.id];
      return a.answer === 'nee' ? a.photos.map((url) => ({ caption: `${q.id} - ${q.formText}`, url })) : [];
    }),
    ...(sub.goodPracticePhotos ?? []).map((url) => ({ caption: GOOD_PRACTICE, url })),
  ];
  const gap = 20;
  const slotWidth = (CONTENT.width - gap) / 2;

  for (let i = 0; i < photos.length; i += 2) {
    flow.newPage();
    const top = flow.y;
    const titleHeight = writeText(doc, 'Fotobijlage', CONTENT.left, top, CONTENT.width, {
      size: SIZE.heading,
      bold: true,
    });
    const pair = photos.slice(i, i + 2);
    const captionHeight = Math.max(
      ...pair.map((p) => textHeight(doc, p.caption, slotWidth, { bold: true })),
    );
    const boxTop = top + titleHeight + 8;
    const boxHeight = CONTENT.bottom - boxTop - captionHeight - 6;

    pair.forEach((p, slot) => {
      const x = CONTENT.left + slot * (slotWidth + gap);
      const image = decodeDataUrl(p.url);
      doc.image(image.data, x, boxTop, {
        fit: [slotWidth, boxHeight],
        align: 'center',
        valign: 'center',
      });
      doc.lineWidth(0.5).strokeColor(COLORS.line).rect(x, boxTop, slotWidth, boxHeight).stroke();
      writeText(doc, p.caption, x, boxTop + boxHeight + 6, slotWidth, { bold: true });
    });
    flow.y = CONTENT.bottom;
  }
}

function drawFooters(doc: Doc, sub: Submission): void {
  const { start, count } = doc.bufferedPageRange();
  const style = { size: SIZE.small, color: COLORS.sub };
  const signed = `Digitaal ingevuld en ondertekend via de Werkplekinspectie-app op ${formatDateTime(sub.signedAt)}`;
  for (let i = start; i < start + count; i++) {
    doc.switchToPage(i);
    doc
      .lineWidth(0.5)
      .strokeColor(COLORS.line)
      .moveTo(CONTENT.left, FOOTER_TOP - 5)
      .lineTo(CONTENT.right, FOOTER_TOP - 5)
      .stroke();
    writeText(doc, 'Internal', CONTENT.left, FOOTER_TOP, 100, style);
    writeText(doc, signed, CONTENT.left + 110, FOOTER_TOP, CONTENT.width - 220, { ...style, align: 'center' });
    writeText(doc, `Blad ${i + 1}`, CONTENT.right - 100, FOOTER_TOP, 100, { ...style, align: 'right' });
  }
}
