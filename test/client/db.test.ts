import 'fake-indexeddb/auto';
import { clear, createStore } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Submission } from '@shared/schema';
import { newDraft, toIsoWithOffset, type Draft } from '../../src/client/state/draft';
import {
  addToOutbox,
  clearDraft,
  getRememberedName,
  listOutbox,
  loadDraft,
  purgeExpired,
  removeFromOutbox,
  saveDraft,
  setRememberedName,
} from '../../src/client/storage/db';

const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
const SIGNATURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-20T08:00:00Z');

function draftUpdatedAt(updated: Date): Draft {
  return { ...newDraft('J. Jansen', 'X', 'P-1', updated), updatedAt: toIsoWithOffset(updated) };
}

function submission(id: string): Submission {
  return { submissionId: id, monteur: 'J. Jansen', project: id } as Submission;
}

// Reset the whole store between tests through a second handle on the same database.
beforeEach(async () => {
  await clear(createStore('werkplekinspectie', 'kv'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('draft', () => {
  test('loadDraft is null when nothing is saved', async () => {
    expect(await loadDraft()).toBeNull();
  });

  test('a saved draft round-trips including photos and signature', async () => {
    const d: Draft = {
      ...newDraft('J. Jansen', 'Voorbeeld B.V.', 'P-1', NOW),
      answers: { '1A': 'ja', '4B': 'nee' },
      nee: { '4B': { comment: 'Sticker verlopen', actionBefore: '2026-11-27', photos: [PHOTO, PHOTO] } },
      signature: SIGNATURE,
      signedAt: '2026-11-20T09:40:00+01:00',
    };
    await saveDraft(d);
    expect(await loadDraft()).toStrictEqual(d);
  });

  test('saving again replaces the draft; clearDraft removes it', async () => {
    await saveDraft(newDraft('a', 'b', 'c', NOW));
    const second = newDraft('d', 'e', 'f', NOW);
    await saveDraft(second);
    expect((await loadDraft())?.id).toBe(second.id);
    await clearDraft();
    expect(await loadDraft()).toBeNull();
  });
});

describe('outbox', () => {
  test('is empty by default and keeps insertion order', async () => {
    expect(await listOutbox()).toEqual([]);
    await addToOutbox(submission('a'));
    await addToOutbox(submission('b'));
    expect((await listOutbox()).map((s) => s.submissionId)).toEqual(['a', 'b']);
  });

  test('adding the same submissionId twice keeps one copy (the latest)', async () => {
    await addToOutbox(submission('a'));
    await addToOutbox({ ...submission('a'), project: 'nieuw' });
    expect(await listOutbox()).toEqual([{ ...submission('a'), project: 'nieuw' }]);
  });

  test('parallel adds do not lose items', async () => {
    await Promise.all(['a', 'b', 'c'].map((id) => addToOutbox(submission(id))));
    expect((await listOutbox()).map((s) => s.submissionId).sort()).toEqual(['a', 'b', 'c']);
  });

  test('removeFromOutbox removes only that id', async () => {
    await addToOutbox(submission('a'));
    await addToOutbox(submission('b'));
    await addToOutbox(submission('c'));
    await removeFromOutbox('b');
    expect((await listOutbox()).map((s) => s.submissionId)).toEqual(['a', 'c']);
    await removeFromOutbox('zzz');
    expect((await listOutbox()).map((s) => s.submissionId)).toEqual(['a', 'c']);
  });
});

describe('purgeExpired', () => {
  test('a 15-day-old draft is cleared; 2 outbox items and the name are kept', async () => {
    await saveDraft(draftUpdatedAt(new Date(NOW.getTime() - 15 * DAY)));
    await addToOutbox(submission('a'));
    await addToOutbox(submission('b'));
    await setRememberedName('J. Jansen');
    await purgeExpired(NOW);
    expect(await loadDraft()).toBeNull();
    expect(await listOutbox()).toHaveLength(2);
    expect(await getRememberedName()).toBe('J. Jansen');
  });

  test('a draft updated 13 days ago is kept', async () => {
    const d = draftUpdatedAt(new Date(NOW.getTime() - 13 * DAY));
    await saveDraft(d);
    await purgeExpired(NOW);
    expect(await loadDraft()).toStrictEqual(d);
  });

  test('without a draft it is a no-op', async () => {
    await purgeExpired(NOW);
    expect(await loadDraft()).toBeNull();
  });
});

describe('remembered name', () => {
  test("defaults to '' and survives clearDraft", async () => {
    expect(await getRememberedName()).toBe('');
    await setRememberedName('J. Jansen');
    await saveDraft(newDraft('J. Jansen', 'X', 'P-1', NOW));
    await clearDraft();
    expect(await getRememberedName()).toBe('J. Jansen');
  });
});

describe('persistent storage', () => {
  async function freshDb() {
    vi.resetModules();
    return import('../../src/client/storage/db');
  }

  // jsdom has no navigator.storage, so define it per test and remove it afterwards.
  function setStorage(value: unknown) {
    Object.defineProperty(navigator, 'storage', { configurable: true, value });
  }

  function stubStorage(persist: () => Promise<boolean>) {
    const spy = vi.fn(persist);
    setStorage({ persist: spy });
    return spy;
  }

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'storage');
  });

  test('asks for persistent storage once', async () => {
    const persist = stubStorage(() => Promise.resolve(true));
    const db = await freshDb();
    await db.saveDraft(newDraft('a', 'b', 'c', NOW));
    await db.saveDraft(newDraft('a', 'b', 'c', NOW));
    await db.addToOutbox(submission('a'));
    expect(persist).toHaveBeenCalledTimes(1);
  });

  test('a rejecting or throwing persist() never breaks saving', async () => {
    stubStorage(() => Promise.reject(new Error('nope')));
    let db = await freshDb();
    await expect(db.saveDraft(newDraft('a', 'b', 'c', NOW))).resolves.toBeUndefined();

    stubStorage(() => {
      throw new Error('nope');
    });
    db = await freshDb();
    await expect(db.addToOutbox(submission('a'))).resolves.toBeUndefined();
  });

  test('works without navigator.storage', async () => {
    expect('storage' in navigator).toBe(false);
    const db = await freshDb();
    await expect(db.saveDraft(newDraft('a', 'b', 'c', NOW))).resolves.toBeUndefined();
  });
});
