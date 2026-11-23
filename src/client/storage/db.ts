// On-device storage in IndexedDB: the one in-progress draft, the outbox of signed but
// unsent inspections, and the technician's name for next time.
import { createStore, del, delMany, get, set, update } from 'idb-keyval';
import type { Submission } from '@shared/schema';
import type { Draft } from '../state/draft';

const store = createStore('werkplekinspectie', 'kv');

const DRAFT = 'draft';
const OUTBOX = 'outbox';
/**
 * A new key forgets every name remembered before it: some people had typed the project as their
 * name. Bump the version again to make everyone fill in their name once more.
 */
const MONTEUR = 'monteur-v2';
const OLD_MONTEUR = ['monteur'];

const DRAFT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

let persistRequested = false;

/** Ask the browser once not to evict our data. Best-effort: never throws, never waits. */
function requestPersistence(): void {
  if (persistRequested) return;
  persistRequested = true;
  try {
    void navigator.storage?.persist?.()?.catch(() => undefined);
  } catch {
    // Not supported or not allowed: storage still works, just without the guarantee.
  }
}

export async function saveDraft(d: Draft): Promise<void> {
  requestPersistence();
  await set(DRAFT, d, store);
}

export async function loadDraft(): Promise<Draft | null> {
  return (await get<Draft>(DRAFT, store)) ?? null;
}

export async function clearDraft(): Promise<void> {
  await del(DRAFT, store);
}

/** Adds or replaces (by submissionId) in one read-modify-write transaction. */
export async function addToOutbox(s: Submission): Promise<void> {
  requestPersistence();
  await update<Submission[]>(
    OUTBOX,
    (old = []) => [...old.filter((o) => o.submissionId !== s.submissionId), s],
    store,
  );
}

export async function listOutbox(): Promise<Submission[]> {
  return (await get<Submission[]>(OUTBOX, store)) ?? [];
}

export async function removeFromOutbox(id: string): Promise<void> {
  await update<Submission[]>(OUTBOX, (old = []) => old.filter((o) => o.submissionId !== id), store);
}

/** Drops the in-progress draft after 14 days without changes. Never touches the outbox or the name. */
export async function purgeExpired(now: Date): Promise<void> {
  // One read-modify-write transaction, so a save racing with the purge is never lost.
  // An expired draft becomes `undefined`, which loadDraft reads as "no draft".
  await update<Draft | undefined>(
    DRAFT,
    (d) => (d && now.getTime() - Date.parse(d.updatedAt) > DRAFT_MAX_AGE_MS ? undefined : d),
    store,
  );
}

export async function getRememberedName(): Promise<string> {
  // Best-effort cleanup of the forgotten names; the answer does not depend on it.
  await delMany(OLD_MONTEUR, store).catch(() => undefined);
  return (await get<string>(MONTEUR, store)) ?? '';
}

export async function setRememberedName(n: string): Promise<void> {
  await set(MONTEUR, n, store);
}
