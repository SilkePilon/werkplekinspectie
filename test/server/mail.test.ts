import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Config } from '../../src/server/config.js';
import { buildMail, escapeHtml, type MailMessage } from '../../src/server/mail/build.js';
import { createMailer } from '../../src/server/mail/send.js';
import { pdfFileName } from '../../src/server/pdf/render.js';
import { QUESTIONS } from '../../src/shared/questions.js';
import type { Answer } from '../../src/shared/schema.js';
import { JPEG_DATA_URL, makeSubmission } from '../fixtures/submission.js';

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

  test('attaches the PDF under pdfFileName', () => {
    const sub = makeSubmission();
    const msg = buildMail(sub, PDF, CONFIG);
    expect(msg.attachments).toEqual([
      { filename: pdfFileName(sub), content: PDF, contentType: 'application/pdf' },
    ]);
  });

  test('summarises monteur, project, date and counts in text and HTML', () => {
    const msg = buildMail(makeSubmission({}, { neeIds: ['2A', '7B'] }), PDF, CONFIG);
    for (const body of [msg.text, msg.html]) {
      expect(body).toContain('J. Jansen');
      expect(body).toContain('Nieuwbouw Voorbeeld B.V.');
      expect(body).toContain('P-2026-001');
      expect(body).toContain('20-11-2026');
      expect(body).toContain('19 × Ja, 2 × Nee, 0 × Nvt');
    }
  });

  test('counts Niet van toepassing as Nvt', () => {
    const base = makeSubmission({}, { neeIds: ['1A'] });
    const nvt: Answer = { answer: 'nvt' };
    const sub = { ...base, answers: { ...base.answers, '9A': nvt, '9B': nvt } };
    expect(buildMail(sub, PDF, CONFIG).text).toContain('18 × Ja, 1 × Nee, 2 × Nvt');
  });

  test('lists each Nee item with app text, comment and Opgelost vóór date', () => {
    const msg = buildMail(makeSubmission({}, { neeIds: ['2A', '7B'] }), PDF, CONFIG);
    for (const id of ['2A', '7B']) {
      expect(msg.text).toContain(`${id} ${appText(id)}`);
      expect(msg.text).toContain(`Probleem gevonden bij punt ${id}.`);
      expect(msg.html).toContain(escapeHtml(`${id} ${appText(id)}`));
      expect(msg.html).toContain(`Probleem gevonden bij punt ${id}.`);
    }
    for (const body of [msg.text, msg.html]) {
      expect(body.split('Opgelost vóór 27-11-2026')).toHaveLength(3);
    }
    expect(msg.text.indexOf('2A ')).toBeLessThan(msg.text.indexOf('7B '));
    expect(msg.text).not.toContain(`1A ${appText('1A')}`);
  });

  test('says so when there are no Nee items', () => {
    const msg = buildMail(makeSubmission(), PDF, CONFIG);
    expect(msg.text).toContain('21 × Ja, 0 × Nee, 0 × Nvt');
    expect(msg.text).toContain('Geen Nee-punten.');
    expect(msg.html).toContain('Geen Nee-punten.');
    expect(msg.text).not.toContain('Opgelost vóór');
  });

  test('escapes a hostile project name in the HTML', () => {
    const msg = buildMail(makeSubmission({ project: HOSTILE_PROJECT }), PDF, CONFIG);
    expect(msg.html).toContain('&lt;b&gt;X&lt;/b&gt;');
    expect(msg.html).not.toContain('<b>X</b>');
  });

  test('escapes a script comment in the HTML and keeps it literal in the text', () => {
    const base = makeSubmission({}, { neeIds: ['3A'] });
    const nee: Answer = {
      answer: 'nee',
      comment: '<script>alert(1)</script>',
      actionBefore: '2026-11-21',
      photos: [],
    };
    const sub = { ...base, answers: { ...base.answers, '3A': nee } };
    const msg = buildMail(sub, PDF, CONFIG);
    expect(msg.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(msg.html).not.toContain('<script>');
    expect(msg.text).toContain('<script>alert(1)</script>');
    expect(msg.text).toContain('Opgelost vóór 21-11-2026');
  });

  test('escapes monteur and projectnummer in the HTML', () => {
    const msg = buildMail(makeSubmission({ monteur: `O'Neil & "Zn"`, projectnummer: '<1>' }), PDF, CONFIG);
    expect(msg.html).toContain('O&#39;Neil &amp; &quot;Zn&quot;');
    expect(msg.html).toContain('&lt;1&gt;');
  });

  test('shows the photo count next to the Opgelost vóór date', () => {
    const base = makeSubmission({}, { neeIds: ['3A'] });
    const nee: Answer = {
      answer: 'nee',
      comment: 'Losse sport.',
      actionBefore: '2026-11-27',
      photos: [JPEG_DATA_URL, JPEG_DATA_URL],
    };
    const sub = { ...base, answers: { ...base.answers, '3A': nee } };
    const msg = buildMail(sub, PDF, CONFIG);
    expect(msg.text).toContain("Opgelost vóór 27-11-2026 (2 foto's)");
    expect(msg.html).toContain('Opgelost vóór 27-11-2026 · 2 foto&#39;s');
  });

  test('includes the good-practice answer only when filled in, escaped in the HTML', () => {
    const filled = buildMail({ ...makeSubmission(), goodPractice: 'Toolbox <elke> ochtend' }, PDF, CONFIG);
    expect(filled.text).toContain('Wat gaat hier goed:\nToolbox <elke> ochtend');
    expect(filled.html).toContain('Toolbox &lt;elke&gt; ochtend');
    const empty = buildMail({ ...makeSubmission(), goodPractice: '  ' }, PDF, CONFIG);
    expect(empty.text).not.toContain('Wat gaat hier goed');
    expect(empty.html).not.toContain('Wat gaat hier goed');
  });

  test('lists comments on Ja and Nvt answers under Opmerkingen, escaped in the HTML', () => {
    const base = makeSubmission();
    const sub = {
      ...base,
      answers: {
        ...base.answers,
        '1B': { answer: 'ja', comment: 'Plan hangt <bij> de ingang.' },
        '9B': { answer: 'nvt', comment: 'Geen EHBO-er nodig, kort klusje.' },
        '2A': { answer: 'ja', comment: '   ' },
      },
    } satisfies typeof base;
    const msg = buildMail(sub, PDF, CONFIG);
    expect(msg.text).toContain(`Opmerkingen:\n\n1B ${appText('1B')} (Ja)\nPlan hangt <bij> de ingang.`);
    expect(msg.text).toContain(`9B ${appText('9B')} (Nvt)\nGeen EHBO-er nodig, kort klusje.`);
    expect(msg.text).not.toContain(`2A ${appText('2A')}`);
    expect(msg.html).toContain('Plan hangt &lt;bij&gt; de ingang.');
    expect(msg.html).toContain('· Nvt');
    expect(buildMail(base, PDF, CONFIG).text).not.toContain('Opmerkingen');
  });

  test('HTML uses the app colours and tables only, so Outlook keeps the layout', () => {
    const msg = buildMail(makeSubmission({}, { neeIds: ['1A'] }), PDF, CONFIG);
    expect(msg.html).toContain('#D92D20');
    expect(msg.html).toContain('#FFF1E8');
    expect(msg.html).toContain('role="presentation"');
    expect(msg.html).not.toMatch(/display:\s*(flex|grid)/);
  });

  test('HTML is a Dutch document without external resources', () => {
    const msg = buildMail(makeSubmission({}, { neeIds: ['1A'] }), PDF, CONFIG);
    expect(msg.html).toMatch(/<html lang="nl">/);
    expect(msg.html).not.toMatch(/<img|<link|<script|src=|href=|url\(/i);
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
