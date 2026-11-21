import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { buildApp, type AppDeps } from '../../src/server/app.js';
import { loadConfig } from '../../src/server/config.js';
import type { MailMessage } from '../../src/server/mail/build.js';
import type { Mailer } from '../../src/server/mail/send.js';
import { renderInspectionPdf as renderInspectionPdfReal, type renderInspectionPdf } from '../../src/server/pdf/render.js';
import type { Answer, Submission } from '../../src/shared/schema.js';
import { makePng, pngDataUrl, pngHiddenInLongIhdr, pngHiddenInTrns, pngSecondIhdr } from '../fixtures/png.js';
import { JPEG_DATA_URL, PNG_DATA_URL, makeSubmission } from '../fixtures/submission.js';

const cfg = loadConfig({
  MAIL_TO: 'vgm@example.com',
  MAIL_FROM: 'Werkplekinspectie <inspectie@example.com>',
  SMTP_HOST: 'smtp.example.com',
  SMTP_USER: 'example-user',
  SMTP_PASS: 'example-pass',
  PUBLIC_ORIGIN: 'https://inspectie.example.com',
  ORG_NAME: 'Voorbeeld B.V.',
});

const PDF = Buffer.from('%PDF-1.4 stub');
const INDEX_HTML = '<!doctype html><title>Werkplekinspectie</title>';
const SW_JS = 'self.skipWaiting;';
const MANIFEST = '{"name":"Werkplekinspectie"}';
const GIF_1X1 = 'R0lGODlhAQABAPAAAEMZYQAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==';
const SVG_LOGO = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');

/** A JPEG data URL that is only SOI plus a frame header claiming the given size. */
function jpegDataUrl(width: number, height: number): string {
  const frame = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0, 0, 0, 0, 0x01, 0x01, 0x11, 0x00]);
  frame.writeUInt16BE(height, 7);
  frame.writeUInt16BE(width, 9);
  return `data:image/jpeg;base64,${frame.toString('base64')}`;
}

/** A real (all transparent) RGBA PNG of the given size, as the signature pad exports. */
const signaturePng = (width: number, height: number) => pngDataUrl(makePng({ width, height }));

interface FakeMailer extends Mailer {
  sent: MailMessage[];
  /** Number of send() calls, including ones still waiting or failing. */
  calls: number;
  failures: number;
  /** When set, send() waits for this promise before recording the message. */
  gate?: Promise<void>;
}

function fakeMailer(): FakeMailer {
  const mailer: FakeMailer = {
    sent: [],
    calls: 0,
    failures: 0,
    async send(msg) {
      mailer.calls += 1;
      if (mailer.gate) await mailer.gate;
      if (mailer.failures > 0) {
        mailer.failures -= 1;
        throw new Error('Mail versturen mislukt (ECONNECTION)');
      }
      mailer.sent.push(msg);
    },
    async verify() {
      return true;
    },
  };
  return mailer;
}

let staticRoot: string;
const apps: FastifyInstance[] = [];

beforeAll(() => {
  staticRoot = mkdtempSync(join(tmpdir(), 'werkplekinspectie-static-'));
  writeFileSync(join(staticRoot, 'index.html'), INDEX_HTML);
  writeFileSync(join(staticRoot, 'sw.js'), SW_JS);
  writeFileSync(join(staticRoot, 'manifest.webmanifest'), MANIFEST);
  mkdirSync(join(staticRoot, 'assets'));
  writeFileSync(join(staticRoot, 'assets', 'index-abc123.js'), SW_JS);
});

