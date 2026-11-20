import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { buildApp, type AppDeps } from '../../src/server/app.js';
import { loadConfig } from '../../src/server/config.js';
import type { MailMessage } from '../../src/server/mail/build.js';
import type { Mailer } from '../../src/server/mail/send.js';
import type { renderInspectionPdf } from '../../src/server/pdf/render.js';
import { clientKey, createGlobalLimiter, createSeenIds } from '../../src/server/security.js';
import { makeSubmission } from '../fixtures/submission.js';

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const ID = '6f1c2a4e-8b3d-4c5e-9f7a-1b2c3d4e5f60';

const ORIGIN = 'https://inspectie.example.com';
const TUNNEL_CIDR = '10.42.0.0/16';
const TUNNEL_PEER = '10.42.1.7';
const UNTRUSTED_PEER = '203.0.113.9';

const baseEnv = {
  MAIL_TO: 'vgm@example.com',
  MAIL_FROM: 'Werkplekinspectie <inspectie@example.com>',
  SMTP_HOST: 'smtp.example.com',
  SMTP_USER: 'example-user',
  SMTP_PASS: 'example-pass',
  PUBLIC_ORIGIN: ORIGIN,
  TRUST_PROXY: TUNNEL_CIDR,
};

describe('createSeenIds', () => {
  test('remembers an added id and nothing else', () => {
    const seen = createSeenIds(DAY, () => 0);
    expect(seen.has(ID)).toBe(false);
    seen.add(ID);
    expect(seen.has(ID)).toBe(true);
    expect(seen.has('ander-id')).toBe(false);
  });

  test('forgets an id once the TTL (24h) has passed', () => {
    let t = 1_000;
    const seen = createSeenIds(DAY, () => t);
    seen.add(ID);
    t += DAY - 1;
    expect(seen.has(ID)).toBe(true);
    t += 1;
    expect(seen.has(ID)).toBe(false);
  });

  test('adding an id again restarts its TTL', () => {
    let t = 0;
    const seen = createSeenIds(DAY, () => t);
    seen.add(ID);
    t = DAY - 1;
    seen.add(ID);
    t = DAY + 10;
    expect(seen.has(ID)).toBe(true);
  });
});

describe('createGlobalLimiter', () => {
  test('allows maxPerHour takes, then refuses', () => {
    const limiter = createGlobalLimiter(2, () => 0);
    expect(limiter.take()).toBe(true);
    expect(limiter.take()).toBe(true);
    expect(limiter.take()).toBe(false);
    expect(limiter.take()).toBe(false);
  });

  test('is a sliding hour: a slot frees exactly one hour after it was taken', () => {
    let t = 0;
    const limiter = createGlobalLimiter(2, () => t);
    limiter.take();
    t = 30 * 60 * 1000;
    limiter.take();
    t = HOUR - 1;
    expect(limiter.take()).toBe(false);
    t = HOUR;
    expect(limiter.take()).toBe(true);
    expect(limiter.take()).toBe(false);
    t = 30 * 60 * 1000 + HOUR;
    expect(limiter.take()).toBe(true);
  });

  test('a refused take does not use up a slot', () => {
    let t = 0;
    const limiter = createGlobalLimiter(1, () => t);
    limiter.take();
    t = HOUR - 1;
    expect(limiter.take()).toBe(false);
    t = HOUR;
    expect(limiter.take()).toBe(true);
  });

  test('retryAfterSeconds tells when the oldest slot frees, rounded up', () => {
    let t = 0;
    const limiter = createGlobalLimiter(1, () => t);
    expect(limiter.retryAfterSeconds()).toBe(0);
    limiter.take();
    t = HOUR - 1500;
    expect(limiter.retryAfterSeconds()).toBe(2);
  });
});

/** Just enough of a FastifyRequest for clientKey. */
function fakeRequest(peer: string | undefined, cf?: string | string[]): FastifyRequest {
  return {
    socket: { remoteAddress: peer },
    headers: cf === undefined ? {} : { 'cf-connecting-ip': cf },
  } as unknown as FastifyRequest;
}

