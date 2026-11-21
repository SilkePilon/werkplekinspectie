import { extractText, extractTextItems, getMeta } from 'unpdf';
import { describe, expect, test } from 'vitest';
import { PAGE, CONTENT } from '../../src/server/pdf/layout.js';
import { pdfFileName, renderInspectionPdf } from '../../src/server/pdf/render.js';
import type { Config } from '../../src/server/config.js';
import { QUESTIONS, SECTIONS, type QuestionId } from '../../src/shared/questions.js';
import { submissionSchema, type Answer } from '../../src/shared/schema.js';
import { PNG_DATA_URL, makeSubmission } from '../fixtures/submission.js';

const BRANDING: Config['branding'] = {
  orgName: 'Voorbeeld B.V.',
  orgAddress: ['Voorbeeldstraat 1', '1234 AB Voorbeeld', 'www.example.com'],
  department: 'Customer Care',
  vgmName: 'M. Jansen',
};
const EMPTY_BRANDING: Config['branding'] = {
  orgName: '',
  orgAddress: [],
  department: '',
  vgmName: '',
};

const FOOTER_LINE = 'Digitaal ingevuld en ondertekend via de Werkplekinspectie-app op 20-11-2026 09:42';

/** Wrapped text gets line breaks in the extraction, so compare without any whitespace. */
const squash = (s: string) => s.replace(/\s+/g, '');

async function pagesOf(pdf: Buffer): Promise<string[]> {
  return (await extractText(new Uint8Array(pdf))).text;
}

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

/** A 1000-character comment whose last 20 characters are unique to `id`. */
function longComment(id: string): string {
  const tail = ` EINDE-${id}-xyzw-klaar`.slice(-20);
  const body = 'De ladder staat los en moet worden vastgezet door de beheerder. ';
  return body.repeat(20).slice(0, 1000 - tail.length) + tail;
}

