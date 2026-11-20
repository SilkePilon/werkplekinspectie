// Abuse and duplicate protection for the submit route.

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
