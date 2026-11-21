// Sends a signed inspection to the server and turns the answer into one of a few outcomes
// the result screen knows how to explain.
import type { Submission } from '@shared/schema';

export type SubmitOutcome =
  | 'verzonden'
  /** No network. */
  | 'offline'
  /** No answer in time: a slow upload, or the server took too long. */
  | 'traag'
  | 'te_veel'
  | 'ongeldig'
  /** 413: the body is over the server's limit; only removing photos helps. */
  | 'te_groot'
  | 'mail_mislukt'
  | 'onbekend';

export interface SubmitResult {
  outcome: SubmitOutcome;
  /** Only for `ongeldig`: dotted paths the server named, such as `answers.4B.comment`. */
  fields?: string[];
}

const BASE_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 180_000;
/** A slow mobile upload, in bytes per second: the timeout leaves room for it. */
const SLOW_UPLOAD_BYTES_PER_S = 25_000;

/** How long to wait for an answer: 30 s plus the upload at 25 kB/s, at most 180 s. */
export function sendTimeoutMs(bodyBytes: number): number {
  return Math.min(MAX_TIMEOUT_MS, BASE_TIMEOUT_MS + (bodyBytes / SLOW_UPLOAD_BYTES_PER_S) * 1000);
}

/** The JSON body sent for this inspection. */
export function submissionBody(s: Submission): string {
  return JSON.stringify(s);
}

/** Size of the JSON body in bytes (UTF-8), as the server's body limit counts it. */
export function bodyBytes(body: string): number {
  return new TextEncoder().encode(body).length;
}

/**
 * From this size the body is sent gzipped. Base64 photos shrink by about a quarter, which on a
 * slow mobile upload saves seconds; small bodies are sent as they are.
 */
export const GZIP_FROM_BYTES = 64 * 1024;

/** The body gzipped by the browser itself, or null where CompressionStream is missing or fails. */
async function gzip(body: string): Promise<Uint8Array<ArrayBuffer> | null> {
  if (typeof CompressionStream !== 'function') return null;
  try {
    const stream = new Response(body).body!.pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await res.json();
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The non-empty `fields` list of a 400 answer, if it has one. */
function namedFields(body: Record<string, unknown> | null): string[] | undefined {
  const fields = body?.fields;
  return Array.isArray(fields) && fields.length > 0 && fields.every((f) => typeof f === 'string')
    ? (fields as string[])
    : undefined;
}

/**
 * Never throws. No network is `offline`; no answer within `timeoutMs` (default: see
 * sendTimeoutMs) is `traag`. A large body goes gzipped (`gzip: false` turns that off). The
 * same-origin `Origin` header the server checks is added by the browser itself.
 */
export async function submitInspection(
  s: Submission,
  opts: { timeoutMs?: number; gzip?: boolean } = {},
): Promise<SubmitResult> {
  const json = submissionBody(s);
  const size = bodyBytes(json);
  // Packing happens on the phone, before the clock for the upload starts.
  const packed = opts.gzip !== false && size >= GZIP_FROM_BYTES ? await gzip(json) : null;
  const ctrl = new AbortController();
  let timedOut = false;
  // The timeout still allows for the unpacked size: a little extra room on a slow line.
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, opts.timeoutMs ?? sendTimeoutMs(size));
  const post = (gz: Uint8Array<ArrayBuffer> | null) =>
    fetch('/api/inspecties', {
      method: 'POST',
      headers: gz
        ? { 'content-type': 'application/json', 'content-encoding': 'gzip' }
        : { 'content-type': 'application/json' },
      body: gz ?? json,
      signal: ctrl.signal,
    });
  try {
    let res: Response;
    try {
      res = await post(packed);
      // A server or proxy that cannot read gzip answers 415, or 400 without naming a field (a
      // real validation error always names one): then once more, unpacked.
      if (packed && (res.status === 415 || (res.status === 400 && namedFields(await readJson(res.clone())) === undefined))) {
        res = await post(null);
      }
    } catch {
      return { outcome: timedOut ? 'traag' : 'offline' };
    }
    switch (res.status) {
      case 200:
        // Only our server's own answer counts as sent: a wifi login page can also answer 200,
        // and taking that as sent would drop the inspection from the outbox.
        return (await readJson(res))?.status === 'verzonden' ? { outcome: 'verzonden' } : { outcome: 'onbekend' };
      case 400: {
        const fields = namedFields(await readJson(res));
        return fields ? { outcome: 'ongeldig', fields } : { outcome: 'ongeldig' };
      }
      case 413:
        return { outcome: 'te_groot' };
      case 429:
        return { outcome: 'te_veel' };
      case 502:
        return { outcome: 'mail_mislukt' };
      default:
        return { outcome: 'onbekend' };
    }
  } finally {
    clearTimeout(timer);
  }
}