describe('renderInspectionPdf', () => {
  test('contains the title, every original form text, section titles and the monteur', async () => {
    const pdf = await renderInspectionPdf(makeSubmission(), BRANDING);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const all = squash((await pagesOf(pdf)).join('\n'));

    expect(all).toContain(squash('Werkplekinspectie Arbo en Milieu'));
    for (const q of QUESTIONS) expect(all).toContain(squash(q.formText));
    for (const s of SECTIONS) expect(all).toContain(squash(`${s.nr}) ${s.formTitle}`));
    expect(all).toContain(squash('Persoonlijke hygiëne'));
    expect(all).toContain('J.Jansen');
  });

  test('prints header, address block, signature block and good-practice text', async () => {
    const pdf = await renderInspectionPdf(
      makeSubmission({ startedAt: '2026-11-20T08:15:00Z', signedAt: '2026-11-20T08:42:00.000Z' }),
      BRANDING,
    );
    const [first = ''] = await pagesOf(pdf);
    const page1 = squash(first);
    for (const text of [
      'Origineel: Afdeling Customer Care',
      'Kopie: VG functionaris',
      'Reg:',
      'Project:',
      'Nieuwbouw Voorbeeld B.V.',
      'Projectnummer:',
      'P-2026-001',
      'Voorbeeldstraat 1',
      '1234 AB Voorbeeld',
      'www.example.com',
      'Inspectie uitgevoerd door:',
      '20-11-2026 09:15',
      'Handtekening monteur:',
      '20-11-2026 09:42',
      'VGM functionaris: M. Jansen',
      'Afmelding:',
      'Wat gaat hier goed en waar kan de rest van het bedrijf iets van leren?',
      'De werkplek was netjes afgezet.',
    ]) {
      expect(page1).toContain(squash(text));
    }
  });

  test('every page has the footer with Internal, Blad n and the signing time in Amsterdam', async () => {
    const pdf = await renderInspectionPdf(
      makeSubmission({ signedAt: '2026-11-20T08:42:00Z' }, { neeIds: ['3A'], photosPerNee: 1 }),
      BRANDING,
    );
    const pages = await pagesOf(pdf);
    expect(pages.length).toBeGreaterThanOrEqual(3);
    pages.forEach((page, i) => {
      const text = squash(page);
      expect(text).toContain('Internal');
      expect(text).toContain(squash(`Blad ${i + 1}`));
      expect(text).toContain(squash(FOOTER_LINE));
    });
  });

  test('summer times are shown in CEST', async () => {
    const pdf = await renderInspectionPdf(
      makeSubmission({ startedAt: '2026-07-01T22:30:00Z', signedAt: '2026-07-01T22:59:00Z' }),
      BRANDING,
    );
    const all = squash((await pagesOf(pdf)).join('\n'));
    expect(all).toContain(squash('02-07-2026 00:30'));
    expect(all).toContain(squash('ondertekend via de Werkplekinspectie-app op 02-07-2026 00:59'));
  });

  test('lists the Nee items to act on', async () => {
    const pdf = await renderInspectionPdf(makeSubmission({}, { neeIds: ['3A', '4B'] }), BRANDING);
    const all = squash((await pagesOf(pdf)).join('\n'));
    expect(all).toContain(squash('Te nemen actie op punt: 3A, 4B'));
  });

  test('puts the X in the chosen column, and Nee details in their columns', async () => {
    const answers = makeSubmission().answers;
    const nee: Answer = { answer: 'nee', comment: 'Geen handboekje', actionBefore: '2026-12-01', photos: [] };
    const sub = makeSubmission({ answers: { ...answers, '1A': { answer: 'ja' }, '1B': nee, '1C': { answer: 'nvt' } } });
    const { items } = await extractTextItems(new Uint8Array(await renderInspectionPdf(sub, BRANDING)));
    const page1 = items[0] ?? [];
    const center = (it: { x: number; width: number }) => it.x + it.width / 2;
    const header = (label: string) => {
      const found = page1.find((it) => it.str === label);
      if (!found) throw new Error(`header ${label} not found`);
      return center(found);
    };
    const rowY = (formText: string) => {
      const found = page1.find((it) => it.str.includes(formText));
      if (!found) throw new Error(`row ${formText} not found`);
      return found.y;
    };
    const marksIn = (y: number) =>
      page1.filter((it) => it.str === 'X' && Math.abs(it.y - y) < 2).map(center);

    const expectMark = (id: QuestionId, column: string) => {
      const marks = marksIn(rowY(QUESTIONS.find((q) => q.id === id)!.formText.slice(0, 12)));
      expect(marks).toHaveLength(1);
      expect(Math.abs(marks[0]! - header(column))).toBeLessThan(4);
    };
    expectMark('1A', 'Ja');
    expectMark('1B', 'Nee');
    expectMark('1C', 'Nvt');

    const rowItems = page1.filter((it) => Math.abs(it.y - rowY('bekendheid met calamiteitenplan')) < 2);
    const strs = rowItems.map((it) => it.str);
    expect(strs).toContain('Geen handboekje');
    expect(strs).toContain('J. Jansen');
    expect(strs).toContain('01-12-2026');
    // "Vastgesteld door" stays empty on Ja/Nvt rows.
    const jaRow = page1.filter((it) => Math.abs(it.y - rowY('VGM-handboekje voorhanden')) < 2);
    expect(jaRow.map((it) => it.str)).not.toContain('J. Jansen');
  });

  test('prints a Ja or Nvt comment in Commentaar, with Vastgesteld door and dates left empty', async () => {
    const answers = makeSubmission().answers;
    const sub = makeSubmission({
      answers: {
        ...answers,
        '1A': { answer: 'ja', comment: 'Ligt in de bus' },
        '1C': { answer: 'nvt', comment: 'Eigen project' },
      },
    });
    const { items } = await extractTextItems(new Uint8Array(await renderInspectionPdf(sub, BRANDING)));
    const page1 = items[0] ?? [];
    const center = (it: { x: number; width: number }) => it.x + it.width / 2;
    const commentaar = page1.find((it) => it.str === 'Commentaar');
    const vastgesteld = page1.find((it) => it.str.startsWith('Vastgesteld'));
    if (!commentaar || !vastgesteld) throw new Error('headers not found');
    const rowOf = (formText: string) => {
      const y = page1.find((it) => it.str.includes(formText))!.y;
      return page1.filter((it) => Math.abs(it.y - y) < 2);
    };
    for (const [row, text] of [
      [rowOf('VGM-handboekje voorhanden'), 'Ligt in de bus'],
      [rowOf('veiligheidsinstructie opdrachtgever'), 'Eigen project'],
    ] as const) {
      const cell = row.find((it) => it.str === text);
      expect(cell).toBeDefined();
      // Left-aligned in the Commentaar column: starts left of the next column's header.
      expect(cell!.x).toBeLessThan(center(vastgesteld));
      expect(cell!.x + cell!.width).toBeGreaterThan(commentaar.x - 40);
      expect(row.map((it) => it.str)).not.toContain('J. Jansen');
    }
  });

  test('adds one photo page per two photos, captioned with id and form text', async () => {
    const withoutPhotos = await pagesOf(
      await renderInspectionPdf(makeSubmission({}, { neeIds: ['3A', '4B'] }), BRANDING),
    );
    const pages = await pagesOf(
      await renderInspectionPdf(makeSubmission({}, { neeIds: ['3A', '4B'], photosPerNee: 2 }), BRANDING),
    );
    expect(pages.length).toBeGreaterThanOrEqual(withoutPhotos.length + 2);
    expect(pages.length).toBe(withoutPhotos.length + 2);

    const photoPages = pages.slice(withoutPhotos.length).map(squash);
    expect(count(photoPages[0]!, squash('3A - staat van onderhoud'))).toBe(2);
    expect(count(photoPages[1]!, squash('4B - blusmiddelen gekeurd'))).toBe(2);
  });

  describe('very long text (Review Focus 5)', () => {
    const neeIds: QuestionId[] = ['1B', '4C', '9B'];

    async function renderLong(comments: Partial<Record<QuestionId, string>>) {
      const base = makeSubmission({}, { neeIds });
      const answers = { ...base.answers };
      for (const id of neeIds) {
        answers[id] = { answer: 'nee', comment: comments[id] ?? longComment(id), actionBefore: '2026-11-27', photos: [] };
      }
      const sub = { ...base, answers, project: 'P'.repeat(60) + ' Lang projectnaam '.repeat(4).slice(0, 59) + 'Z' };
      expect(sub.project).toHaveLength(120);
      return { sub, pdf: await renderInspectionPdf(sub, BRANDING) };
    }

    async function expectTableIntact(pdf: Buffer) {
      const pages = await pagesOf(pdf);
      expect(pages.length).toBeGreaterThan(1);
      const tablePages = pages.filter((p) => p.includes('Omschrijving'));
      expect(tablePages.length).toBeGreaterThan(1);
      for (const page of pages) expect(count(page, 'Omschrijving')).toBeLessThanOrEqual(1);

      // Nothing is drawn off the page or into the footer zone.
      const { items } = await extractTextItems(new Uint8Array(pdf));
      const footerTop = PAGE.height - CONTENT.bottom;
      for (const page of items) {
        for (const it of page) {
          if (it.str.trim() === '') continue;
          expect(it.x).toBeGreaterThanOrEqual(0);
          expect(it.x + it.width).toBeLessThanOrEqual(PAGE.width);
          const isFooter = it.y < footerTop;
          if (isFooter) {
            expect(it.str).toMatch(/^(Internal|Blad \d+|Digitaal ingevuld en ondertekend .*)$/);
          } else {
            expect(it.y).toBeLessThan(PAGE.height);
          }
        }
      }
      return pages;
    }

    test('three 1000-char comments and a 120-char project wrap, continue and are not clipped', async () => {
      const { sub, pdf } = await renderLong({});
      const pages = await expectTableIntact(pdf);
      const all = squash(pages.join('\n'));
      for (const id of neeIds) {
        const a = sub.answers[id];
        if (a.answer !== 'nee') throw new Error('expected nee');
        expect(a.comment).toHaveLength(1000);
        expect(all).toContain(squash(a.comment.slice(-20)));
      }
      expect(all).toContain(squash(sub.project));
    });

    test('a comment that is taller than a whole page is split over pages without losing text', async () => {
      const lines = Array.from({ length: 200 }, (_, i) => `regel ${i + 1}`).join('\n');
      const noSpaces = 'W'.repeat(980) + 'EINDEZONDERSPATIES1';
      const { pdf } = await renderLong({ '1B': lines.slice(0, 1000), '4C': noSpaces });
      const pages = await expectTableIntact(pdf);
      const all = squash(pages.join('\n'));
      const shownLines = lines.slice(0, 1000).split('\n');
      for (const line of shownLines) expect(all).toContain(squash(line));
      expect(all).toContain('EINDEZONDERSPATIES1');
      // Every line is printed exactly once: no duplicates at the page splits.
      expect(count(all, 'regel')).toBe(shownLines.length);
      // Continuation parts say which item they belong to.
      const continued = pages.filter((p) => squash(p).includes(squash('B - bekendheid met calamiteitenplan ter plaatse (vervolg)')));
      expect(continued.length).toBeGreaterThanOrEqual(1);
    });

    test('a long good-practice text with many line breaks still renders completely', async () => {
      const goodPractice = Array.from({ length: 400 }, (_, i) => `punt ${i + 1}`).join('\n').slice(0, 2000);
      const pdf = await renderInspectionPdf(makeSubmission({ goodPractice }), BRANDING);
      const pages = await expectTableIntact(pdf);
      const all = squash(pages.join('\n'));
      expect(all).toContain(squash(goodPractice.split('\n').at(-1)!));
    });
  });

  test('prints hostile text literally (Review Focus 4)', async () => {
    const base = makeSubmission({}, { neeIds: ['2A'] });
    const sub = {
      ...base,
      project: '<b>X</b>',
      answers: {
        ...base.answers,
        '2A': { answer: 'nee', comment: '<script>alert(1)</script> & "quotes"', actionBefore: '2026-11-27', photos: [] } as Answer,
      },
    };
    const all = (await pagesOf(await renderInspectionPdf(sub, BRANDING))).join('\n');
    expect(all).toContain('<b>X</b>');
    expect(all).toContain('<script>alert(1)</script> & "quotes"');
  });

  test('replaces characters the embedded font cannot draw (emoji, CJK) instead of printing garbage', async () => {
    const sub = makeSubmission({ project: 'Kabel 🔌 los — “ok” € ë 中' });
    const all = (await pagesOf(await renderInspectionPdf(sub, BRANDING))).join('\n');
    expect(all).toContain('Kabel ? los — “ok” € ë ?');
  });

  test('prints names and text outside Latin-1 intact, in regular and bold text', async () => {
    const sub = makeSubmission(
      { monteur: 'Łukasz Wiśniewski', project: 'Ștefan Güneş Őrs' },
      { neeIds: ['2A'] },
    );
    sub.answers['2A'] = { answer: 'nee', comment: 'Олег: ladder ťažká', actionBefore: '2026-11-27', photos: [] };
    const all = (await pagesOf(await renderInspectionPdf(sub, BRANDING))).join('\n');
    expect(all).toContain('Łukasz Wiśniewski');
    expect(all).toContain('Ștefan Güneş Őrs');
    expect(all).toContain('Олег: ladder ťažká');
  });

  test('embeds the fonts instead of using a standard PDF font', async () => {
    const pdf = (await renderInspectionPdf(makeSubmission(), BRANDING)).toString('latin1');
    expect(pdf).toMatch(/\/FontFile2/);
    expect(pdf).not.toMatch(/\/BaseFont\s*\/Helvetica/);
  });

  test('renders with empty branding, without a logo', async () => {
    const pages = await pagesOf(await renderInspectionPdf(makeSubmission(), EMPTY_BRANDING));
    expect(squash(pages[0]!)).toContain(squash('Werkplekinspectie Arbo en Milieu'));
  });

  test('renders an SVG or PNG logo', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="30"><rect width="120" height="30" fill="#431961"/></svg>',
    );
    const png = Buffer.from(PNG_DATA_URL.split(',')[1]!, 'base64');
    const plain = await renderInspectionPdf(makeSubmission(), BRANDING);
    const withSvg = await renderInspectionPdf(makeSubmission(), BRANDING, svg, 'svg');
    const withPng = await renderInspectionPdf(makeSubmission(), BRANDING, png, 'png');
    expect(withSvg.equals(plain)).toBe(false);
    expect(withPng.length).toBeGreaterThan(plain.length);
  });

  test('sets only the title as metadata and is deterministic', async () => {
    const sub = makeSubmission();
    const pdf = await renderInspectionPdf(sub, BRANDING);
    const { info } = await getMeta(new Uint8Array(pdf));
    expect(info.Title).toBe('Werkplekinspectie Arbo en Milieu');
    expect(info.Author).toBeUndefined();
    expect(info.Subject).toBeUndefined();
    expect(info.Keywords).toBeUndefined();
    expect((await renderInspectionPdf(sub, BRANDING)).equals(pdf)).toBe(true);
  });
});