afterAll(() => {
  rmSync(staticRoot, { recursive: true, force: true });
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function setup(deps: Partial<AppDeps> = {}) {
  const mailer = fakeMailer();
  const renderPdf = vi.fn<typeof renderInspectionPdf>(async () => PDF);
  const app = await buildApp(cfg, { mailer, renderPdf, staticRoot, ...deps });
  apps.push(app);
  return { app, mailer, renderPdf };
}

function post(app: FastifyInstance, body: unknown) {
  return app.inject({
    method: 'POST',
    url: '/api/inspecties',
    headers: { origin: cfg.publicOrigin, 'content-type': 'application/json' },
    payload: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** A submission with 4B answered Nee, with the given changes to that answer. */
function with4B(changes: Partial<Extract<Answer, { answer: 'nee' }>>, top: Partial<Submission> = {}) {
  const sub = makeSubmission(top, { neeIds: ['4B'], photosPerNee: 1 });
  sub.answers['4B'] = { ...(sub.answers['4B'] as Extract<Answer, { answer: 'nee' }>), ...changes };
  return sub;
}

describe('POST /api/inspecties', () => {
  test('a valid submission is rendered and mailed once with the PDF attached', async () => {
    const { app, mailer, renderPdf } = await setup();
    const sub = makeSubmission({}, { neeIds: ['4B'], photosPerNee: 2 });

    const res = await post(app, sub);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'verzonden' });
    expect(mailer.sent).toHaveLength(1);
    const [attachment] = mailer.sent[0]!.attachments;
    expect(attachment?.contentType).toBe('application/pdf');
    expect(attachment?.content.equals(PDF)).toBe(true);
    expect(mailer.sent[0]!.to).toBe('vgm@example.com');
    expect(renderPdf).toHaveBeenCalledWith(sub, cfg.branding, undefined, undefined);
  });

  test('passes the logo to the PDF renderer', async () => {
    const { app, renderPdf } = await setup({ logo: { data: SVG_LOGO, kind: 'svg' } });
    await post(app, makeSubmission());
    expect(renderPdf).toHaveBeenCalledWith(expect.anything(), cfg.branding, SVG_LOGO, 'svg');
  });

  test('an invalid body gives 400 with the zod paths and sends nothing', async () => {
    const { app, mailer, renderPdf } = await setup();

    const res = await post(app, with4B({ comment: '   ' }, { monteur: '' }));

    expect(res.statusCode).toBe(400);
    const body = res.json<{ status: string; fields: string[] }>();
    expect(body.status).toBe('ongeldig');
    expect(body.fields).toContain('answers.4B.comment');
    expect(body.fields).toContain('monteur');
    expect(new Set(body.fields).size).toBe(body.fields.length);
    expect(mailer.sent).toHaveLength(0);
    expect(renderPdf).not.toHaveBeenCalled();
  });

  test('unknown top-level keys are named in fields', async () => {
    const { app } = await setup();
    const res = await post(app, { ...makeSubmission(), extra: 1 });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ status: 'ongeldig', fields: ['extra'] });
  });

  test.each([
    ['an array', '[]'],
    ['a string', '"inspectie"'],
    ['null', 'null'],
  ])('a JSON body that is %s gives 400 naming (body)', async (_name, body) => {
    const { app, mailer } = await setup();
    const res = await post(app, body);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ status: 'ongeldig', fields: ['(body)'] });
    expect(mailer.sent).toHaveLength(0);
  });

  test('too many photos in total is named as answers', async () => {
    const { app } = await setup();
    const sub = makeSubmission({}, { neeIds: ['1A', '1B', '1C', '1D', '2A', '2B'], photosPerNee: 3 });
    const res = await post(app, sub);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ status: 'ongeldig', fields: ['answers'] });
  });

  test('malformed JSON gives 400 ongeldig', async () => {
    const { app, mailer } = await setup();
    const res = await post(app, '{"submissionId": ');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ status: 'ongeldig', fields: [] });
    expect(mailer.sent).toHaveLength(0);
  });

  test('Review Focus 2: the same submissionId twice gives 200 twice and one mail', async () => {
    const { app, mailer } = await setup();
    const sub = makeSubmission();

    const first = await post(app, sub);
    const second = await post(app, sub);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ status: 'verzonden' });
    expect(mailer.sent).toHaveLength(1);
  });

  test('Review Focus 2: a double tap while the first send is in flight gives one mail', async () => {
    const { app, mailer } = await setup();
    let release!: () => void;
    mailer.gate = new Promise((resolve) => (release = resolve));
    // preHandler is the last step before the handler, which runs synchronously up to
    // awaiting the in-flight send; so once both have passed it, both are in the handler.
    let atHandler = 0;
    app.addHook('preHandler', async () => {
      atHandler += 1;
    });
    const sub = makeSubmission();

    const both = Promise.all([post(app, sub), post(app, sub)]);
    await vi.waitFor(() => {
      expect(atHandler).toBe(2);
      expect(mailer.calls).toBe(1);
    });
    release();
    const [a, b] = await both;

    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(mailer.calls).toBe(1);
    expect(mailer.sent).toHaveLength(1);
  });

  test('a different submissionId is sent again', async () => {
    const { app, mailer } = await setup();
    await post(app, makeSubmission());
    await post(app, makeSubmission({ submissionId: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' }));
    expect(mailer.sent).toHaveLength(2);
  });

  test('a seen id is forgotten after 24 hours', async () => {
    let now = new Date('2026-11-20T10:00:00Z');
    const { app, mailer } = await setup({ now: () => now });
    const sub = makeSubmission();

    await post(app, sub);
    now = new Date('2026-11-21T09:59:59Z');
    await post(app, sub);
    expect(mailer.sent).toHaveLength(1);
    now = new Date('2026-11-21T10:00:00Z');
    await post(app, sub);
    expect(mailer.sent).toHaveLength(2);
  });

  test('a mail failure gives 502 and the id is not marked, so a retry sends', async () => {
    const { app, mailer } = await setup();
    mailer.failures = 1;
    const sub = makeSubmission();

    const failed = await post(app, sub);
    expect(failed.statusCode).toBe(502);
    expect(failed.json()).toEqual({ status: 'mail_mislukt' });
    expect(mailer.sent).toHaveLength(0);

    const retry = await post(app, sub);
    expect(retry.statusCode).toBe(200);
    expect(mailer.sent).toHaveLength(1);
  });

  test('a render failure gives 500 onbekend without details, and a retry can still send', async () => {
    const { app, mailer, renderPdf } = await setup();
    renderPdf.mockRejectedValueOnce(new Error('pdfkit stuk: geheime details'));
    const sub = makeSubmission();

    const res = await post(app, sub);
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ status: 'onbekend' });
    expect(res.body).not.toContain('geheime');
    expect(mailer.sent).toHaveLength(0);

    expect((await post(app, sub)).statusCode).toBe(200);
    expect(mailer.sent).toHaveLength(1);
  });

  test('a photo with a JPEG prefix but GIF bytes gives 400 naming the photo', async () => {
    const { app, mailer } = await setup();
    const res = await post(app, with4B({ photos: [JPEG_DATA_URL, `data:image/jpeg;base64,${GIF_1X1}`] }));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ status: 'ongeldig', fields: ['answers.4B.photos.1'] });
    expect(mailer.sent).toHaveLength(0);
  });

  test('a signature with GIF bytes gives 400 naming the signature', async () => {
    const { app } = await setup();
    const res = await post(app, makeSubmission({ signature: `data:image/png;base64,${GIF_1X1}` }));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ status: 'ongeldig', fields: ['signature'] });
  });

  test.each([
    [2001, 10],
    [10, 2001],
    [10000, 10000],
  ])('a %ix%i photo is rejected as too large', async (w, h) => {
    const { app, mailer } = await setup();
    const res = await post(app, with4B({ photos: [jpegDataUrl(w, h)] }));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ status: 'ongeldig', fields: ['answers.4B.photos.0'] });
    expect(mailer.sent).toHaveLength(0);
  });

  test('a 2000x2000 photo and a 2400x1600 signature are accepted', async () => {
    const { app, mailer } = await setup();
    const res = await post(app, with4B({ photos: [jpegDataUrl(2000, 2000)] }, { signature: signaturePng(2400, 1600) }));
    expect(res.statusCode).toBe(200);
    expect(mailer.sent).toHaveLength(1);
  });

  test.each([
    [2401, 100],
    [100, 1601],
  ])('a %ix%i signature is rejected as too large', async (w, h) => {
    const { app } = await setup();
    const res = await post(app, makeSubmission({ signature: signaturePng(w, h) }));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ status: 'ongeldig', fields: ['signature'] });
  });

  test('a valid PNG photo is refused: photos are JPEG only', async () => {
    const { app, mailer } = await setup();
    const res = await post(app, with4B({ photos: [PNG_DATA_URL] }));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ status: 'ongeldig', fields: ['answers.4B.photos.0'] });
    expect(mailer.sent).toHaveLength(0);
  });

  test('a decompression-bomb signature (10x10, pixel data inflating to 64 MB) is refused before the PDF', async () => {
    const { app, mailer, renderPdf } = await setup();
    const bomb = makePng({ width: 10, height: 10, rawBytes: 64 * 1024 * 1024 });
    expect(bomb.length).toBeLessThan(300_000);
    const res = await post(app, makeSubmission({ signature: pngDataUrl(bomb) }));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ status: 'ongeldig', fields: ['signature'] });
    expect(renderPdf).not.toHaveBeenCalled();
    expect(mailer.sent).toHaveLength(0);
  });

  // Shapes a check that parses chunks differently from png-js (used by pdfkit) would let through.
  test.each([
    ['a second IHDR declaring 12000x12000', () => pngSecondIhdr(12000)],
    ['an IDAT bomb hidden in a tRNS chunk', () => pngHiddenInTrns(64 * 1024 * 1024)],
    ['an IDAT bomb hidden in an over-long IHDR', () => pngHiddenInLongIhdr(64 * 1024 * 1024)],
  ])('a signature with %s is refused before the PDF', async (_name, build) => {
    const { app, mailer, renderPdf } = await setup();
    const png = build();
    expect(png.length).toBeLessThan(300_000);
    const res = await post(app, makeSubmission({ signature: pngDataUrl(png) }));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ status: 'ongeldig', fields: ['signature'] });
    expect(renderPdf).not.toHaveBeenCalled();
    expect(mailer.sent).toHaveLength(0);
  });

  test('a 2400x1600 RGBA signature in several IDAT chunks is accepted and rendered by the real renderer', async () => {
    const { app, mailer } = await setup({ renderPdf: renderInspectionPdfReal });
    const signature = pngDataUrl(makePng({ width: 2400, height: 1600, idatChunks: 6 }));
    const res = await post(app, makeSubmission({ signature }));
    expect(res.statusCode).toBe(200);
    expect(mailer.sent[0]!.attachments[0]!.content.subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('an interlaced signature PNG is refused', async () => {
    const { app, renderPdf } = await setup();
    const res = await post(app, makeSubmission({ signature: pngDataUrl(makePng({ width: 20, height: 10, interlace: 1 })) }));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ status: 'ongeldig', fields: ['signature'] });
    expect(renderPdf).not.toHaveBeenCalled();
  });

  test('a body over 12 MB gives 413 te_groot', async () => {
    const { app, mailer } = await setup();
    const res = await post(app, JSON.stringify({ ...makeSubmission(), goodPractice: 'x'.repeat(12_000_001) }));
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({ status: 'te_groot' });
    expect(mailer.sent).toHaveLength(0);
  });
});