describe('clientKey', () => {
  const trusted = [TUNNEL_CIDR, '2001:db8:42::/48'];

  test.each([
    ['a trusted peer with a valid CF-Connecting-IP gives that IP', TUNNEL_PEER, '198.51.100.4', '198.51.100.4'],
    ['a trusted IPv6 peer is recognised', '2001:db8:42::5', '198.51.100.4', '198.51.100.4'],
    ['an IPv4-mapped trusted peer is recognised', `::ffff:${TUNNEL_PEER}`, '198.51.100.4', '198.51.100.4'],
    ['an IPv6 CF-Connecting-IP is accepted', TUNNEL_PEER, '2001:db8:1::1', '2001:db8:1::1'],
    ['surrounding spaces in CF-Connecting-IP are ignored', TUNNEL_PEER, ' 198.51.100.4 ', '198.51.100.4'],
    ['an untrusted peer gives its own address', UNTRUSTED_PEER, '198.51.100.4', UNTRUSTED_PEER],
    ['an untrusted IPv4-mapped peer gives the plain IPv4 address', `::ffff:${UNTRUSTED_PEER}`, '198.51.100.4', UNTRUSTED_PEER],
    ['a trusted peer without CF-Connecting-IP gives the peer', TUNNEL_PEER, undefined, TUNNEL_PEER],
    ['a trusted peer with a non-IP CF-Connecting-IP gives the peer', TUNNEL_PEER, 'niet-een-ip', TUNNEL_PEER],
    ['a trusted peer with a list in CF-Connecting-IP gives the peer', TUNNEL_PEER, '198.51.100.4, 198.51.100.5', TUNNEL_PEER],
  ])('%s', (_name, peer, cf, expected) => {
    expect(clientKey(fakeRequest(peer, cf), trusted)).toBe(expected);
  });

  test('a repeated CF-Connecting-IP header gives the peer', () => {
    expect(clientKey(fakeRequest(TUNNEL_PEER, ['198.51.100.4', '198.51.100.5']), trusted)).toBe(TUNNEL_PEER);
  });

  test('with no trusted proxies CF-Connecting-IP is ignored', () => {
    expect(clientKey(fakeRequest(TUNNEL_PEER, '198.51.100.4'), [])).toBe(TUNNEL_PEER);
  });

  test('a request without a socket address gets a fixed key', () => {
    expect(clientKey(fakeRequest(undefined, '198.51.100.4'), trusted)).toBe('onbekend');
  });
});

// --- The submit route with all protections in place ---------------------------------

interface FakeMailer extends Mailer {
  sent: MailMessage[];
}

