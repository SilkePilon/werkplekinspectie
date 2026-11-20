// The HTTP server: the submit route, health check, branding and the built client.
// Submissions are handled in memory only; logs carry no submission content.
import { randomUUID } from 'node:crypto';
import type { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import rateLimit, { normalizeIP } from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
  type FastifyServerOptions,
  type preParsingHookHandler,
} from 'fastify';
import type { z } from 'zod';
import type { Config } from './config.js';
import { InvalidImageError, decodeDataUrl, imageSize } from './images.js';
import { buildMail } from './mail/build.js';
import type { Mailer } from './mail/send.js';
import { renderInspectionPdf } from './pdf/render.js';
import {
  clientKey,
  createGlobalLimiter,
  createSeenIds,
  honeypot,
  originGuard,
  pathOf,
  requireJson,
  securityHeaders,
} from './security.js';
import { QUESTION_IDS } from '../shared/questions.js';
import { LIMITS, submissionSchema, type Submission } from '../shared/schema.js';

export interface AppDeps {
  mailer: Mailer;
  renderPdf?: typeof renderInspectionPdf;
  now?: () => Date;
  logo?: { data: Buffer; kind: 'svg' | 'png' };
  /** Directory with the built client. Default: dist/client next to the compiled server. */
  staticRoot?: string;
  /** Where JSON logs go. Without it, logging is off (tests). */
  logStream?: Writable;
}

const SEEN_TTL_MS = 24 * 60 * 60 * 1000;
const PHOTO_MAX_PX = 2000;
const SIGNATURE_MAX = { width: 2400, height: 1600 };
const INDEX_HTML = 'index.html';
/** Files with fixed names that the browser must revalidate: the app shell, service worker and manifest. */
const NO_CACHE_FILES = [INDEX_HTML, 'sw.js', 'manifest.webmanifest'].map((name) => `/${name}`);
const LOGO_TYPES = { svg: 'image/svg+xml', png: 'image/png' } as const;

// Compiled to dist/server/server/app.js, so the client build is two levels up.
const DEFAULT_STATIC_ROOT = fileURLToPath(new URL('../../client', import.meta.url));

const NOT_FOUND = { status: 'niet_gevonden' } as const;
const SENT = { status: 'verzonden' } as const;
const invalid = (fields: string[]) => ({ status: 'ongeldig', fields });
/** Client errors whose status is kept as is, with its own body. */
const CLIENT_ERRORS: Partial<Record<number, { status: string }>> = {
  403: { status: 'verboden' },
  415: { status: 'niet_ondersteund' },
  429: { status: 'te_veel' },
};

/** Thrown by the rate limits so the 429 goes through the error handler. */
const tooMany = () => Object.assign(new Error('te_veel'), { statusCode: 429 });

class MailFailedError extends Error {}

/** Logs only method, path, status, duration, byte sizes and the request id. */
function loggerOptions(stream: Writable): FastifyServerOptions['logger'] {
  return {
    level: 'info',
    stream,
    serializers: {
      req: (req) => ({
        method: req.method,
        url: pathOf(req.url),
        contentLength: req.headers['content-length'],
      }),
      res: (reply) => ({
        statusCode: reply.statusCode,
        contentLength: reply.getHeader?.('content-length'),
      }),
      // Messages and stacks can quote the request (e.g. JSON.parse errors), so they are dropped.
      err: (err) => ({ type: err.name, code: err.code, message: '', stack: '' }),
    },
  };
}

/** Unique dotted zod paths; unknown keys are named individually. */
function issueFields(error: z.ZodError): string[] {
  const fields = new Set<string>();
  for (const issue of error.issues) {
    const path = issue.path.map(String);
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) fields.add([...path, key].join('.'));
    } else if (path.length > 0) {
      fields.add(path.join('.'));
    }
  }
  return [...fields];
}

interface ImageCheck {
  path: string;
  url: string;
  maxBytes: number;
  maxWidth: number;
  maxHeight: number;
}

function imageChecks(sub: Submission): ImageCheck[] {
  const photos = QUESTION_IDS.flatMap((id) => {
    const a = sub.answers[id];
    if (a.answer !== 'nee') return [];
    return a.photos.map((url, i) => ({
      path: `answers.${id}.photos.${i}`,
      url,
      maxBytes: LIMITS.photoBytes,
      maxWidth: PHOTO_MAX_PX,
      maxHeight: PHOTO_MAX_PX,
    }));
  });
  return [
    ...photos,
    {
      path: 'signature',
      url: sub.signature,
      maxBytes: LIMITS.signatureBytes,
      maxWidth: SIGNATURE_MAX.width,
      maxHeight: SIGNATURE_MAX.height,
    },
  ];
}

/** Decodes the image and checks type, byte size and pixel size. The bytes are not kept. */
function imageFits(check: ImageCheck): boolean {
  try {
    const { kind, data } = decodeDataUrl(check.url);
    if (data.length > check.maxBytes) return false;
    const { width, height } = imageSize(data, kind);
    return width <= check.maxWidth && height <= check.maxHeight;
  } catch (err) {
    if (err instanceof InvalidImageError) return false;
    throw err;
  }
}