describe('POST /api/inspecties with a gzipped body', () => {
  function postEncoded(app: FastifyInstance, payload: Buffer, encoding: string) {
    return app.inject({
      method: 'POST',
      url: '/api/inspecties',
      headers: { origin: cfg.publicOrigin, 'content-type': 'application/json', 'content-encoding': encoding },
      payload,
    });
  }

  test('is inflated, checked and mailed like a plain one', async () => {
    const { app, mailer, renderPdf } = await setup();
    const sub = makeSubmission({}, { neeIds: ['4B'], photosPerNee: 2 });
    const res = await postEncoded(app, gzipSync(JSON.stringify(sub)), 'gzip');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'verzonden' });
    expect(renderPdf).toHaveBeenCalledWith(sub, cfg.branding, undefined, undefined);
    expect(mailer.sent).toHaveLength(1);
  });

  test('Content-Encoding identity is the plain body', async () => {
    const { app, mailer } = await setup();
    const res = await postEncoded(app, Buffer.from(JSON.stringify(makeSubmission())), 'identity');
    expect(res.statusCode).toBe(200);
    expect(mailer.sent).toHaveLength(1);
  });

  test('a gzip bomb stops at the body limit: 413 te_groot, nothing mailed', async () => {
    const { app, mailer, renderPdf } = await setup();
    const bomb = gzipSync(JSON.stringify({ ...makeSubmission(), goodPractice: 'x'.repeat(50_000_000) }));
    // About 50 kB on the wire, 50 MB once inflated.
    expect(bomb.length).toBeLessThan(100_000);
    const res = await postEncoded(app, bomb, 'gzip');
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({ status: 'te_groot' });
    expect(renderPdf).not.toHaveBeenCalled();
    expect(mailer.sent).toHaveLength(0);
  });

  test('broken gzip gives 400 ongeldig without fields', async () => {
    const { app, mailer } = await setup();
    const broken = gzipSync(JSON.stringify(makeSubmission())).subarray(0, 40);
    const res = await postEncoded(app, Buffer.concat([broken, Buffer.from('not gzip at all')]), 'gzip');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ status: 'ongeldig', fields: [] });
    expect(mailer.sent).toHaveLength(0);
  });

  test('other encodings give 415 niet_ondersteund', async () => {
    const { app, mailer } = await setup();
    const res = await postEncoded(app, Buffer.from(JSON.stringify(makeSubmission())), 'br');
    expect(res.statusCode).toBe(415);
    expect(res.json()).toEqual({ status: 'niet_ondersteund' });
    expect(mailer.sent).toHaveLength(0);
  });
});