function fakeMailer(): FakeMailer {
  const mailer: FakeMailer = {
    sent: [],
    async send(msg) {
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
  staticRoot = mkdtempSync(join(tmpdir(), 'werkplekinspectie-security-'));
  writeFileSync(join(staticRoot, 'index.html'), '<!doctype html><title>Werkplekinspectie</title>');
});

afterAll(() => {
  rmSync(staticRoot, { recursive: true, force: true });
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function setup(env: Record<string, string> = {}, deps: Partial<AppDeps> = {}) {
  const cfg = loadConfig({ ...baseEnv, ...env });
  const mailer = fakeMailer();
  const renderPdf = vi.fn<typeof renderInspectionPdf>(async () => Buffer.from('%PDF-1.4 stub'));
  const app = await buildApp(cfg, { mailer, renderPdf, staticRoot, ...deps });
  apps.push(app);
  return { app, mailer, renderPdf };
}

interface PostOptions {
  body?: unknown;
  peer?: string;
  cf?: string;
  headers?: Record<string, string>;
}

let idCounter = 0;
/** A valid submission with a fresh id, so each one would really be mailed. */
function freshSubmission() {
  idCounter += 1;
  return makeSubmission({ submissionId: `0a1b2c3d-4e5f-4a6b-8c7d-${String(idCounter).padStart(12, '0')}` });
}

function post(app: FastifyInstance, opts: PostOptions = {}) {
  const body = opts.body ?? freshSubmission();
  return app.inject({
    method: 'POST',
    url: '/api/inspecties',
    remoteAddress: opts.peer ?? TUNNEL_PEER,
    headers: {
      origin: ORIGIN,
      'content-type': 'application/json',
      ...(opts.cf === undefined ? {} : { 'cf-connecting-ip': opts.cf }),
      ...opts.headers,
    },
    payload: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('per-IP rate limit', () => {
  test('the 6th POST from the same CF-Connecting-IP via the tunnel gives 429 te_veel', async () => {
    const { app, mailer } = await setup({ RATE_LIMIT_PER_IP: '5' });
    for (let i = 0; i < 5; i++) {
      expect((await post(app, { cf: '198.51.100.4' })).statusCode).toBe(200);
    }

    const res = await post(app, { cf: '198.51.100.4' });

    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ status: 'te_veel' });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(mailer.sent).toHaveLength(5);
  });

  test('another CF-Connecting-IP via the tunnel has its own budget', async () => {
    const { app } = await setup({ RATE_LIMIT_PER_IP: '1' });
    expect((await post(app, { cf: '198.51.100.4' })).statusCode).toBe(200);
    expect((await post(app, { cf: '198.51.100.4' })).statusCode).toBe(429);
    expect((await post(app, { cf: '198.51.100.5' })).statusCode).toBe(200);
  });

  test('from an untrusted peer a changing CF-Connecting-IP does not reset the limit', async () => {
    const { app } = await setup({ RATE_LIMIT_PER_IP: '2' });
    expect((await post(app, { peer: UNTRUSTED_PEER, cf: '198.51.100.1' })).statusCode).toBe(200);
    expect((await post(app, { peer: UNTRUSTED_PEER, cf: '198.51.100.2' })).statusCode).toBe(200);

    const res = await post(app, { peer: UNTRUSTED_PEER, cf: '198.51.100.3' });

    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ status: 'te_veel' });
  });

  test('IPv6 clients in the same /64 share one budget', async () => {
    const { app } = await setup({ RATE_LIMIT_PER_IP: '1' });
    expect((await post(app, { cf: '2001:db8:1:2::1' })).statusCode).toBe(200);
    expect((await post(app, { cf: '2001:db8:1:2::ffff' })).statusCode).toBe(429);
    expect((await post(app, { cf: '2001:db8:1:3::1' })).statusCode).toBe(200);
  });

  test('the per-IP limit applies to the submit route only', async () => {
    const { app } = await setup({ RATE_LIMIT_PER_IP: '1' });
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({ method: 'GET', url: '/api/branding', remoteAddress: UNTRUSTED_PEER });
      expect(res.statusCode).toBe(200);
    }
  });
});

describe('global limit', () => {
  test('with globalPerHour=2 the 3rd request from a 3rd IP gives 429 te_veel', async () => {
    const { app, mailer } = await setup({ RATE_LIMIT_GLOBAL_PER_HOUR: '2' });
    expect((await post(app, { cf: '198.51.100.1' })).statusCode).toBe(200);
    expect((await post(app, { cf: '198.51.100.2' })).statusCode).toBe(200);

    const res = await post(app, { cf: '198.51.100.3' });

    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ status: 'te_veel' });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(mailer.sent).toHaveLength(2);
  });

  test('frees up an hour later, using the injected clock', async () => {
    let now = new Date('2026-11-20T10:00:00Z');
    const { app } = await setup({ RATE_LIMIT_GLOBAL_PER_HOUR: '1' }, { now: () => now });
    expect((await post(app, { cf: '198.51.100.1' })).statusCode).toBe(200);
    expect((await post(app, { cf: '198.51.100.2' })).statusCode).toBe(429);
    now = new Date('2026-11-20T11:00:00Z');
    expect((await post(app, { cf: '198.51.100.3' })).statusCode).toBe(200);
  });

  test('requests refused by the per-IP limit do not use up the global budget', async () => {
    const { app } = await setup({ RATE_LIMIT_PER_IP: '1', RATE_LIMIT_GLOBAL_PER_HOUR: '2' });
    expect((await post(app, { cf: '198.51.100.1' })).statusCode).toBe(200);
    for (let i = 0; i < 3; i++) {
      expect((await post(app, { cf: '198.51.100.1' })).statusCode).toBe(429);
    }
    expect((await post(app, { cf: '198.51.100.2' })).statusCode).toBe(200);
  });
});

