import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Config } from '../../src/server/config.js';
import { buildMail, escapeHtml, type MailMessage } from '../../src/server/mail/build.js';
import { LOGO_CID, type MailLogo } from '../../src/server/mail/logo.js';
import { createMailer } from '../../src/server/mail/send.js';
import { pdfFileName } from '../../src/server/pdf/render.js';
import { QUESTIONS } from '../../src/shared/questions.js';
import { makeSubmission } from '../fixtures/submission.js';

const nodemailer = vi.hoisted(() => {
  const sendMail = vi.fn();
  const verify = vi.fn();
  const createTransport = vi.fn<(options: unknown) => { sendMail: typeof sendMail; verify: typeof verify }>(
    () => ({ sendMail, verify }),
  );
  return { sendMail, verify, createTransport };
});
vi.mock('nodemailer', () => ({
  createTransport: nodemailer.createTransport,
  default: { createTransport: nodemailer.createTransport },
}));

const SECRET = 'super-geheim-wachtwoord';

const CONFIG: Config = {
  port: 8080,
  publicOrigin: 'https://inspectie.example.com',
  trustProxy: [],
  mail: {
    to: 'vgm@example.com',
    from: 'Werkplekinspectie <inspectie@example.com>',
    smtp: { host: 'smtp.example.com', port: 465, secure: true, user: 'resend', pass: SECRET },
  },
  branding: {
    orgName: 'Voorbeeld B.V.',
    orgAddress: [],
    department: 'Customer Care',
    vgmName: '',
    iconBackground: '#FFFFFF',
  },
  rateLimit: { perIp: 5, window: 900_000, globalPerHour: 20 },
};

const PDF = Buffer.from('%PDF-1.7 test');
const LOGO: MailLogo = { png: Buffer.from('png-bytes'), width: 132, height: 44 };
const HOSTILE_PROJECT = '<b>X</b>\r\nBcc: a@b.c';

const appText = (id: string) => QUESTIONS.find((q) => q.id === id)!.appText;

describe('escapeHtml', () => {
  test('escapes & < > " and \'', () => {
    expect(escapeHtml(`a & b <c> "d" 'e'`)).toBe('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;');
  });

  test('escapes & first so entities are not double-decoded', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });
});

