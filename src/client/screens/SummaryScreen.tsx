import { useEffect, useId, useRef, type ReactNode, type Ref } from 'react';
import { QUESTIONS, SECTIONS, type Question, type QuestionId } from '@shared/questions';
import { missingFields, type Draft } from '../state/draft';
import { ChunkyButton } from '../ui/ChunkyButton';
import { cn } from '../ui/cn';
import { TopBar } from '../ui/TopBar';

export interface SummaryScreenProps {
  draft: Draft;
  /** Opens a question; after changing it the app comes back here. */
  onEdit: (id: QuestionId) => void;
  onEditGoodPractice: () => void;
  /** A question to point out: the server said something is wrong with it. */
  highlight?: QuestionId;
  /** Sending stopped: the inspection is too large, photos must go. */
  tooLarge?: boolean;
  /** "Alles klopt, naar tekenen". */
  onNext: () => void;
  /** One step back in the form (the arrow at the top). */
  onBack?: () => void;
  onClose: () => void;
}

/** Questions that still need work: not answered, or Nee without comment or date. */
function incompleteQuestions(draft: Draft): Set<QuestionId> {
  const ids = new Set<QuestionId>();
  for (const path of missingFields(draft)) {
    const id = /^answers\.(\w+)/.exec(path)?.[1];
    if (id) ids.add(id as QuestionId);
  }
  return ids;
}

const photoCount = (n: number) => (n === 1 ? '1 foto' : `${n} foto's`);

type Tone = 'ok' | 'nee' | 'nvt' | 'open' | 'none';

interface Summary {
  tone: Tone;
  text: string;
  /** The question a tap opens: what needs work first, else a Nee, else the first one. */
  target: QuestionId;
}

/** One part of the form in a few words: open beats Nee beats In orde. */
function summarize(draft: Draft, questions: Question[], incomplete: Set<QuestionId>, highlight?: QuestionId): Summary {
  const open = questions.find((q) => incomplete.has(q.id));
  const flagged = questions.find((q) => q.id === highlight);
  const nee = questions.filter((q) => draft.answers[q.id] === 'nee');
  const target = (open ?? flagged ?? nee[0] ?? questions[0]!).id;
  if (open) return { tone: 'open', text: 'Nog niet af', target };
  if (flagged) return { tone: 'open', text: 'Kijk nog eens', target };
  if (nee.length > 0) return { tone: 'nee', text: `${nee.length} niet in orde`, target };
  if (questions.every((q) => draft.answers[q.id] === 'nvt')) return { tone: 'nvt', text: 'Nvt', target };
  return { tone: 'ok', text: 'In orde', target };
}

/**
 * "Klopt alles?": one tile per part of the form, with a summary in a few words, so the whole
 * inspection fits on one screen. A tile opens the question that needs a look; after a change
 * the app comes back here.
 */