describe('other routes', () => {
  test('GET /healthz gives 200 ok', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('ok');
  });

  test('GET /api/branding tells whether a logo is configured', async () => {
    const without = await setup();
    expect((await without.app.inject({ method: 'GET', url: '/api/branding' })).json()).toEqual({ hasLogo: false });
    const withLogo = await setup({ logo: { data: SVG_LOGO, kind: 'svg' } });
    expect((await withLogo.app.inject({ method: 'GET', url: '/api/branding' })).json()).toEqual({ hasLogo: true });
  });

  test('GET /api/branding/logo without a logo gives 404', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/api/branding/logo' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ status: 'niet_gevonden' });
  });

  test.each([
    ['svg', SVG_LOGO, 'image/svg+xml'],
    ['png', makePng({ width: 10, height: 10 }), 'image/png'],
  ] as const)('GET /api/branding/logo serves a %s logo with its content type', async (kind, data, type) => {
    const { app } = await setup({ logo: { data, kind } });
    const res = await app.inject({ method: 'GET', url: '/api/branding/logo' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe(type);
    expect(res.rawPayload.equals(data)).toBe(true);
  });

  test('configured icons replace the built-in ones, revalidated on every use', async () => {
    writeFileSync(join(staticRoot, 'built-in.png'), 'built-in');
    // The build has a file at the same path: that must not clash, the configured one wins.
    mkdirSync(join(staticRoot, 'icons'), { recursive: true });
    writeFileSync(join(staticRoot, 'icons', 'pwa-192x192.png'), 'built-in icon');
    const body = Buffer.from('configured');
    const icons = new Map([['/icons/pwa-192x192.png', { type: 'image/png', body }]]);
    const { app } = await setup({ icons });
    // The service worker precaches with a revision query; the route must still match.
    const res = await app.inject({ method: 'GET', url: '/icons/pwa-192x192.png?__WB_REVISION__=abc' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.rawPayload.equals(body)).toBe(true);
    // Files without a configured icon still come from the build.
    const other = await app.inject({ method: 'GET', url: '/built-in.png' });
    expect(other.body).toBe('built-in');
  });

  test('GET /some/route serves index.html from staticRoot, uncached', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/some/route', headers: { accept: 'text/html' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.body).toBe(INDEX_HTML);
  });

  test('GET / serves index.html with cache-control no-cache', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/', headers: { accept: 'text/html' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.body).toBe(INDEX_HTML);
  });

  // The service worker and manifest have fixed names, so the browser must revalidate them.
  test.each([
    ['/sw.js', /^(text|application)\/javascript/, SW_JS],
    ['/manifest.webmanifest', /^application\/manifest\+json/, MANIFEST],
  ])('GET %s is served uncached with its content type', async (url, type, body) => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(type);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.body).toBe(body);
  });

  test('hashed assets keep the default cache-control', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/assets/index-abc123.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).not.toBe('no-cache');
  });

  test.each([
    ['GET', '/api/onbekend', 'text/html'],
    ['GET', '/api', 'text/html'],
    ['GET', '/some/route', 'application/json'],
    ['GET', '/plaatje.png', 'image/*'],
  ] as const)('%s %s (Accept %s) gives a JSON 404', async (method, url, accept) => {
    const { app } = await setup();
    const res = await app.inject({ method, url, headers: { accept } });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ status: 'niet_gevonden' });
  });

  // POSTs carry a same-origin Origin and a JSON body, so only routing decides the answer.
  test.each([
    ['/some/route', 'text/html'],
    ['/api/onbekend', 'application/json'],
  ])('a same-origin POST %s (Accept %s) gives a JSON 404, not the app shell', async (url, accept) => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'POST',
      url,
      headers: { accept, origin: cfg.publicOrigin, 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ status: 'niet_gevonden' });
  });
});

