import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Submission } from '@shared/schema';
import { submitInspection } from '../../src/client/api/submit';

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
    [413, { status: 'te_groot' }, 'onbekend'],
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

test('a fetch that hangs → offline after timeoutMs, and the request is aborted', async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  fetchMock.mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        signal = init?.signal ?? undefined;
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }),
  );
  let result: unknown;
  void submitInspection(SUB, { timeoutMs: 5000 }).then((r) => (result = r));

  await vi.advanceTimersByTimeAsync(4999);
  expect(result).toBeUndefined();
  expect(signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(signal?.aborted).toBe(true);
  expect(result).toEqual({ outcome: 'offline' });
});

test('the default timeout is 30 seconds', async () => {
  vi.useFakeTimers();
  fetchMock.mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }),
  );
  let result: unknown;
  void submitInspection(SUB).then((r) => (result = r));
  await vi.advanceTimersByTimeAsync(29_999);
  expect(result).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1);
  expect(result).toEqual({ outcome: 'offline' });
});
