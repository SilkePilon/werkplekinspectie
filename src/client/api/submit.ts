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

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await res.json();
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Never throws. No network is `offline`; no answer within `timeoutMs` (default: see
 * sendTimeoutMs) is `traag`. The same-origin `Origin` header the server checks is added by
 * the browser itself.
 */
export async function submitInspection(s: Submission, opts: { timeoutMs?: number } = {}): Promise<SubmitResult> {
  const body = submissionBody(s);
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, opts.timeoutMs ?? sendTimeoutMs(bodyBytes(body)));
  try {
    let res: Response;
    try {
      res = await fetch('/api/inspecties', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: ctrl.signal,
      });
    } catch {
      return { outcome: timedOut ? 'traag' : 'offline' };
    }
    switch (res.status) {
      case 200:
        // Only our server's own answer counts as sent: a wifi login page can also answer 200,
        // and taking that as sent would drop the inspection from the outbox.
        return (await readJson(res))?.status === 'verzonden' ? { outcome: 'verzonden' } : { outcome: 'onbekend' };
      case 400: {
        const fields = (await readJson(res))?.fields;
        return Array.isArray(fields) && fields.every((f) => typeof f === 'string')
          ? { outcome: 'ongeldig', fields }
          : { outcome: 'ongeldig' };
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
