import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Submission } from '@shared/schema';
import { GZIP_FROM_BYTES, sendTimeoutMs, submitInspection } from '../../src/client/api/submit';

const SUB = { submissionId: '6a1f0c1e-0000-4000-8000-000000000001', project: 'Voorbeeld B.V.' } as Submission;

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
let fetchMock: ReturnType<typeof vi.fn<Fetch>>;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  fetchMock = vi.fn<Fetch>();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('POSTs the submission as JSON to /api/inspecties, without setting Origin by hand', async () => {
  fetchMock.mockResolvedValue(json(200, { status: 'verzonden' }));
  await submitInspection(SUB);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0]!;
  expect(url).toBe('/api/inspecties');
  expect(init?.method).toBe('POST');
  expect(init?.headers).toEqual({ 'content-type': 'application/json' });
  expect(JSON.parse(init?.body as string)).toEqual(SUB);
  expect(init?.signal).toBeInstanceOf(AbortSignal);
});

describe('maps the response to an outcome', () => {
  test.each([
    [200, { status: 'verzonden' }, 'verzonden'],
    [429, { status: 'te_veel' }, 'te_veel'],
    [502, { status: 'mail_mislukt' }, 'mail_mislukt'],
    [403, { status: 'verboden' }, 'onbekend'],
    [413, { status: 'te_groot' }, 'te_groot'],
    [415, { status: 'niet_ondersteund' }, 'onbekend'],
    [500, { status: 'onbekend' }, 'onbekend'],
    [503, {}, 'onbekend'],
  ] as const)('%i → %s', async (status, body, outcome) => {
    fetchMock.mockResolvedValue(json(status, body));
    expect(await submitInspection(SUB)).toEqual({ outcome });
  });

  test('400 → ongeldig, with the fields the server named', async () => {
    fetchMock.mockResolvedValue(json(400, { status: 'ongeldig', fields: ['answers.4B.comment', 'signature'] }));
    expect(await submitInspection(SUB)).toEqual({
      outcome: 'ongeldig',
      fields: ['answers.4B.comment', 'signature'],
    });
  });

  test('400 without a readable body → ongeldig without fields', async () => {
    fetchMock.mockResolvedValue(new Response('<html>', { status: 400 }));
    expect(await submitInspection(SUB)).toEqual({ outcome: 'ongeldig' });
  });

  test('a 200 that is not our server (e.g. a wifi login page) is not taken as sent', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Log in</html>', { status: 200 }));
    expect(await submitInspection(SUB)).toEqual({ outcome: 'onbekend' });
  });
});

test('a rejected fetch → offline', async () => {
  fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
  expect(await submitInspection(SUB)).toEqual({ outcome: 'offline' });
});

/** A fetch that never answers, but rejects like the browser once its signal aborts. */
function hangingFetch(onSignal: (s: AbortSignal | undefined) => void = () => undefined) {
  fetchMock.mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal ?? undefined;
        onSignal(signal);
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }),
  );
}

test('a fetch that hangs → traag after timeoutMs, and the request is aborted', async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  hangingFetch((s) => (signal = s));
  let result: unknown;
  void submitInspection(SUB, { timeoutMs: 5000 }).then((r) => (result = r));

  await vi.advanceTimersByTimeAsync(4999);
  expect(result).toBeUndefined();
  expect(signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(signal?.aborted).toBe(true);
  expect(result).toEqual({ outcome: 'traag' });
});

describe('sendTimeoutMs', () => {
  test('30 s plus 1 s per 25 kB of body, at most 180 s', () => {
    expect(sendTimeoutMs(0)).toBe(30_000);
    expect(sendTimeoutMs(25_000)).toBe(31_000);
    expect(sendTimeoutMs(2_500_000)).toBe(130_000);
    expect(sendTimeoutMs(3_750_000)).toBe(180_000);
    expect(sendTimeoutMs(12_000_000)).toBe(180_000);
  });
});

test('the default timeout grows with the body: a 2.5 MB inspection gets about 130 s', async () => {
  vi.useFakeTimers();
  hangingFetch();
  const big = { ...SUB, project: 'x'.repeat(2_500_000) } as Submission;
  const limit = sendTimeoutMs(new TextEncoder().encode(JSON.stringify(big)).length);
  expect(limit).toBeGreaterThan(130_000);
  let result: unknown;
  void submitInspection(big, { gzip: false }).then((r) => (result = r));
  await vi.advanceTimersByTimeAsync(limit - 1);
  expect(result).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1);
  expect(result).toEqual({ outcome: 'traag' });
});

test('the default timeout is never longer than 180 s', async () => {
  vi.useFakeTimers();
  hangingFetch();
  let result: unknown;
  void submitInspection({ ...SUB, project: 'x'.repeat(11_000_000) } as Submission, { gzip: false }).then(
    (r) => (result = r),
  );
  await vi.advanceTimersByTimeAsync(179_999);
  expect(result).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1);
  expect(result).toEqual({ outcome: 'traag' });
});

test('a small inspection still gets 30 s', async () => {
  vi.useFakeTimers();
  hangingFetch();
  let result: unknown;
  void submitInspection(SUB).then((r) => (result = r));
  await vi.advanceTimersByTimeAsync(29_999);
  expect(result).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(result).toEqual({ outcome: 'traag' });
});

describe('large bodies go gzipped', () => {
  const BIG = { ...SUB, project: 'x'.repeat(GZIP_FROM_BYTES) } as Submission;
  const unpack = (init: RequestInit | undefined) =>
    JSON.parse(gunzipSync(init?.body as Uint8Array).toString('utf8')) as unknown;

  test('from GZIP_FROM_BYTES on: Content-Encoding gzip, and the body inflates to the submission', async () => {
    fetchMock.mockResolvedValue(json(200, { status: 'verzonden' }));
    expect(await submitInspection(BIG)).toEqual({ outcome: 'verzonden' });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.headers).toEqual({ 'content-type': 'application/json', 'content-encoding': 'gzip' });
    expect(init?.body).toBeInstanceOf(Uint8Array);
    expect((init?.body as Uint8Array).length).toBeLessThan(GZIP_FROM_BYTES / 10);
    expect(unpack(init)).toEqual(BIG);
  });

  test('below GZIP_FROM_BYTES, or with gzip: false, the JSON goes as it is', async () => {
    fetchMock.mockResolvedValue(json(200, { status: 'verzonden' }));
    await submitInspection(SUB);
    await submitInspection(BIG, { gzip: false });
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.headers).toEqual({ 'content-type': 'application/json' });
      expect(typeof init?.body).toBe('string');
    }
  });

  test.each([
    ['415', () => json(415, { status: 'niet_ondersteund' })],
    ['400 naming no field', () => json(400, { status: 'ongeldig', fields: [] })],
    ['400 without a readable body', () => new Response('<html>', { status: 400 })],
  ])('a server that cannot read gzip (%s): sent once more, unpacked', async (_name, refusal) => {
    fetchMock.mockResolvedValueOnce(refusal()).mockResolvedValueOnce(json(200, { status: 'verzonden' }));
    expect(await submitInspection(BIG)).toEqual({ outcome: 'verzonden' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, retry] = fetchMock.mock.calls[1]!;
    expect(retry?.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(retry?.body as string)).toEqual(BIG);
  });

  test('a 400 that names fields is a real refusal: not sent again', async () => {
    fetchMock.mockResolvedValue(json(400, { status: 'ongeldig', fields: ['answers.4B.comment'] }));
    expect(await submitInspection(BIG)).toEqual({ outcome: 'ongeldig', fields: ['answers.4B.comment'] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
