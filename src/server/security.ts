// Abuse and duplicate protection for the submit route.
import { isIP } from 'node:net';
import helmet from '@fastify/helmet';
import type { FastifyInstance, FastifyRequest, onRequestHookHandler, preValidationHookHandler } from 'fastify';
import { compile } from 'proxy-addr';

const HOUR_MS = 60 * 60 * 1000;
const UNKNOWN_PEER = 'onbekend';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=()';
const ONE_YEAR_S = 365 * 24 * 60 * 60;

/** The URL without its query string, as sent (not decoded). */
export const pathOf = (url: string) => url.split('?', 1)[0] ?? url;
const isApiPath = (path: string) => path === '/api' || path.startsWith('/api/');

/**
 * Whether the request targets the API. The router decodes the path, so `/%61pi/...` reaches
 * `/api/...` routes: use the matched route, else the decoded path, and when the path cannot
 * be decoded treat it as API (fail closed).
 */
function targetsApi(req: FastifyRequest): boolean {
  const route = req.routeOptions.url;
  if (route !== undefined) return isApiPath(route);
  try {
    return isApiPath(decodeURIComponent(pathOf(req.url)));
  } catch {
    return true;
  }
}
const stripMapped = (ip: string) => (ip.toLowerCase().startsWith('::ffff:') && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip);

/**
 * The address that rate limits count against. `CF-Connecting-IP` is used only when the
 * socket peer is one of the `trusted` proxies (e.g. the cloudflared pod's CIDR) and the
 * header holds a single valid IP; otherwise it is the peer's own address.
 */
export function clientKey(req: FastifyRequest, trusted: string[]): string {
  const raw = req.socket.remoteAddress;
  if (raw === undefined) return UNKNOWN_PEER;
  const peer = stripMapped(raw);
  const header = req.headers['cf-connecting-ip'];
  if (typeof header === 'string' && trustFor(trusted)(peer, 0)) {
    const ip = header.trim();
    if (isIP(ip) !== 0) return stripMapped(ip);
  }
  return peer;
}

// Config arrays live as long as the app, so each list is compiled once.
const compiled = new WeakMap<string[], ReturnType<typeof compile>>();
function trustFor(trusted: string[]) {
  let trust = compiled.get(trusted);
  if (trust === undefined) {
    trust = compile(trusted);
    compiled.set(trusted, trust);
  }
  return trust;
}

/**
 * Same-origin only for state-changing requests under /api/: `Origin` must equal
 * `publicOrigin`, and `Sec-Fetch-Site`, when sent, must be `same-origin`. Else 403.
 */
export function originGuard(publicOrigin: string): onRequestHookHandler {
  return async (req, reply) => {
    if (SAFE_METHODS.has(req.method) || !targetsApi(req)) return;
    const site = req.headers['sec-fetch-site'];
    const sameOrigin = req.headers.origin === publicOrigin && (site === undefined || site === 'same-origin');
    if (!sameOrigin) return reply.code(403).send({ status: 'verboden' });
  };
}

/** 415 unless the body is declared as `application/json` (parameters such as charset allowed). */
export const requireJson: onRequestHookHandler = async (req, reply) => {
  const type = (req.headers['content-type'] ?? '').split(';', 1)[0]!.trim().toLowerCase();
  if (type !== 'application/json') return reply.code(415).send({ status: 'niet_ondersteund' });
};

/**
 * Bots fill every field, people never see `website`. A filled one gets a fake success
 * without validation or mail; only the event is logged, not the content.
 */
export const honeypot: preValidationHookHandler = async (req, reply) => {
  const body: unknown = req.body;
  if (typeof body !== 'object' || body === null || !('website' in body)) return;
  const { website } = body;
  if (typeof website === 'string' && website !== '') {
    req.log.info('honeypot');
    return reply.send({ status: 'verzonden' });
  }
};

/** Helmet with the spec §10 CSP, plus a Permissions-Policy, on every response. */
export async function securityHeaders(app: FastifyInstance): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'blob:', 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    // Photos are shown from blob: and data: URLs, which COEP would get in the way of.
    crossOriginEmbedderPolicy: false,
    strictTransportSecurity: { maxAge: ONE_YEAR_S, includeSubDomains: true },
    referrerPolicy: { policy: 'no-referrer' },
  });
  app.addHook('onRequest', async (_req, reply) => {
    reply.header('permissions-policy', PERMISSIONS_POLICY);
  });
}

export interface GlobalLimiter {
  /** Uses one slot if one is free in the last hour; false when the limit is reached. */
  take(): boolean;
  /** Seconds until the next slot frees up (0 when one is free now). */
  retryAfterSeconds(): number;
}

/**
 * At most `maxPerHour` takes in any sliding 60-minute window, over all clients together.
 * Keeps one timestamp per take, so memory is bounded by `maxPerHour`.
 */
export function createGlobalLimiter(maxPerHour: number, now: () => number): GlobalLimiter {
  const taken: number[] = [];

  const prune = (t: number) => {
    while (taken.length > 0 && taken[0]! <= t - HOUR_MS) taken.shift();
  };

  return {
    take() {
      const t = now();
      prune(t);
      if (taken.length >= maxPerHour) return false;
      taken.push(t);
      return true;
    },
    retryAfterSeconds() {
      const t = now();
      prune(t);
      if (taken.length < maxPerHour) return 0;
      return Math.ceil((taken[0]! + HOUR_MS - t) / 1000);
    },
  };
}

export interface SeenIds {
  has(id: string): boolean;
  add(id: string): void;
}

/**
 * Remembers submission ids that were already mailed, for `ttlMs`, so a retry after
 * a lost response does not send a second mail. Stores only the ids, no content.
 */
export function createSeenIds(ttlMs: number, now: () => number): SeenIds {
  const expiresAt = new Map<string, number>();

  const prune = (t: number) => {
    for (const [id, expiry] of expiresAt) {
      if (expiry <= t) expiresAt.delete(id);
    }
  };

  return {
    has(id) {
      const expiry = expiresAt.get(id);
      if (expiry === undefined) return false;
      if (expiry > now()) return true;
      expiresAt.delete(id);
      return false;
    },
    add(id) {
      const t = now();
      prune(t);
      expiresAt.set(id, t + ttlMs);
    },
  };
}