describe('buildMail', () => {
  test('takes to and from only from the config', () => {
    const msg = buildMail(
      makeSubmission({ project: 'Bouw attacker@evil.example.com', monteur: 'x@evil.example.com' }),
      PDF,
      CONFIG,
    );
    expect(msg.to).toBe('vgm@example.com');
    expect(msg.from).toBe('Werkplekinspectie <inspectie@example.com>');
  });

  test('builds the subject from project, projectnummer and the inspection date', () => {
    const msg = buildMail(makeSubmission(), PDF, CONFIG);
    expect(msg.subject).toBe('Werkplekinspectie – Nieuwbouw Voorbeeld B.V. (P-2026-001) – 20-11-2026');
  });

  test('dates the subject by startedAt in Europe/Amsterdam', () => {
    // 23:30 UTC on 19 November is 00:30 on 20 November in Amsterdam.
    const msg = buildMail(makeSubmission({ startedAt: '2026-11-19T23:30:00Z' }), PDF, CONFIG);
    expect(msg.subject).toMatch(/– 20-11-2026$/);
  });

  test('strips CR/LF from the subject', () => {
    const msg = buildMail(makeSubmission({ project: HOSTILE_PROJECT }), PDF, CONFIG);
    expect(msg.subject).not.toMatch(/[\r\n]/);
    expect(msg.subject).toBe('Werkplekinspectie – <b>X</b> Bcc: a@b.c (P-2026-001) – 20-11-2026');
  });

  test('caps the subject at 200 characters', () => {
    // Schema limits keep real subjects under 200; the cap is a backstop for anything longer.
    const msg = buildMail(makeSubmission({ project: 'P'.repeat(300) }), PDF, CONFIG);
    expect(msg.subject).toHaveLength(200);
    expect(msg.subject.startsWith('Werkplekinspectie – PPP')).toBe(true);
  });

  test('without a logo, only the PDF is attached, under pdfFileName', () => {
    const sub = makeSubmission();
    const msg = buildMail(sub, PDF, CONFIG);
    expect(msg.attachments).toEqual([
      { filename: pdfFileName(sub), content: PDF, contentType: 'application/pdf' },
    ]);
    expect(msg.html).not.toContain('<img');
  });

  test('with a logo, it is attached inline and shown at the top by cid, sized and named', () => {
    const sub = makeSubmission({}, { neeIds: ['1A'] });
    const msg = buildMail(sub, PDF, { ...CONFIG, branding: { ...CONFIG.branding, orgName: 'Bouw & Zn' } }, LOGO);
    expect(msg.attachments).toEqual([
      { filename: pdfFileName(sub), content: PDF, contentType: 'application/pdf' },
      { filename: 'logo.png', content: LOGO.png, contentType: 'image/png', cid: LOGO_CID, contentDisposition: 'inline' },
    ]);
    expect(msg.html).toContain(`<img src="cid:${LOGO_CID}" width="132" height="44" alt="Bouw &amp; Zn"`);
    expect(msg.html.indexOf('<img')).toBeLessThan(msg.html.indexOf('<h1'));
  });

  test('shows only the basics, in text and HTML: project, projectnummer, monteur, date and result', () => {
    const msg = buildMail(makeSubmission({}, { neeIds: ['2A', '7B'] }), PDF, CONFIG);
    expect(msg.text).toBe(
      [
        'Werkplekinspectie',
        'Nieuwbouw Voorbeeld B.V.',
        '',
        'Projectnummer: P-2026-001',
        'Monteur: J. Jansen',
        'Datum: 20-11-2026',
        'Resultaat: 2 punten niet in orde',
        '',
        'De volledige inspectie staat in de bijlage (PDF).',
        '',
      ].join('\n'),
    );
    for (const text of ['Nieuwbouw Voorbeeld B.V.', 'P-2026-001', 'J. Jansen', '20-11-2026', '2 punten niet in orde', 'in de bijlage (PDF)']) {
      expect(msg.html).toContain(text);
    }
  });

  test.each([
    [[], 'Alles in orde'],
    [['3A'], '1 punt niet in orde'],
    [['1A', '3A', '9B'], '3 punten niet in orde'],
  ] as const)('result for Nee on %j: %s', (neeIds, wording) => {
    const msg = buildMail(makeSubmission({}, { neeIds: [...neeIds] }), PDF, CONFIG);
    expect(msg.text).toContain(`Resultaat: ${wording}`);
    expect(msg.html).toContain(`>${wording}</td>`);
  });

  test('the result is dark red only when something is not in order', () => {
    const value = (html: string) => /color:(#[0-9A-F]{6})">[^<]*in orde<\/td>/.exec(html)?.[1];
    expect(value(buildMail(makeSubmission({}, { neeIds: ['1A'] }), PDF, CONFIG).html)).toBe('#A61B12');
    expect(value(buildMail(makeSubmission(), PDF, CONFIG).html)).toBe('#26193C');
  });

  test('leaves answers, comments, photos and "Wat gaat hier goed" to the PDF', () => {
    const base = makeSubmission({}, { neeIds: ['3A'], photosPerNee: 2 });
    const sub = {
      ...base,
      goodPractice: 'Toolbox elke ochtend',
      answers: { ...base.answers, '1B': { answer: 'ja', comment: 'Plan hangt bij de ingang.' } },
    } satisfies typeof base;
    const msg = buildMail(sub, PDF, CONFIG);
    for (const body of [msg.text, msg.html]) {
      expect(body).not.toContain('Probleem gevonden bij punt 3A.');
      expect(body).not.toContain(appText('3A'));
      expect(body).not.toContain('Plan hangt bij de ingang.');
      expect(body).not.toContain('Toolbox elke ochtend');
      expect(body).not.toContain('foto');
      expect(body).not.toContain('× Ja');
      expect(body).not.toContain('Opgelost vóór');
    }
  });

  test('escapes a hostile project name in the HTML', () => {
    const msg = buildMail(makeSubmission({ project: HOSTILE_PROJECT }), PDF, CONFIG);
    expect(msg.html).toContain('&lt;b&gt;X&lt;/b&gt;');
    expect(msg.html).not.toContain('<b>X</b>');
  });

  test('escapes monteur and projectnummer in the HTML', () => {
    const msg = buildMail(makeSubmission({ monteur: `O'Neil & "Zn"`, projectnummer: '<1>' }), PDF, CONFIG);
    expect(msg.html).toContain('O&#39;Neil &amp; &quot;Zn&quot;');
    expect(msg.html).toContain('&lt;1&gt;');
  });

  test('HTML uses the app colours and tables only, so Outlook keeps the layout', () => {
    const msg = buildMail(makeSubmission({}, { neeIds: ['1A'] }), PDF, CONFIG, LOGO);
    expect(msg.html).toContain('#FFF1E8');
    expect(msg.html).toContain('#C44400');
    expect(msg.html).toContain('role="presentation"');
    expect(msg.html).not.toMatch(/display:\s*(flex|grid)/);
  });

  test('HTML is a Dutch document that loads nothing from outside: the only image is the cid: logo', () => {
    const msg = buildMail(makeSubmission({}, { neeIds: ['1A'] }), PDF, CONFIG, LOGO);
    expect(msg.html).toMatch(/<html lang="nl">/);
    expect(msg.html).not.toMatch(/<link|<script|href=|url\(|https?:/i);
    expect([...msg.html.matchAll(/src="([^"]*)"/g)].map((m) => m[1])).toEqual([`cid:${LOGO_CID}`]);
  });
});

describe('createMailer', () => {
  const msg: MailMessage = buildMail(makeSubmission(), PDF, CONFIG);

  beforeEach(() => {
    nodemailer.createTransport.mockClear();
    nodemailer.sendMail.mockReset();
    nodemailer.verify.mockReset();
  });

  function transportOptions(): Record<string, unknown> {
    expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);
    return nodemailer.createTransport.mock.calls[0]![0] as Record<string, unknown>;
  }

  test('creates an SMTP transport with TLS 1.2 minimum and certificate checks on', () => {
    createMailer(CONFIG.mail);
    const options = transportOptions();
    expect(options).toEqual({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      auth: { user: 'resend', pass: SECRET },
      requireTLS: false,
      tls: { minVersion: 'TLSv1.2' },
    });
    expect(JSON.stringify(options)).not.toContain('rejectUnauthorized');
  });

  test('requires STARTTLS when the connection is not implicitly secure', () => {
    createMailer({ ...CONFIG.mail, smtp: { ...CONFIG.mail.smtp, port: 587, secure: false } });
    const options = transportOptions();
    expect(options).toMatchObject({ port: 587, secure: false, requireTLS: true });
    expect(options.tls).toEqual({ minVersion: 'TLSv1.2' });
  });

  test('send passes the built message to sendMail', async () => {
    nodemailer.sendMail.mockResolvedValue({ messageId: 'x' });
    await createMailer(CONFIG.mail).send(msg);
    expect(nodemailer.sendMail).toHaveBeenCalledTimes(1);
    expect(nodemailer.sendMail.mock.calls[0]![0]).toMatchObject({
      from: msg.from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      attachments: msg.attachments,
    });
  });

  test('send rethrows a generic error that does not echo credentials', async () => {
    nodemailer.sendMail.mockRejectedValue(
      Object.assign(new Error(`Invalid login resend:${SECRET}`), { code: 'EAUTH' }),
    );
    const err: unknown = await createMailer(CONFIG.mail)
      .send(msg)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    const e = err as Error;
    expect(e.message).not.toContain(SECRET);
    expect(e.message).toBe('Mail versturen mislukt (EAUTH)');
    expect(e.cause).toBeUndefined();
    expect(String(e.stack)).not.toContain(SECRET);
  });

  test('send leaves out an error code that is not a plain code', async () => {
    nodemailer.sendMail.mockRejectedValue(
      Object.assign(new Error('failed'), { code: `x; pass=${SECRET}` }),
    );
    const err: unknown = await createMailer(CONFIG.mail)
      .send(msg)
      .catch((e: unknown) => e);
    expect((err as Error).message).toBe('Mail versturen mislukt');
  });

  test('verify returns true when the server accepts the connection', async () => {
    nodemailer.verify.mockResolvedValue(true);
    await expect(createMailer(CONFIG.mail).verify()).resolves.toBe(true);
  });

  test('verify returns false instead of throwing', async () => {
    nodemailer.verify.mockRejectedValue(new Error(`connect failed ${SECRET}`));
    await expect(createMailer(CONFIG.mail).verify()).resolves.toBe(false);
  });
});