describe('concurrent submissions', () => {
  /** A renderer that holds every call until `release()`, counting the calls that started. */
  function heldRenderer() {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const renderPdf = vi.fn<typeof renderInspectionPdf>(async () => {
      await gate;
      return Buffer.from('%PDF-1.4 stub');
    });
    return { renderPdf, release };
  }

  test('a 3rd submission while 2 are being processed gives 429 te_veel with retry-after', async () => {
    const held = heldRenderer();
    const { app, mailer } = await setup({}, { renderPdf: held.renderPdf });

    const first = post(app, { cf: '198.51.100.1' });
    const second = post(app, { cf: '198.51.100.2' });
    await vi.waitFor(() => expect(held.renderPdf).toHaveBeenCalledTimes(2));

    const third = await post(app, { cf: '198.51.100.3' });
    expect(third.statusCode).toBe(429);
    expect(third.json()).toEqual({ status: 'te_veel' });
    expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);
    expect(held.renderPdf).toHaveBeenCalledTimes(2);

    held.release();
    expect((await first).statusCode).toBe(200);
    expect((await second).statusCode).toBe(200);
    expect(mailer.sent).toHaveLength(2);

    // The slots are free again.
    expect((await post(app, { cf: '198.51.100.3' })).statusCode).toBe(200);
  });

  test('a submission refused for being busy does not use up the global budget', async () => {
    const held = heldRenderer();
    const { app } = await setup({ RATE_LIMIT_GLOBAL_PER_HOUR: '3' }, { renderPdf: held.renderPdf });
    const running = [post(app, { cf: '198.51.100.1' }), post(app, { cf: '198.51.100.2' })];
    await vi.waitFor(() => expect(held.renderPdf).toHaveBeenCalledTimes(2));
    expect((await post(app, { cf: '198.51.100.3' })).statusCode).toBe(429);
    held.release();
    await Promise.all(running);
    expect((await post(app, { cf: '198.51.100.4' })).statusCode).toBe(200);
  });

  test('refused and failed requests give their slot back', async () => {
    const { app, renderPdf } = await setup();
    for (let i = 0; i < 3; i++) {
      expect((await post(app, { cf: `198.51.100.${10 + i}`, body: '{"kapot": ' })).statusCode).toBe(400);
    }
    for (let i = 0; i < 2; i++) {
      renderPdf.mockRejectedValueOnce(new Error('stuk'));
      expect((await post(app, { cf: `198.51.100.${20 + i}` })).statusCode).toBe(500);
    }
    expect((await post(app, { cf: '198.51.100.30' })).statusCode).toBe(200);
  });

  test('GET routes are not limited by the submit cap', async () => {
    const held = heldRenderer();
    const { app } = await setup({}, { renderPdf: held.renderPdf });
    const running = [post(app, { cf: '198.51.100.1' }), post(app, { cf: '198.51.100.2' })];
    await vi.waitFor(() => expect(held.renderPdf).toHaveBeenCalledTimes(2));
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    held.release();
    await Promise.all(running);
  });
});

