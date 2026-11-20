// Page geometry and the table engine for the inspection PDF: column widths, row
// measuring, page breaks with a repeated header, and splitting rows that are
// taller than a whole page. render.ts decides what goes where.
import type PDFDocument from 'pdfkit';

export type Doc = typeof PDFDocument;

/** A4 landscape, in points. */
export const PAGE = { width: 841.89, height: 595.28 } as const;

const MARGIN = 28;
const FOOTER_ZONE = 40;

/** The area page content may use; the footer lives below `bottom`. */
export const CONTENT = {
  left: MARGIN,
  top: MARGIN,
  right: PAGE.width - MARGIN,
  bottom: PAGE.height - FOOTER_ZONE,
  width: PAGE.width - 2 * MARGIN,
} as const;

/** Top of the footer text. */
export const FOOTER_TOP = PAGE.height - 26;

export const COLORS = {
  ink: '#26193C',
  sub: '#5F5670',
  line: '#8A8494',
  headerFill: '#E5E5E5',
  sectionFill: '#EFE9F7',
  neeFill: '#FDECEB',
} as const;

export const FONT = { regular: 'Helvetica', bold: 'Helvetica-Bold' } as const;
export const SIZE = { title: 16, body: 9, cell: 8, small: 7.5, heading: 12 } as const;

const PAD = 3;
const LINE_GAP = 1;
/** Never start splitting a too-tall row with less room than this. */
const MIN_SPLIT_SPACE = 40;

const OTHER_COLUMNS = [24, 24, 24, 235, 80, 66, 72, 60];
/** Omschrijving, Ja, Nee, Nvt, Commentaar, Vastgesteld door, Actie vóór, Actie uitgevoerd door, Uitgevoerd. */
export const MAIN_COLUMNS: readonly number[] = [
  CONTENT.width - OTHER_COLUMNS.reduce((a, b) => a + b, 0),
  ...OTHER_COLUMNS,
];

