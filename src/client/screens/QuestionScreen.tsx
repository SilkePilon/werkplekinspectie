import { useEffect, useRef, useState } from 'react';
import { amsterdamDateKey } from '@shared/dates';
import { QUESTIONS, QUESTION_IDS, SECTIONS, type QuestionId } from '@shared/questions';
import { LIMITS } from '@shared/schema';
import type { DraftDispatch } from '../App';
import { missingFields, type AnswerValue, type Draft } from '../state/draft';
import { AnswerGroup } from '../ui/AnswerGroup';
import { ChunkyButton } from '../ui/ChunkyButton';
import { SectionIcon } from '../ui/SectionIcon';
import { TopBar } from '../ui/TopBar';
import { NeeSheet } from './NeeSheet';
import { NoteSheet } from './NoteSheet';

export interface QuestionScreenProps {
  draft: Draft;
  id: QuestionId;
  dispatch: DraftDispatch;
  /** Leave this question: the next one, or back to the summary. */
  onNext: () => void;
  /** The X: back to the start screen; the draft stays. */
  onClose: () => void;
}

/** Long enough to see the selected state, short enough not to feel slow. */
const ADVANCE_MS = 300;
/**
 * Taps on the answers are ignored this long after the question appears: the second half of a
 * double tap (on Ja, Verder gaan or Start) must not answer the next question by accident.
 */
const TAP_GUARD_MS = 300;

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export function QuestionScreen({ draft, id, dispatch, onNext, onClose }: QuestionScreenProps) {
  const index = QUESTION_IDS.indexOf(id);
  const question = QUESTIONS[index];
  const section = SECTIONS.find((s) => s.nr === question?.section);
  const value = draft.answers[id];
  const details = draft.nee[id];

  const [sheetOpen, setSheetOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const note = draft.notes?.[id] ?? '';
  // One pending advance at most: a second tap replaces it instead of adding another.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancelAdvance = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };
  useEffect(() => cancelAdvance, []);
  const settled = useRef(false);
  useEffect(() => {
    const t = setTimeout(() => {
      settled.current = true;
    }, TAP_GUARD_MS);
    return () => clearTimeout(t);
  }, []);

  if (!question || !section) throw new Error(`Onbekende vraag ${id}`);

  function answer(v: AnswerValue) {
    if (!settled.current) return;
    dispatch({ type: 'answer', id, value: v });
    cancelAdvance();
    if (v === 'nee') {
      setSheetOpen(true);
    } else if (prefersReducedMotion()) {
      onNext();
    } else {
      timer.current = setTimeout(() => {
        timer.current = undefined;
        onNext();
      }, ADVANCE_MS);
    }
  }

  function next() {
    cancelAdvance();
    // Nee without comment or date, a date before the inspection day, or too many photos.
    const prefix = `answers.${id}.`;
    if (value === 'nee' && missingFields(draft).some((p) => p.startsWith(prefix))) setSheetOpen(true);
    else onNext();
  }

  // Only photos that will be sent count: details of an item changed back to Ja/Nvt are dropped.
  const photosElsewhere = QUESTION_IDS.reduce(
    (n, q) => (q !== id && draft.answers[q] === 'nee' ? n + (draft.nee[q]?.photos.length ?? 0) : n),
    0,
  );
  const label = `Vraag ${index + 1} van ${QUESTION_IDS.length}`;

  return (
    <>
      <TopBar progress={(index + 1) / QUESTION_IDS.length} label={label} onClose={onClose} />

      <main className="flex flex-1 flex-col px-[18px] pt-[18px]">
        <p className="m-0 flex items-center gap-2 text-[15px] font-extrabold text-violet">
          <SectionIcon name={section.icon} />
          {section.title}
          <span aria-hidden="true" className="ml-auto font-bold text-sub">
            {label}
          </span>
        </p>
        <AnswerGroup className="mt-2.5" name={id} legend={question.appText} value={value} onChange={answer} />
        {/* Nee has its own comment in the Nee sheet; a note written before Nee carries over there. */}
        {value !== 'nee' && (
          <NoteControl
            note={note}
            onOpen={() => {
              // Writing a note stops a pending auto-advance: stay on this question.
              cancelAdvance();
              setNoteOpen(true);
            }}
          />
        )}
      </main>

      <footer className="px-[18px] pt-4 pb-[calc(22px+env(safe-area-inset-bottom))]">
        <ChunkyButton disabled={!value} onClick={next}>
          Volgende
        </ChunkyButton>
      </footer>

      <NoteSheet
        open={noteOpen}
        onOpenChange={setNoteOpen}
        text={note}
        onChange={(text) => dispatch({ type: 'note', id, text })}
        onDone={() => setNoteOpen(false)}
      />

      <NeeSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        details={details}
        minDate={amsterdamDateKey(draft.startedAt)}
        photosElsewhere={photosElsewhere}
        onChange={(d) => dispatch({ type: 'neeDetails', id, details: d })}
        onAddPhoto={(url) =>
          // Compression can finish after the answer was changed away from Nee: drop the photo then.
          dispatch((current) =>
            current.answers[id] === 'nee'
              ? {
                  type: 'neeDetails',
                  id,
                  details: { photos: [...(current.nee[id]?.photos ?? []), url].slice(0, LIMITS.photosPerItem) },
                }
              : null,
          )
        }
        onDone={() => {
          setSheetOpen(false);
          onNext();
        }}
      />
    </>
  );
}

/** "Opmerking toevoegen", or the note itself with "Aanpassen" once there is one. */
function NoteControl({ note, onOpen }: { note: string; onOpen: () => void }) {
  const text = note.trim();
  if (text === '') {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={
          'mt-3 flex min-h-12 items-center gap-2 self-start rounded-chunky px-1 text-[16px] font-black text-violet ' +
          'focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-violet enabled:active:opacity-70'
        }
      >
        <PencilIcon />
        Opmerking toevoegen
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className={
        'mt-3 flex w-full items-start justify-between gap-3 rounded-chunky border-2 border-b-5 border-grey bg-white px-3.5 py-3 text-left ' +
        'focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-violet ' +
        'enabled:active:translate-y-[3px] enabled:active:border-b-2 motion-safe:transition-transform'
      }
    >
      <span className="min-w-0">
        <span className="block text-[14px] font-extrabold text-sub">Opmerking</span>
        <span className="line-clamp-3 block text-[16px] font-bold break-words text-ink">{text}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1 text-[15px] font-black text-violet">
        <PencilIcon />
        Aanpassen
      </span>
    </button>
  );
}

function PencilIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}
