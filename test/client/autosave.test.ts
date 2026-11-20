import 'fake-indexeddb/auto';
import { act, renderHook } from '@testing-library/react';
import { clear, createStore } from 'idb-keyval';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { newDraft, type Draft } from '../../src/client/state/draft';
import { useAutosave } from '../../src/client/state/useAutosave';
import * as db from '../../src/client/storage/db';
import { clearDraft, loadDraft, saveDraft } from '../../src/client/storage/db';

vi.mock('../../src/client/storage/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/client/storage/db')>()),
  saveDraft: vi.fn(),
}));

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

async function hidePage() {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  try {
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
  } finally {
    Reflect.deleteProperty(document, 'visibilityState');
  }
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(saveDraft).mockReset();
});

test('a failed older save never overwrites a newer one, and does not count as the current state', async () => {
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

  // A fails while B is still being written: B is what counts, so no alarm and no retry yet.
  await act(async () => saveA.reject(new DOMException('Quota exceeded', 'QuotaExceededError')));
  expect(result.current.failed).toBe(false);
  await act(async () => saveB.resolve());
  expect(result.current.failed).toBe(false);

  // B is on disk: a later flush (here: unmount) has nothing to write.
  unmount();
  expect(vi.mocked(saveDraft).mock.calls.slice(2)).toEqual([]);
});

test('a late success of an older save never hides a newer failure', async () => {
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

  await act(async () => saveB.reject(new DOMException('Quota exceeded', 'QuotaExceededError')));
  expect(result.current.failed).toBe(true);
  await act(async () => saveA.resolve());
  expect(result.current.failed).toBe(true);

  // The retry writes the newest draft, once.
  unmount();
  const later = vi.mocked(saveDraft).mock.calls.slice(2);
  expect(later).toEqual([[b]]);
});

test('a failed save is retried at the next flush', async () => {
  const a = draft('A');
  vi.mocked(saveDraft).mockRejectedValueOnce(new Error('blocked')).mockResolvedValue(undefined);
  const { result } = renderHook(() => useAutosave());

  act(() => result.current.schedule(a));
  await act(() => vi.advanceTimersByTimeAsync(300));
  expect(result.current.failed).toBe(true);

  await hidePage();
  expect(vi.mocked(saveDraft).mock.calls).toEqual([[a], [a]]);
  expect(result.current.failed).toBe(false);
});

test('cancel drops a pending save: nothing is written until the next change', async () => {
  vi.mocked(saveDraft).mockResolvedValue(undefined);
  const { result, unmount } = renderHook(() => useAutosave());

  act(() => result.current.schedule(draft('A')));
  act(() => result.current.cancel());
  await act(() => vi.advanceTimersByTimeAsync(1000));
  await hidePage();
  unmount();
  expect(saveDraft).not.toHaveBeenCalled();
});

test('after cancel, a save that was in flight and then fails is not retried and raises no alarm', async () => {
  const a = draft('A');
  const saveA = deferred();
  vi.mocked(saveDraft).mockReturnValueOnce(saveA.promise).mockResolvedValue(undefined);
  const { result, unmount } = renderHook(() => useAutosave());

  act(() => result.current.schedule(a));
  await act(() => vi.advanceTimersByTimeAsync(300));
  act(() => result.current.cancel());
  await act(async () => saveA.reject(new Error('blocked')));
  expect(result.current.failed).toBe(false);

  await hidePage();
  unmount();
  expect(vi.mocked(saveDraft).mock.calls).toEqual([[a]]);
});

test('after cancel, a save that was in flight and then succeeds does not clear a newer alarm', async () => {
  const a = draft('A');
  const b = draft('B');
  const saveA = deferred();
  vi.mocked(saveDraft)
    .mockReturnValueOnce(saveA.promise)
    .mockRejectedValueOnce(new Error('blocked'))
    .mockResolvedValue(undefined);
  const { result, unmount } = renderHook(() => useAutosave());

  act(() => result.current.schedule(a));
  await act(() => vi.advanceTimersByTimeAsync(300));
  act(() => result.current.cancel());
  act(() => result.current.schedule(b));
  await act(() => vi.advanceTimersByTimeAsync(300));
  expect(result.current.failed).toBe(true);
  await act(async () => saveA.resolve());
  expect(result.current.failed).toBe(true);
  unmount();
  expect(vi.mocked(saveDraft).mock.calls).toEqual([[a], [b], [b]]);
});

test('save in flight + cancel + clearDraft: the draft stays cleared on disk', async () => {
  // Real IndexedDB here. fake-indexeddb runs on setImmediate, so use real timers.
  vi.useRealTimers();
  await clear(createStore('werkplekinspectie', 'kv'));
  const real = await vi.importActual<typeof db>('../../src/client/storage/db');
  vi.mocked(saveDraft).mockImplementation(real.saveDraft);
  const { result, unmount } = renderHook(() => useAutosave());

  act(() => result.current.schedule(draft('A')));
  await hidePage(); // starts the save; it has not finished yet
  expect(saveDraft).toHaveBeenCalledTimes(1);
  act(() => result.current.cancel());
  await clearDraft();

  // Every later chance to save (page hidden again, unmount) writes nothing.
  await hidePage();
  unmount();
  await new Promise((r) => setTimeout(r, 50));
  expect(saveDraft).toHaveBeenCalledTimes(1);
  expect(await loadDraft()).toBeNull();
});
