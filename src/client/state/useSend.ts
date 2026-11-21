// Sending a signed inspection, retrying from the outbox, and taking a refused one back.
// The order of the steps is what keeps work safe: see sendDraft.
import { useCallback, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { QUESTION_IDS, type QuestionId } from '@shared/questions';
import { LIMITS } from '@shared/limits';
import type { Submission } from '@shared/schema';
import type { Screen } from '../App';
import { bodyBytes, submissionBody, submitInspection, type SubmitOutcome } from '../api/submit';
import { addToOutbox, clearDraft, removeFromOutbox, saveDraft } from '../storage/db';
import { IncompleteDraftError, draftFromSubmission, draftReducer, toSubmission, type Draft } from './draft';

export interface SendDeps {
  /** The latest draft, also after an await. */
  draftRef: RefObject<Draft | null>;
  commit: (d: Draft | null) => void;
  /** Autosave. */
  schedule: (d: Draft) => void;
  cancelAutosave: () => void;
  navigate: (s: Screen) => void;
  setOutbox: Dispatch<SetStateAction<Submission[]>>;
}

export interface LastSend {
  submission: Submission;
  outcome: SubmitOutcome;
  fields?: string[];
}

/**
 * `answers.4B.comment` and `answers.4B.photos.3` → `4B`. Paths without a question id
 * (`answers` for the photo total, `signature`, `(body)`) → undefined.
 */
function questionOf(field: string): QuestionId | undefined {
  const id = /^answers\.([^.]+)/.exec(field)?.[1];
  return QUESTION_IDS.find((q) => q === id);
}

/** The first question the server named, skipping fields that name none. */
function firstQuestion(fields: string[] | undefined): QuestionId | undefined {
  return (fields ?? []).map(questionOf).find((id) => id !== undefined);
}

export function useSend({ draftRef, commit, schedule, cancelAutosave, navigate, setOutbox }: SendDeps) {
  // Set before the first await, so a second tap in the same moment finds it set.
  const inFlight = useRef(false);
  // Only while the open draft itself is being sent: App then drops changes to it.
  const draftLocked = useRef(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  // Writing to the phone's storage failed while sending; App shows the save-failed alert
  // until a later save works (noteSaved).
  const [storeFailed, setStoreFailed] = useState(false);
  // The draft saved right after the failure: its save working says nothing, sending still failed.
  const failedDraft = useRef<Draft | null>(null);
  const [last, setLast] = useState<LastSend | null>(null);

  const isDraftLocked = useCallback(() => draftLocked.current, []);

  /**
   * Runs one send at a time; a call while one runs is dropped. An unexpected error shows the
   * save-failed alert instead of escaping as an unhandled rejection.
   */
  const exclusive = useCallback((id: string, work: () => Promise<void>, lockDraft = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    draftLocked.current = lockDraft;
    setSendingId(id);
    void work()
      .catch(() => setStoreFailed(true))
      .finally(() => {
        inFlight.current = false;
        draftLocked.current = false;
        setSendingId(null);
      });
  }, []);

  const dropFromOutbox = useCallback(
    (id: string) =>
      removeFromOutbox(id).then(
        () => setOutbox((o) => o.filter((s) => s.submissionId !== id)),
        // Still on the phone, so it stays in the list. Sending it again is harmless: the
        // server knows this submissionId.
        () => undefined,
      ),
    [setOutbox],
  );

  /** POSTs a stored submission as it is, and shows the result. */
  const post = useCallback(
    /** `alongside`: work that runs during the upload and must be done before the result shows. */
    async (sub: Submission, alongside: Promise<unknown> = Promise.resolve()) => {
      const { outcome, fields } = await submitInspection(sub);
      // The result screen only shows once all is done, so its buttons work straight away.
      await alongside;
      if (outcome === 'verzonden') await dropFromOutbox(sub.submissionId);
      setLast({ submission: sub, outcome, fields });
      navigate({ name: 'result', outcome, submissionId: sub.submissionId });
    },
    [dropFromOutbox, navigate],
  );

  /**
   * "Verstuur inspectie". Sign; build the submission; check it fits the body limit; put it in
   * the outbox; only then clear the draft; send. Killing the app at any point leaves the inspection either in the draft or in
   * the outbox. If the outbox write fails, the draft stays and nothing is sent.
   */
  const sendDraft = useCallback(
    (signature: string, signedAt: string) => {
      const current = draftRef.current;
      if (!current) return;
      exclusive(
        current.id,
        async () => {
          // No autosave may run from here: a late one could bring back the draft cleared below.
          cancelAutosave();
          const signed = draftReducer(current, { type: 'sign', signature, at: signedAt });
          commit(signed);
          let queued = false;
          try {
            let sub: Submission;
            try {
              sub = toSubmission(signed);
            } catch (err) {
              if (!(err instanceof IncompleteDraftError)) throw err;
              schedule(signed);
              navigate({ name: 'summary' });
              return;
            }
            // The server would refuse it (413) and it would sit in the outbox: say so now.
            if (bodyBytes(submissionBody(sub)) > LIMITS.bodyBytes) {
              schedule(signed);
              navigate({ name: 'summary', tooLarge: true });
              return;
            }
            try {
              await addToOutbox(sub);
            } catch {
              failedDraft.current = signed;
              schedule(signed);
              setStoreFailed(true);
              return;
            }
            queued = true;
            setStoreFailed(false);
            setOutbox((o) => [...o.filter((s) => s.submissionId !== sub.submissionId), sub]);
            // The outbox has it now, so clearing the draft runs alongside the upload instead of
            // before it. If clearing fails, the leftover draft has the same submissionId; the
            // server mails an id once.
            await post(sub, clearDraft().catch(() => undefined));
            if (draftRef.current?.id === sub.submissionId) commit(null);
          } catch (err) {
            // Not expected. Until the outbox has it, the draft is the only copy: keep saving it.
            if (!queued) {
              failedDraft.current = signed;
              schedule(signed);
            }
            throw err;
          }
        },
        true,
      );
    },
    [draftRef, exclusive, cancelAutosave, commit, schedule, navigate, setOutbox, post],
  );

  /** "Opnieuw proberen" and "Nu versturen": the stored submission, unchanged. */
  const resend = useCallback((sub: Submission) => exclusive(sub.submissionId, () => post(sub)), [exclusive, post]);

  /**
   * "Aanpassen" after the server refused it: back into the draft (to be signed again), out of
   * the outbox, to the summary with the first named question highlighted. Never overwrites a
   * different inspection that is still open; then nothing happens and it stays in the outbox.
   */
  const fix = useCallback(
    (sub: Submission, fields: string[] | undefined) =>
      exclusive(sub.submissionId, async () => {
        // The result screen says to finish or discard the other inspection first.
        const open = draftRef.current;
        if (open && open.id !== sub.submissionId) return;
        const d = draftFromSubmission(sub);
        cancelAutosave();
        try {
          await saveDraft(d);
        } catch {
          failedDraft.current = null;
          setStoreFailed(true);
          return;
        }
        setStoreFailed(false);
        await dropFromOutbox(sub.submissionId);
        commit(d);
        const highlight = firstQuestion(fields);
        navigate(highlight ? { name: 'summary', highlight } : { name: 'summary' });
      }),
    [exclusive, draftRef, navigate, cancelAutosave, dropFromOutbox, commit],
  );

  /** For autosave: a draft other than the one saved right after the failure was written fine. */
  const noteSaved = useCallback((d: Draft) => {
    if (d !== failedDraft.current) setStoreFailed(false);
  }, []);

  return { sendDraft, resend, fix, isDraftLocked, sendingId, storeFailed, noteSaved, last };
}
