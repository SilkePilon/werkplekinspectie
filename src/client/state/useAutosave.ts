import { useCallback, useEffect, useRef, useState } from 'react';
import { saveDraft } from '../storage/db';
import type { Draft } from './draft';

const AUTOSAVE_MS = 300;

/**
 * Saves ~300ms after the last change, and at once when asked (page hidden, unmount).
 * `failed` stays true from a failed save until the next one succeeds.
 *
 * Only the newest save may report back: an older save that finishes late never changes
 * `failed` and never queues a retry. `cancel()` (after sending or Weggooien) makes every save
 * still running count as old, and nothing is saved again until the next `schedule()`.
 * `onSaved` is told about every current save that worked, with the draft written.
 */
export function useAutosave(onSaved?: (d: Draft) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<Draft | null>(null);
  // The newest draft handed to schedule(): what a retry after a failed save must write.
  const latest = useRef<Draft | null>(null);
  // Bumped by every save that starts and by cancel(); a save is current while it matches.
  const seq = useRef(0);
  const [failed, setFailed] = useState(false);
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const d = pending.current;
    pending.current = null;
    if (!d) return;
    const mine = ++seq.current;
    saveDraft(d).then(
      () => {
        if (mine !== seq.current) return;
        setFailed(false);
        onSavedRef.current?.(d);
      },
      () => {
        if (mine !== seq.current) return;
        // Storage full or blocked. Retry at the next flush with the newest draft.
        pending.current ??= latest.current;
        setFailed(true);
      },
    );
  }, []);

  const schedule = useCallback(
    (d: Draft) => {
      pending.current = d;
      latest.current = d;
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, AUTOSAVE_MS);
    },
    [flush],
  );

  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    pending.current = null;
    latest.current = null;
    seq.current += 1;
    setFailed(false);
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, [flush]);

  return { schedule, cancel, failed };
}
