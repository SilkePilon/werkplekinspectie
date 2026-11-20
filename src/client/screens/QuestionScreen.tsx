import { useEffect, useRef, useState } from 'react';
import { amsterdamDateKey } from '@shared/dates';
import { QUESTIONS, QUESTION_IDS, SECTIONS, type QuestionId } from '@shared/questions';
import { LIMITS } from '@shared/schema';
import type { DraftDispatch } from '../App';
import type { AnswerValue, Draft } from '../state/draft';
import { AnswerGroup } from '../ui/AnswerGroup';
import { ChunkyButton } from '../ui/ChunkyButton';
import { SectionIcon } from '../ui/SectionIcon';
import { TopBar } from '../ui/TopBar';
import { NeeSheet } from './NeeSheet';

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

const blank = (s: string | undefined) => !s || s.trim() === '';

export function QuestionScreen({ draft, id, dispatch, onNext, onClose }: QuestionScreenProps) {
  const index = QUESTION_IDS.indexOf(id);
  const question = QUESTIONS[index];
  const section = SECTIONS.find((s) => s.nr === question?.section);
  const value = draft.answers[id];
  const details = draft.nee[id];

  const [sheetOpen, setSheetOpen] = useState(false);
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
    if (value === 'nee' && (blank(details?.comment) || blank(details?.actionBefore))) setSheetOpen(true);
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
      </main>

      <footer className="px-[18px] pt-4 pb-[calc(22px+env(safe-area-inset-bottom))]">
        <ChunkyButton disabled={!value} onClick={next}>
          Volgende
        </ChunkyButton>
      </footer>

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