export async function buildApp(cfg: Config, deps: AppDeps): Promise<FastifyInstance> {
  const renderPdf = deps.renderPdf ?? renderInspectionPdf;
  const now = deps.now ?? (() => new Date());
  const seen = createSeenIds(SEEN_TTL_MS, () => now().getTime());
  const globalLimit = createGlobalLimiter(cfg.rateLimit.globalPerHour, () => now().getTime());
  // Sends that are still running, so a double tap waits for the first instead of mailing twice.
  const inFlight = new Map<string, Promise<void>>();

  const app = Fastify({
    logger: deps.logStream ? loggerOptions(deps.logStream) : false,
    genReqId: () => randomUUID(),
  });

  app.setErrorHandler((err, req, reply) => {
    // Anything can be thrown, so read the Fastify error fields defensively.
    const { code, statusCode } = (typeof err === 'object' && err !== null ? err : {}) as {
      code?: unknown;
      statusCode?: unknown;
    };
    if (code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.code(413).send({ status: 'te_groot' });
    }
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      // Other client errors from Fastify itself, e.g. malformed JSON, are 'ongeldig'.
      return reply.code(statusCode).send(CLIENT_ERRORS[statusCode] ?? invalid([]));
    }
    req.log.error({ err }, 'onbekende_fout');
    return reply.code(500).send({ status: 'onbekend' });
  });

  // Hook order on the submit route: origin guard (all non-GET /api/ requests), then
  // content type, per-IP limit, global limit, honeypot, and finally the handler.
  await securityHeaders(app);
  app.addHook('onRequest', originGuard(cfg.publicOrigin));
  await app.register(rateLimit, { global: false });

  // Runs before the body is read, and only for requests the per-IP limit let through.
  const takeGlobalSlot: preParsingHookHandler = async (_req, reply, payload) => {
    if (!globalLimit.take()) {
      reply.header('retry-after', globalLimit.retryAfterSeconds());
      throw tooMany();
    }
    return payload;
  };

  async function deliver(sub: Submission): Promise<void> {
    const pdf = await renderPdf(sub, cfg.branding, deps.logo?.data, deps.logo?.kind);
    const msg = buildMail(sub, pdf, cfg);
    try {
      await deps.mailer.send(msg);
    } catch (err) {
      // The Mailer guarantees its error message holds no credentials or content.
      throw new MailFailedError(err instanceof Error ? err.message : 'Mail versturen mislukt');
    }
    seen.add(sub.submissionId);
  }

  // Validation runs in the handler, not as a route schema, so a preValidation hook
  // (the honeypot) still sees the raw parsed body and can answer before zod runs.
  const submitOptions = {
    bodyLimit: LIMITS.bodyBytes,
    // @fastify/rate-limit appends its own onRequest hook after this one.
    onRequest: requireJson,
    preParsing: takeGlobalSlot,
    preValidation: honeypot,
    config: {
      rateLimit: {
        max: cfg.rateLimit.perIp,
        timeWindow: cfg.rateLimit.window,
        // IPv6 clients are grouped per /64, as the plugin does by default.
        keyGenerator: (req: FastifyRequest) => normalizeIP(clientKey(req, cfg.trustProxy)),
        errorResponseBuilder: tooMany,
      },
    },
  };

  app.post('/api/inspecties', submitOptions, async (req, reply) => {
    const parsed = submissionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(invalid(issueFields(parsed.error)));
    const sub = parsed.data;

    const badImages = imageChecks(sub)
      .filter((check) => !imageFits(check))
      .map((check) => check.path);
    if (badImages.length > 0) return reply.code(400).send(invalid(badImages));

    const id = sub.submissionId;
    if (seen.has(id)) return SENT;

    let pending = inFlight.get(id);
    if (pending === undefined) {
      pending = deliver(sub).finally(() => inFlight.delete(id));
      inFlight.set(id, pending);
    }
    try {
      await pending;
    } catch (err) {
      if (!(err instanceof MailFailedError)) throw err;
      req.log.warn({ reason: err.message }, 'mail_mislukt');
      return reply.code(502).send({ status: 'mail_mislukt' });
    }
    return SENT;
  });

  app.get('/healthz', { logLevel: 'warn' }, async (_req, reply) => reply.type('text/plain').send('ok'));

  app.get('/api/branding', async () => ({ hasLogo: deps.logo !== undefined }));

  app.get('/api/branding/logo', async (_req, reply) => {
    if (deps.logo === undefined) return reply.code(404).send(NOT_FOUND);
    return reply.type(LOGO_TYPES[deps.logo.kind]).send(deps.logo.data);
  });

  await app.register(fastifyStatic, {
    root: deps.staticRoot ?? DEFAULT_STATIC_ROOT,
    wildcard: false,
    setHeaders(res, path) {
      if (NO_CACHE_FILES.some((name) => path.endsWith(name))) res.header('cache-control', 'no-cache');
    },
  });

  // Client-side routes get the app shell; everything else gets a JSON 404.
  app.setNotFoundHandler((req, reply) => {
    const path = pathOf(req.url);
    const isApi = path === '/api' || path.startsWith('/api/');
    const wantsHtml = (req.headers.accept ?? '').includes('text/html');
    if ((req.method === 'GET' || req.method === 'HEAD') && !isApi && wantsHtml) {
      return reply.sendFile(INDEX_HTML);
    }
    return reply.code(404).send(NOT_FOUND);
  });

  return app;
}