describe('logging', () => {
  test('logs status, duration, size and request id but no submission content', async () => {
    const lines: string[] = [];
    const logStream = new Writable({
      write(chunk: Buffer, _enc, done) {
        lines.push(...chunk.toString().split('\n').filter(Boolean));
        done();
      },
    });
    const { app } = await setup({ logStream });
    const sub = makeSubmission({ project: 'Geheim Project' }, { neeIds: ['4B'] });

    const res = await app.inject({
      method: 'POST',
      url: '/api/inspecties?token=querygeheim',
      headers: {
        origin: cfg.publicOrigin,
        'content-type': 'application/json',
        'user-agent': 'TestBrowser/1.0',
        cookie: 'sessie=koekje',
      },
      payload: JSON.stringify(sub),
    });
    expect(res.statusCode).toBe(200);

    const log = lines.join('\n');
    for (const secret of ['Jansen', 'Geheim Project', 'Probleem', 'querygeheim', 'TestBrowser', 'koekje', 'base64']) {
      expect(log).not.toContain(secret);
    }
    const entries = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    const completed = entries.find((e) => e.msg === 'request completed');
    expect(completed).toMatchObject({ res: { statusCode: 200 } });
    expect(typeof completed?.responseTime).toBe('number');
    expect(typeof completed?.reqId).toBe('string');
    const incoming = entries.find((e) => e.msg === 'incoming request');
    expect(incoming).toMatchObject({
      req: { method: 'POST', url: '/api/inspecties', contentLength: String(Buffer.byteLength(JSON.stringify(sub))) },
    });
  });
});
