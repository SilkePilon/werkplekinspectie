// Sends a signed inspection to the server and turns the answer into one of a few outcomes
// the result screen knows how to explain.
import type { Submission } from '@shared/schema';

export type SubmitOutcome = 'verzonden' | 'offline' | 'te_veel' | 'ongeldig' | 'mail_mislukt' | 'onbekend';

export interface SubmitResult {
  outcome: SubmitOutcome;
  /** Only for `ongeldig`: dotted paths the server named, such as `answers.4B.comment`. */
  fields?: string[];
}

const TIMEOUT_MS = 30_000;

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await res.json();
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Never throws. No network, or no answer within `timeoutMs` (default 30 s), is `offline`.
 * The same-origin `Origin` header the server checks is added by the browser itself.
 */
export async function submitInspection(s: Submission, opts: { timeoutMs?: number } = {}): Promise<SubmitResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch('/api/inspecties', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(s),
        signal: ctrl.signal,
      });
    } catch {
      return { outcome: 'offline' };
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