// Helvetica is a standard PDF font with WinAnsi encoding: Latin-1 plus these.
const WIN_ANSI_EXTRA = new Set(
  [...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ\u2010\u2011\u202F'].map((c) => c.codePointAt(0)),
);

/** Control, zero-width and variation-selector code points: dropped without a trace. */
const isIgnored = (cp: number) =>
  (cp < 0x20 && cp !== 0x0a) ||
  (cp >= 0x7f && cp <= 0x9f) ||
  (cp >= 0x200b && cp <= 0x200f) ||
  cp === 0x2060 ||
  (cp >= 0xfe00 && cp <= 0xfe0f);

const isDrawable = (cp: number) =>
  cp === 0x0a || (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WIN_ANSI_EXTRA.has(cp);

/**
 * Makes text drawable in Helvetica. pdfkit would print garbage for characters
 * outside WinAnsi (emoji, CJK), so each run of them becomes one "?".
 */
export function pdfSafe(text: string): string {
  let out = '';
  let inUnsupported = false;
  for (const ch of text.replace(/\r\n?/g, '\n').replace(/\t/g, ' ')) {
    const cp = ch.codePointAt(0)!;
    if (isIgnored(cp)) continue;
    if (isDrawable(cp)) {
      out += ch;
      inUnsupported = false;
    } else if (!inUnsupported) {
      out += '?';
      inUnsupported = true;
    }
  }
  return out;
}

export interface TextStyle {
  size?: number;
  bold?: boolean;
  color?: string;
  align?: 'left' | 'center' | 'right';
}

function applyStyle(doc: Doc, style: TextStyle): void {
  doc
    .font(style.bold ? FONT.bold : FONT.regular)
    .fontSize(style.size ?? SIZE.body)
    .fillColor(style.color ?? COLORS.ink);
}

/** Height of `text` wrapped to `width`; 0 for empty text. */
export function textHeight(doc: Doc, text: string, width: number, style: TextStyle = {}): number {
  const safe = pdfSafe(text);
  if (safe === '') return 0;
  applyStyle(doc, style);
  return doc.heightOfString(safe, { width, lineGap: LINE_GAP });
}

/** Draws `text` wrapped to `width` with its top-left at (x, y); returns its height. */
export function writeText(
  doc: Doc,
  text: string,
  x: number,
  y: number,
  width: number,
  style: TextStyle = {},
): number {
  const safe = pdfSafe(text);
  if (safe === '') return 0;
  applyStyle(doc, style);
  const height = doc.heightOfString(safe, { width, lineGap: LINE_GAP });
  doc.text(safe, x, y, { width, lineGap: LINE_GAP, align: style.align ?? 'left' });
  return height;
}

export interface Cell extends TextStyle {
  text?: string;
  /** Number of columns this cell covers (default 1). */
  span?: number;
}

export interface Row {
  cells: Cell[];
  fill?: string;
  minHeight?: number;
  /** First-cell text for the parts of this row that continue on a later page. */
  continuation?: string;
}

function cellWidths(widths: readonly number[], row: Row): number[] {
  let col = 0;
  return row.cells.map((cell) => {
    const span = cell.span ?? 1;
    const w = widths.slice(col, col + span).reduce((a, b) => a + b, 0);
    col += span;
    return w;
  });
}

const cellStyle = (cell: Cell): TextStyle => ({ size: SIZE.cell, ...cell });

/** Height a row needs so that every cell's wrapped text fits. */
export function measureRow(doc: Doc, widths: readonly number[], row: Row): number {
  const inner = cellWidths(widths, row).map((w, i) => {
    const cell = row.cells[i]!;
    return textHeight(doc, cell.text ?? '', w - 2 * PAD, cellStyle(cell));
  });
  return Math.max(row.minHeight ?? 0, Math.max(0, ...inner) + 2 * PAD);
}

/** Draws a row with its top at `y`, all cells `height` tall. */
export function drawRow(
  doc: Doc,
  x: number,
  widths: readonly number[],
  row: Row,
  y: number,
  height: number,
): void {
  let cx = x;
  cellWidths(widths, row).forEach((w, i) => {
    const cell = row.cells[i]!;
    if (row.fill) doc.rect(cx, y, w, height).fill(row.fill);
    doc.lineWidth(0.5).strokeColor(COLORS.line).rect(cx, y, w, height).stroke();
    writeText(doc, cell.text ?? '', cx + PAD, y + PAD, w - 2 * PAD, cellStyle(cell));
    cx += w;
  });
}

/**
 * Splits `text` so the head fits in `maxHeight` when wrapped to `width`,
 * preferring a break at whitespace. The tail starts after that whitespace.
 */
function splitText(doc: Doc, text: string, width: number, maxHeight: number, style: TextStyle) {
  const fits = (n: number) => textHeight(doc, text.slice(0, n), width, style) <= maxHeight;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid - 1;
  }
  let cut = lo;
  if (cut < text.length) {
    const ws = Math.max(text.lastIndexOf(' ', cut), text.lastIndexOf('\n', cut));
    if (ws > 0) cut = ws;
  }
  return { head: text.slice(0, cut).trimEnd(), tail: text.slice(cut).replace(/^[ \n]+/, '') };
}

/** Splits a row into a part that fits in `maxHeight` and the remainder. */
export function splitRow(doc: Doc, widths: readonly number[], row: Row, maxHeight: number) {
  const widthsPerCell = cellWidths(widths, row);
  const head: Cell[] = [];
  const tail: Cell[] = [];
  row.cells.forEach((cell, i) => {
    const text = pdfSafe(cell.text ?? '');
    const parts = splitText(doc, text, widthsPerCell[i]! - 2 * PAD, maxHeight - 2 * PAD, cellStyle(cell));
    head.push({ ...cell, text: parts.head });
    tail.push({ ...cell, text: parts.tail });
  });
  if (row.continuation !== undefined && tail[0]?.text === '') {
    tail[0] = { ...tail[0], text: row.continuation };
  }
  const base = { fill: row.fill, continuation: row.continuation };
  return { head: { ...base, cells: head }, tail: { ...base, cells: tail } };
}

/** Tracks the vertical cursor and starts new pages. */
export class Flow {
  y: number = CONTENT.top;

  constructor(private readonly doc: Doc) {}

  get space(): number {
    return CONTENT.bottom - this.y;
  }

  newPage(): void {
    this.doc.addPage();
    this.y = CONTENT.top;
  }

  /** Starts a new page unless `height` still fits on this one. */
  ensureSpace(height: number): void {
    if (height > this.space) this.newPage();
  }
}

/** A table that repeats its header rows on every page it continues onto. */
export class Table {
  private readonly headerHeights: number[];

  constructor(
    private readonly doc: Doc,
    private readonly flow: Flow,
    private readonly widths: readonly number[],
    private readonly header: readonly Row[],
  ) {
    this.headerHeights = header.map((r) => measureRow(doc, widths, r));
  }

  private get headerHeight(): number {
    return this.headerHeights.reduce((a, b) => a + b, 0);
  }

  /** Room for body rows on a page that holds nothing but the header. */
  private get freshSpace(): number {
    return CONTENT.bottom - CONTENT.top - this.headerHeight;
  }

  /** Draws the header, moving to a new page if it plus `firstRowHeight` does not fit. */
  start(firstRowHeight = 0): void {
    this.flow.ensureSpace(this.headerHeight + Math.min(firstRowHeight, this.freshSpace));
    this.drawHeader();
  }

  measure(row: Row): number {
    return measureRow(this.doc, this.widths, row);
  }

  /**
   * Adds a body row. `keepWithNext` is the height of the following row that
   * should land on the same page (used for section headings).
   */
  add(row: Row, keepWithNext = 0): void {
    let current = row;
    for (;;) {
      const height = this.measure(current);
      const need = height + keepWithNext <= this.freshSpace ? height + keepWithNext : height;
      if (need <= this.flow.space) {
        this.draw(current, height);
        return;
      }
      if (height <= this.freshSpace || this.flow.space < MIN_SPLIT_SPACE) {
        this.pageBreak();
        continue;
      }
      // Taller than any page: fill what is left here and continue on the next.
      const { head, tail } = splitRow(this.doc, this.widths, current, this.flow.space);
      if (head.cells.every((c) => c.text === '')) {
        throw new Error('Rij past niet op een pagina');
      }
      this.draw(head, this.measure(head));
      this.pageBreak();
      current = tail;
    }
  }

  private draw(row: Row, height: number): void {
    drawRow(this.doc, CONTENT.left, this.widths, row, this.flow.y, height);
    this.flow.y += height;
  }

  private drawHeader(): void {
    this.header.forEach((row, i) => this.draw(row, this.headerHeights[i]!));
  }

  private pageBreak(): void {
    this.flow.newPage();
    this.drawHeader();
  }
}