describe('origin guard', () => {
  test.each([
    ['a foreign Origin', { origin: 'https://evil.example.com' }],
    ['an Origin with another scheme', { origin: 'http://inspectie.example.com' }],
    ['Origin "null"', { origin: 'null' }],
    ['Sec-Fetch-Site cross-site', { 'sec-fetch-site': 'cross-site' }],
    ['Sec-Fetch-Site same-site', { 'sec-fetch-site': 'same-site' }],
    ['Sec-Fetch-Site none', { 'sec-fetch-site': 'none' }],
  ])('%s gives 403 verboden and sends nothing', async (_name, headers) => {
    const { app, mailer } = await setup();
    const res = await post(app, { headers });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ status: 'verboden' });
    expect(mailer.sent).toHaveLength(0);
  });

  test('a missing Origin gives 403 verboden', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/inspecties',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(freshSubmission()),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ status: 'verboden' });
  });

  test('the right Origin with Sec-Fetch-Site same-origin is accepted', async () => {
    const { app } = await setup();
    const res = await post(app, { headers: { 'sec-fetch-site': 'same-origin' } });
    expect(res.statusCode).toBe(200);
  });

  test('a refused origin does not use up the per-IP budget', async () => {
    const { app } = await setup({ RATE_LIMIT_PER_IP: '1' });
    expect((await post(app, { headers: { origin: 'https://evil.example.com' } })).statusCode).toBe(403);
    expect((await post(app)).statusCode).toBe(200);
  });

  test.each([
    ['DELETE', '/api/inspecties'],
    ['PUT', '/api/onbekend'],
    ['POST', '/api'],
  ] as const)('%s %s without Origin is refused before routing', async (method, url) => {
    const { app } = await setup();
    const res = await app.inject({ method, url });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ status: 'verboden' });
  });

  test.each(['/%61pi/inspecties', '/api/%69nspecties', '/%61%70%69/inspecties?x=1'])(
    'a percent-encoded submit path %s without Origin gives 403 and sends nothing',
    async (url) => {
      const { app, mailer, renderPdf } = await setup();
      const res = await app.inject({
        method: 'POST',
        url,
        remoteAddress: TUNNEL_PEER,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify(freshSubmission()),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ status: 'verboden' });
      expect(mailer.sent).toHaveLength(0);
      expect(renderPdf).not.toHaveBeenCalled();
    },
  );

  test.each(['/%61pi/onbekend', '/%61pi'])('an encoded unknown API path %s without Origin gives 403', async (url) => {
    const { app } = await setup();
    const res = await app.inject({ method: 'POST', url });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ status: 'verboden' });
  });

  test('a submit path that cannot be decoded is refused before any hook or handler', async () => {
    const { app, mailer } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/inspecties%E0%A4%A',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(freshSubmission()),
    });
    expect(res.statusCode).toBe(400);
    expect(mailer.sent).toHaveLength(0);
  });

  test('a POST outside /api/ is not origin-guarded', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'POST', url: '/some/route' });
    expect(res.statusCode).toBe(404);
  });

  test('GET requests under /api/ need no Origin', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/api/branding', headers: { 'sec-fetch-site': 'cross-site' } });
    expect(res.statusCode).toBe(200);
  });
});