describe('makeSubmission fixture', () => {
  test('builds valid submissions with Nee items and photos', () => {
    const sub = makeSubmission({}, { neeIds: ['3A', '4B'], photosPerNee: 3 });
    expect(submissionSchema.safeParse(sub).success).toBe(true);
    expect(sub.answers['3A']).toMatchObject({ answer: 'nee', photos: expect.any(Array) });
    expect(sub.answers['1A']).toEqual({ answer: 'ja' });
  });
});

describe('pdfFileName', () => {
  test('uses year, sanitised project and inspection date', () => {
    const sub = makeSubmission({ project: 'UMC / Utrecht', startedAt: '2026-11-20T09:15:00+01:00' });
    expect(pdfFileName(sub)).toBe('Werkplekinspectie 2026-UMC Utrecht-2026-11-20.pdf');
  });

  test('drops odd characters, collapses whitespace and caps the project at 60 characters', () => {
    const sub = makeSubmission({ project: '  <b>X</b>\r\nBcc: a@b.c  ', startedAt: '2026-11-20T09:15:00+01:00' });
    expect(pdfFileName(sub)).toBe('Werkplekinspectie 2026-bXb Bcc abc-2026-11-20.pdf');

    const long = makeSubmission({ project: 'a_b-c'.repeat(24) });
    expect(pdfFileName(long)).toBe(`Werkplekinspectie 2026-${'a_b-c'.repeat(12)}-2026-11-20.pdf`);

    // No space is left dangling where the cap cuts.
    const cutAtSpace = makeSubmission({ project: `${'x'.repeat(59)} yyy` });
    expect(pdfFileName(cutAtSpace)).toBe(`Werkplekinspectie 2026-${'x'.repeat(59)}-2026-11-20.pdf`);
  });

  test('takes year and date in Europe/Amsterdam', () => {
    const sub = makeSubmission({ project: 'Oud en nieuw', startedAt: '2026-12-31T23:30:00Z' });
    expect(pdfFileName(sub)).toBe('Werkplekinspectie 2027-Oud en nieuw-2027-01-01.pdf');
  });
});
