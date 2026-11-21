import { useEffect, useRef, useState } from 'react';
import { amsterdamDateKey, formatDayLong, formatDayWeekday } from '@shared/dates';
import { QUESTIONS, QUESTION_IDS, SECTIONS, type QuestionId } from '@shared/questions';
import { LIMITS } from '@shared/limits';
import type { DraftDispatch } from '../App';
import { missingFields, type AnswerValue, type Draft, type NeeDetails } from '../state/draft';
import { cn } from '../ui/cn';
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
  /** One step back in the form; left out on the first question. */
  onBack?: () => void;
  onClose: () => void;
}

/**
 * Taps on the answers are ignored this long after the question appears: the second half of a
 * double tap (on Volgende, Verder gaan or Start) must not answer the new question by accident.
 */
const TAP_GUARD_MS = 300;

export function QuestionScreen({ draft, id, dispatch, onNext, onBack, onClose }: QuestionScreenProps) {
  const index = QUESTION_IDS.indexOf(id);
  const question = QUESTIONS[index];
  const section = SECTIONS.find((s) => s.nr === question?.section);
  const value = draft.answers[id];
  const details = draft.nee[id];

  const [sheetOpen, setSheetOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const note = draft.notes?.[id] ?? '';
  const settled = useRef(false);
  useEffect(() => {
    const t = setTimeout(() => {
      settled.current = true;
    }, TAP_GUARD_MS);
    return () => clearTimeout(t);
  }, []);

  if (!question || !section) throw new Error(`Onbekende vraag ${id}`);

  /** Picking an answer never moves on by itself: the technician taps Volgende. */
  function answer(v: AnswerValue) {
    if (!settled.current) return;
    dispatch({ type: 'answer', id, value: v });
    if (v === 'nee') setSheetOpen(true);
  }

  // Nee without comment or date, a date before the inspection day, or too many photos.
  const prefix = `answers.${id}.`;
  const neeIncomplete = value === 'nee' && missingFields(draft).some((p) => p.startsWith(prefix));

  function next() {
    if (neeIncomplete) setSheetOpen(true);
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
      <TopBar
        progress={(index + 1) / QUESTION_IDS.length}
        label={label}
        onBack={onBack}
        onClose={onClose}
      />

      <main className="flex flex-1 flex-col px-[18px] pt-[18px]">
        <p className="m-0 flex items-center gap-2 text-[15px] font-extrabold text-brand-d">
          <SectionIcon name={section.icon} />
          {section.title}
          <span aria-hidden="true" className="ml-auto font-bold text-sub">
            {label}
          </span>
        </p>
        <AnswerGroup className="mt-2.5" name={id} legend={question.appText} value={value} onChange={answer} />
        {/* Nee has its own comment in the Nee sheet; a note written before Nee carries over there. */}
        {value === 'nee' ? (
          // Shown once the sheet is closed: what was filled in, so it is clear it is kept.
          !sheetOpen && <NeeSummary details={details} incomplete={neeIncomplete} onOpen={() => setSheetOpen(true)} />
        ) : (
          <NoteControl note={note} onOpen={() => setNoteOpen(true)} />
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
        // Doorgaan closes the sheet; moving on is Volgende, as for every answer.
        onDone={() => setSheetOpen(false)}
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
          '-ml-1 mt-3 flex min-h-12 items-center gap-2 self-start rounded-chunky px-2 text-[16px] font-black text-brand-d ' +
          'focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-brand-d ' +
          'enabled:hover:bg-brand-l enabled:active:opacity-70 motion-safe:transition-colors'
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
        'enabled:hover:border-grey-d enabled:hover:bg-[#fafafa] ' +
        'focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-brand-d ' +
        'enabled:active:translate-y-[3px] enabled:active:border-b-2 motion-safe:transition-[translate,background-color,border-color]'
      }
    >
      <span className="min-w-0">
        <span className="block text-[14px] font-extrabold text-sub">Opmerking</span>
        <span className="line-clamp-3 block text-[16px] font-bold break-words text-ink">{text}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1 text-[15px] font-black text-brand-d">
        <PencilIcon />
        Aanpassen
      </span>
    </button>
  );
}

const photoCount = (n: number) => (n === 1 ? '1 foto' : `${n} foto's`);

/**
 * After Nee: what is wrong, the date and the photos, as the Opmerking card shows a note.
 * The whole card opens the Nee sheet again. Something missing is said in words, not colour only.
 */
function NeeSummary({
  details,
  incomplete,
  onOpen,
}: {
  details: NeeDetails | undefined;
  incomplete: boolean;
  onOpen: () => void;
}) {
  const comment = details?.comment.trim() ?? '';
  const date = details?.actionBefore ?? '';
  const photos = details?.photos ?? [];
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'mt-3 flex w-full flex-col gap-2 rounded-chunky border-2 border-b-5 bg-white px-3.5 py-3 text-left',
        incomplete ? 'border-coral' : 'border-grey enabled:hover:border-grey-d',
        'enabled:hover:bg-[#fafafa] focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-brand-d',
        'enabled:active:translate-y-[3px] enabled:active:border-b-2 motion-safe:transition-[translate,background-color,border-color]',
        'motion-safe:animate-rise',
      )}
    >
      <span className="flex w-full items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-[14px] font-extrabold text-sub">Wat is er mis?</span>
          <span className="line-clamp-3 block text-[16px] font-bold break-words text-ink">
            {comment || <span className="text-sub">Nog niet ingevuld</span>}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[15px] font-black text-brand-d">
          <PencilIcon />
          Aanpassen
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[15px] font-extrabold text-ink">
        <span className="flex items-center gap-1.5">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[18px] shrink-0 text-sub" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="18" height="16" rx="3" />
            <path d="M3 10h18M8 3v4M16 3v4" />
          </svg>
          {date ? (
            <>
              <span className="sr-only">{`Opgelost vóór ${formatDayLong(date)}`}</span>
              <span aria-hidden="true">{`Vóór ${formatDayWeekday(date)}`}</span>
            </>
          ) : (
            <span className="text-sub">Geen datum</span>
          )}
        </span>
        {photos.length > 0 && (
          <span className="flex items-center gap-1.5">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[18px] shrink-0 text-sub" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
              <circle cx="12" cy="13" r="3" />
            </svg>
            {photoCount(photos.length)}
          </span>
        )}
      </span>
      {photos.length > 0 && (
        <span aria-hidden="true" className="flex gap-2">
          {photos.map((src, i) => (
            <img key={i} src={src} alt="" className="size-12 rounded-lg border-2 border-grey object-cover" />
          ))}
        </span>
      )}
      {incomplete && (
        <span className="flex items-center gap-1.5 text-[15px] font-extrabold text-coral-d">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7.5v5.5M12 16.5v.01" />
          </svg>
          Nog niet compleet. Tik om af te maken.
        </span>
      )}
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