describe('content type and body size', () => {
  test.each([
    ['text/plain'],
    ['application/x-www-form-urlencoded'],
    ['multipart/form-data; boundary=x'],
    ['application/jsonp'],
  ])('content-type %s gives 415 niet_ondersteund', async (type) => {
    const { app, mailer } = await setup();
    const res = await post(app, { headers: { 'content-type': type } });
    expect(res.statusCode).toBe(415);
    expect(res.json()).toEqual({ status: 'niet_ondersteund' });
    expect(mailer.sent).toHaveLength(0);
  });

  test('a missing content-type gives 415 niet_ondersteund', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/inspecties',
      headers: { origin: ORIGIN },
      payload: Buffer.from(JSON.stringify(freshSubmission())),
    });
    expect(res.statusCode).toBe(415);
    expect(res.json()).toEqual({ status: 'niet_ondersteund' });
  });

  test('application/json with a charset is accepted', async () => {
    const { app } = await setup();
    const res = await post(app, { headers: { 'content-type': 'Application/JSON; charset=utf-8' } });
    expect(res.statusCode).toBe(200);
  });

  test('a refused content-type does not use up the per-IP budget', async () => {
    const { app } = await setup({ RATE_LIMIT_PER_IP: '1' });
    expect((await post(app, { headers: { 'content-type': 'text/plain' } })).statusCode).toBe(415);
    expect((await post(app)).statusCode).toBe(200);
  });

  test('a body over 12 MB gives 413 te_groot', async () => {
    const { app, mailer } = await setup();
    const res = await post(app, { body: JSON.stringify({ ...freshSubmission(), goodPractice: 'x'.repeat(12_000_001) }) });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({ status: 'te_groot' });
    expect(mailer.sent).toHaveLength(0);
  });
});

describe('honeypot', () => {
  function logCapture() {
    const lines: string[] = [];
    const logStream = new Writable({
      write(chunk: Buffer, _enc, done) {
        lines.push(...chunk.toString().split('\n').filter(Boolean));
        done();
      },
    });
    return { lines, logStream };
  }

  test('a filled website field gives 200 verzonden, sends nothing and logs only "honeypot"', async () => {
    const { lines, logStream } = logCapture();
    const { app, mailer, renderPdf } = await setup({}, { logStream });

    const res = await post(app, { body: { ...freshSubmission(), website: 'http://spam.example.com/koop-nu' } });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'verzonden' });
    expect(mailer.sent).toHaveLength(0);
    expect(renderPdf).not.toHaveBeenCalled();
    const log = lines.join('\n');
    expect(log).not.toContain('koop-nu');
    expect(log).not.toContain('Jansen');
    const entries = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(entries.filter((e) => e.msg === 'honeypot')).toHaveLength(1);
  });

  test('the honeypot answers before validation, so an invalid body still gets 200', async () => {
    const { app, mailer } = await setup();
    const res = await post(app, { body: { website: 'x', monteur: '' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'verzonden' });
    expect(mailer.sent).toHaveLength(0);
  });

  test('an empty website field is a normal submission', async () => {
    const { app, mailer } = await setup();
    const res = await post(app, { body: { ...freshSubmission(), website: '' } });
    expect(res.statusCode).toBe(200);
    expect(mailer.sent).toHaveLength(1);
  });

  test('honeypot hits count against the per-IP limit', async () => {
    const { app } = await setup({ RATE_LIMIT_PER_IP: '1' });
    expect((await post(app, { body: { ...freshSubmission(), website: 'x' } })).statusCode).toBe(200);
    expect((await post(app)).statusCode).toBe(429);
  });
});

describe('security headers', () => {
  const CSP_DIRECTIVES = [
    "default-src 'self'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];

  test('GET / has exactly the spec CSP and the other security headers', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/', headers: { accept: 'text/html' } });

    expect(res.statusCode).toBe(200);
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp.split(';').map((d) => d.trim()).filter(Boolean)).toEqual(CSP_DIRECTIVES);
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
    expect(res.headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cross-origin-embedder-policy']).toBeUndefined();
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test.each([
    ['the SPA fallback', { method: 'GET', url: '/some/route', headers: { accept: 'text/html' } }],
    ['a JSON 404', { method: 'GET', url: '/api/onbekend' }],
    ['the health check', { method: 'GET', url: '/healthz' }],
    ['a refused POST', { method: 'POST', url: '/api/inspecties' }],
  ] as const)('%s also carries the headers', async (_name, req) => {
    const { app } = await setup();
    const res = await app.inject(req);
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  test('a 429 still carries the security headers', async () => {
    const { app } = await setup({ RATE_LIMIT_PER_IP: '1' });
    await post(app);
    const res = await post(app);
    expect(res.statusCode).toBe(429);
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });
});
