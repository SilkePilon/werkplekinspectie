import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { newDraft, type Draft } from '../../src/client/state/draft';
import { useAutosave } from '../../src/client/state/useAutosave';
import { saveDraft } from '../../src/client/storage/db';

vi.mock('../../src/client/storage/db', () => ({ saveDraft: vi.fn() }));

function deferred() {
  let resolve: () => void = () => undefined;
  let reject: (e: unknown) => void = () => undefined;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const draft = (project: string): Draft => newDraft('J. Jansen', project, 'P-1', new Date());

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(saveDraft).mockReset();
});

test('a failed older save never overwrites a newer one', async () => {
  const a = draft('A');
  const b = draft('B');
  const saveA = deferred();
  const saveB = deferred();
  vi.mocked(saveDraft)
    .mockReturnValueOnce(saveA.promise)
    .mockReturnValueOnce(saveB.promise)
    .mockResolvedValue(undefined);
  const { result, unmount } = renderHook(() => useAutosave());

  act(() => result.current.schedule(a));
  await act(() => vi.advanceTimersByTimeAsync(300));
  act(() => result.current.schedule(b));
  await act(() => vi.advanceTimersByTimeAsync(300));
  expect(vi.mocked(saveDraft).mock.calls).toEqual([[a], [b]]);

  // A fails while B is still being written; then B succeeds.
  await act(async () => saveA.reject(new DOMException('Quota exceeded', 'QuotaExceededError')));
  expect(result.current.failed).toBe(true);
  await act(async () => saveB.resolve());
  expect(result.current.failed).toBe(false);

  // A later flush (here: unmount) may retry, but only with the newest draft.
  unmount();
  const later = vi.mocked(saveDraft).mock.calls.slice(2);
  expect(later.every(([d]) => d === b)).toBe(true);
});

test('a failed save is retried at the next flush', async () => {
  const a = draft('A');
  vi.mocked(saveDraft).mockRejectedValueOnce(new Error('blocked')).mockResolvedValue(undefined);
  const { result } = renderHook(() => useAutosave());

  act(() => result.current.schedule(a));
  await act(() => vi.advanceTimersByTimeAsync(300));
  expect(result.current.failed).toBe(true);

  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  try {
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
  } finally {
    Reflect.deleteProperty(document, 'visibilityState');
  }
  expect(vi.mocked(saveDraft).mock.calls).toEqual([[a], [a]]);
  expect(result.current.failed).toBe(false);
});