export function SummaryScreen({
  draft,
  onEdit,
  onEditGoodPractice,
  highlight,
  tooLarge = false,
  onNext,
  onBack,
  onClose,
}: SummaryScreenProps) {
  const ids = { why: useId() };
  const incomplete = incompleteQuestions(draft);
  const marked = useRef<HTMLButtonElement>(null);
  useEffect(() => marked.current?.scrollIntoView?.({ block: 'center' }), []);

  const goodText = draft.goodPractice.trim();
  const goodPhotos = draft.goodPracticePhotos?.length ?? 0;
  const good =
    goodText && goodPhotos ? `Ingevuld · ${photoCount(goodPhotos)}` : goodText ? 'Ingevuld' : goodPhotos ? photoCount(goodPhotos) : 'Niet ingevuld';

  return (
    <>
      <TopBar progress={0.95} label="Bijna klaar" onBack={onBack} onClose={onClose} />

      <main className="flex flex-1 flex-col px-[18px] pt-1 pb-2">
        <h1 className="mt-2 mb-1 text-[26px] font-black leading-[1.15]">Klopt alles?</h1>
        <p className="m-0 text-[16px] text-sub">Tik op een onderdeel om het te veranderen.</p>

        {tooLarge && (
          <p
            role="alert"
            className="mt-3 mb-0 rounded-chunky border-2 border-coral bg-roze px-3.5 py-3 text-[15px] font-extrabold text-coral-d motion-safe:animate-rise"
          >
            De inspectie is te groot om te versturen. Verwijder een paar foto&apos;s.
          </p>
        )}

        <ul className="m-0 mt-4 grid list-none grid-cols-2 gap-2.5 p-0">
          {SECTIONS.map((s) => {
            const sum = summarize(draft, QUESTIONS.filter((q) => q.section === s.nr), incomplete, highlight);
            return (
              <li key={s.nr} className="flex">
                <Tile
                  title={s.title}
                  tone={sum.tone}
                  status={sum.text}
                  markRef={sum.target === highlight ? marked : undefined}
                  onClick={() => onEdit(sum.target)}
                />
              </li>
            );
          })}
          <li className="flex">
            <Tile title="Wat gaat hier goed?" tone="none" status={good} onClick={onEditGoodPractice} />
          </li>
        </ul>
      </main>

      <footer className="sticky bottom-0 bg-white px-[18px] pt-4 pb-[calc(22px+env(safe-area-inset-bottom))]">
        {incomplete.size > 0 && (
          <p id={ids.why} className="mt-0 mb-3 text-[15px] font-extrabold text-coral-d">
            {incomplete.size === 1
              ? 'Nog 1 punt is niet compleet. Maak dat eerst af.'
              : `Nog ${incomplete.size} punten zijn niet compleet. Maak die eerst af.`}
          </p>
        )}
        <ChunkyButton
          disabled={incomplete.size > 0}
          aria-describedby={incomplete.size > 0 ? ids.why : undefined}
          onClick={onNext}
        >
          Alles klopt, naar tekenen
        </ChunkyButton>
      </footer>
    </>
  );
}

// Every tile is plain white; only the summary line takes the colour of the Ja / Nee / Nvt answers.
const STATUS: Record<Tone, string> = {
  ok: 'text-brand-d',
  nee: 'text-coral-d',
  nvt: 'text-sub',
  open: 'text-coral-d',
  none: 'text-sub',
};

const MARK: Record<Tone, string> = {
  ok: 'bg-brand text-white',
  nee: 'bg-coral text-white',
  nvt: 'border-2 border-grey-d bg-white text-ink',
  open: 'bg-coral text-white',
  none: '',
};

const MARK_PATH: Record<Tone, ReactNode> = {
  ok: <path d="M20 6 9 17l-5-5" />,
  nee: <path d="M6 6l12 12M18 6L6 18" />,
  nvt: <path d="M6 12h12" />,
  open: <path d="M12 6v7M12 17.5v.01" />,
  none: null,
};

interface TileProps {
  title: string;
  tone: Tone;
  status: string;
  markRef?: Ref<HTMLButtonElement>;
  onClick: () => void;
}

/** A part of the form: its name and, below it, how it went. Sinks when pressed, like the answers. */
function Tile({ title, tone, status, markRef, onClick }: TileProps) {
  return (
    <button
      type="button"
      ref={markRef}
      onClick={onClick}
      className={cn(
        'flex min-h-[78px] w-full flex-col justify-between gap-1.5 rounded-chunky border-2 border-b-5 px-3 py-2.5 text-left',
        'focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-brand-d',
        'border-grey bg-white hover:border-grey-d hover:bg-[#fafafa]',
        'active:translate-y-[3px] active:border-b-2 motion-safe:transition-[translate,background-color,border-color]',
      )}
    >
      <span className="text-[16px] font-black leading-tight break-words text-ink hyphens-auto">{title}</span>
      <span className={cn('flex items-center gap-1.5 text-[14px] font-extrabold leading-tight', STATUS[tone])}>
        {tone !== 'none' && (
          <span aria-hidden="true" className={cn('grid size-5 shrink-0 place-items-center rounded-[6px]', MARK[tone])}>
            <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round">
              {MARK_PATH[tone]}
            </svg>
          </span>
        )}
        {status}
      </span>
    </button>
  );
}
