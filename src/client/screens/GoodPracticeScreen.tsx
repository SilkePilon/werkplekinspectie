import { useId } from 'react';
import { LIMITS } from '@shared/schema';
import type { DraftDispatch } from '../App';
import type { Draft } from '../state/draft';
import { ChunkyButton } from '../ui/ChunkyButton';
import { TopBar } from '../ui/TopBar';

export interface GoodPracticeScreenProps {
  draft: Draft;
  dispatch: DraftDispatch;
  /** Opened again from the summary: then it is not "one more question". */
  fromSummary: boolean;
  /** On to the summary. */
  onNext: () => void;
  onClose: () => void;
}

const QUESTION = 'Wat gaat hier goed? Waar kan de rest van het bedrijf van leren?';

/** The open question of the paper form, after the 21 questions. */
export function GoodPracticeScreen({ draft, dispatch, fromSummary, onNext, onClose }: GoodPracticeScreenProps) {
  const ids = { question: useId(), hint: useId() };

  return (
    <>
      <TopBar progress={0.9} label="Bijna klaar" onClose={onClose} />

      <main className="flex flex-1 flex-col px-[18px] pt-[18px]">
        {!fromSummary && (
          <p className="m-0 flex items-center gap-2 text-[15px] font-extrabold text-violet">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[22px] shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10z" />
            </svg>
            Nog één vraag
          </p>
        )}
        <h1 id={ids.question} className="mt-2.5 mb-[18px] text-[25px] font-black leading-[1.2] tracking-[-.005em]">
          {QUESTION}
        </h1>
        <textarea
          aria-labelledby={ids.question}
          aria-describedby={ids.hint}
          value={draft.goodPractice}
          maxLength={LIMITS.goodPractice}
          rows={6}
          onChange={(e) => dispatch({ type: 'goodPractice', text: e.target.value })}
          className={
            'block min-h-[150px] w-full resize-y rounded-chunky border-2 border-grey bg-[#f7f7f7] p-3.5 text-[17px] font-bold text-ink ' +
            'focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-violet'
          }
        />
        <p id={ids.hint} className="mx-0.5 mt-2.5 mb-0 text-[15px] text-sub">
          Mag kort. Je mag dit ook overslaan.
        </p>
      </main>

      <footer className="flex flex-col gap-1.5 px-[18px] pt-4 pb-[calc(22px+env(safe-area-inset-bottom))]">
        <ChunkyButton onClick={onNext}>Volgende</ChunkyButton>
        <ChunkyButton
          variant="ghost"
          className="min-h-12"
          onClick={() => {
            dispatch({ type: 'goodPractice', text: '' });
            onNext();
          }}
        >
          Overslaan
        </ChunkyButton>
      </footer>
    </>
  );
}
