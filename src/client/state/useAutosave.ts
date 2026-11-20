import { useCallback, useEffect, useRef, useState } from 'react';
import { saveDraft } from '../storage/db';
import type { Draft } from './draft';

const AUTOSAVE_MS = 300;

/**
 * Saves ~300ms after the last change, and at once when asked (page hidden, unmount).
 * `failed` stays true from a failed save until the next one succeeds.
 */
export function useAutosave() {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<Draft | null>(null);
  // The newest draft handed to schedule(): what a retry after a failed save must write.
  const latest = useRef<Draft | null>(null);
  const [failed, setFailed] = useState(false);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const d = pending.current;
    pending.current = null;
    if (!d) return;
    saveDraft(d).then(
      () => setFailed(false),
      () => {
        // Storage full or blocked. Retry at the next flush with the newest draft, never with
        // `d`: a newer save may already be on its way, and `d` must not overwrite it.
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
