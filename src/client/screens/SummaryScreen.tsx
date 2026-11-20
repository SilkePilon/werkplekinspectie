import { useEffect, useId, useRef, type ReactNode, type Ref } from 'react';
import { formatDayShort } from '@shared/dates';
import { QUESTIONS, SECTIONS, type QuestionId, type Section } from '@shared/questions';
import { counts, missingFields, type AnswerValue, type Draft } from '../state/draft';
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
  onClose: () => void;
}

const LABELS: Record<AnswerValue, string> = { ja: 'Ja', nee: 'Nee', nvt: 'Nvt' };

/** "2 × Ja, 1 × Nee": only the answers that occur. */
function sectionCounts(draft: Draft, section: Section): string {
  const c = { ja: 0, nee: 0, nvt: 0 };
  for (const q of QUESTIONS) {
    const value = draft.answers[q.id];
    if (q.section === section.nr && value) c[value] += 1;
  }
  return (['ja', 'nee', 'nvt'] as const)
    .filter((v) => c[v] > 0)
    .map((v) => `${c[v]} × ${LABELS[v]}`)
    .join(', ');
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

export function SummaryScreen({
  draft,
  onEdit,
  onEditGoodPractice,
  highlight,
  tooLarge = false,
  onNext,
  onClose,
}: SummaryScreenProps) {
  const ids = { nee: useId(), all: useId(), why: useId() };
  const total = counts(draft);
  const incomplete = incompleteQuestions(draft);
  const neeQuestions = QUESTIONS.filter((q) => draft.answers[q.id] === 'nee');
  // The highlight sits on the Nee card when there is one, else on the section row.
  const highlightOnCard = highlight !== undefined && draft.answers[highlight] === 'nee';
  const marked = useRef<HTMLElement>(null);
  useEffect(() => marked.current?.scrollIntoView?.({ block: 'center' }), []);

  return (
    <>
      <TopBar progress={0.95} label="Bijna klaar" onClose={onClose} />

      <main className="flex flex-1 flex-col px-[18px] pt-1">
        <h1 className="mt-2 mb-1 text-[26px] font-black leading-[1.15]">Klopt alles?</h1>
        {tooLarge && (
          <p
            role="alert"
            className="mt-2 mb-0 rounded-chunky border-2 border-coral bg-roze px-3.5 py-3 text-[15px] font-extrabold text-coral-d"
          >
            De inspectie is te groot om te versturen. Verwijder een paar foto&apos;s.
          </p>
        )}
        <ul className="m-0 mt-3 mb-4 flex list-none gap-2 p-0">
          {(['ja', 'nee', 'nvt'] as const).map((v) => (
            <li
              key={v}
              className={cn(
                'rounded-full border-2 border-grey px-3 py-1 text-[14px] font-extrabold',
                v === 'nee' && total.nee > 0 && 'border-coral bg-roze text-coral-d',
              )}
            >
              {`${total[v]} × ${LABELS[v]}`}
            </li>
          ))}
        </ul>

        {neeQuestions.length > 0 && (
          <section aria-labelledby={ids.nee}>
            <SectionTitle id={ids.nee}>Niet in orde</SectionTitle>
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
              {neeQuestions.map((q) => (
                <NeeCard
                  key={q.id}
                  draft={draft}
                  id={q.id}
                  text={q.appText}
                  incomplete={incomplete.has(q.id)}
                  highlighted={highlightOnCard && q.id === highlight}
                  markRef={marked}
                  onEdit={onEdit}
                />
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby={ids.all}>
          <SectionTitle id={ids.all}>Alle onderdelen</SectionTitle>
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {SECTIONS.map((s) => {
              const questions = QUESTIONS.filter((q) => q.section === s.nr);
              const open = questions.find((q) => incomplete.has(q.id));
              const flagged = !highlightOnCard ? questions.find((q) => q.id === highlight) : undefined;
              return (
                <li key={s.nr}>
                  {/* An incomplete or highlighted section opens at the question that needs work. */}
                  <Row
                    title={`${s.nr} ${s.title}`}
                    highlighted={flagged !== undefined}
                    markRef={marked}
                    onClick={() => onEdit((open ?? flagged ?? questions[0]!).id)}
                  >
                    {sectionCounts(draft, s)}
                    {open && <NotComplete />}
                    {flagged && <LookAgain />}
                  </Row>
                </li>
              );
            })}
            <li>
              <Row title="Wat gaat hier goed?" highlighted={false} onClick={onEditGoodPractice}>
                <span className="line-clamp-2">{draft.goodPractice.trim() || 'Niet ingevuld'}</span>
              </Row>
            </li>
          </ul>
        </section>
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

function SectionTitle({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="mx-0.5 mt-4 mb-2 text-[15px] font-black text-sub">
      {children}
    </h2>
  );
}

interface NeeCardProps {
  draft: Draft;
  id: QuestionId;
  text: string;
  incomplete: boolean;
  highlighted: boolean;
  markRef: Ref<HTMLElement>;
  onEdit: (id: QuestionId) => void;
}

function NeeCard({ draft, id, text, incomplete, highlighted, markRef, onEdit }: NeeCardProps) {
  const titleId = useId();
  const details = draft.nee[id];
  const comment = details?.comment.trim() ?? '';
  const meta = [
    details?.actionBefore ? `Vóór ${formatDayShort(details.actionBefore)}` : null,
    photoCount(details?.photos.length ?? 0),
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <li
      ref={highlighted ? (markRef as Ref<HTMLLIElement>) : undefined}
      className={cn(
        'rounded-chunky border-2 border-b-5 border-coral bg-roze px-3.5 py-3',
        highlighted && 'outline-solid outline-3 outline-offset-2 outline-coral-d',
      )}
    >
      <p id={titleId} className="m-0 text-[17px] font-black leading-[1.25]">
        {`${id} ${text}`}
      </p>
      {comment && <p className="mt-1 mb-0 text-[15px] break-words">{comment}</p>}
      {incomplete && <NotComplete />}
      {highlighted && <LookAgain />}
      <div className="mt-2 flex items-center justify-between gap-3 text-[14px] font-extrabold text-coral-d">
        <span>{meta}</span>
        <button
          type="button"
          aria-describedby={titleId}
          onClick={() => onEdit(id)}
          className="-my-2 -mr-2 flex min-h-11 items-center gap-1 rounded-chunky px-2 text-[15px] font-black text-violet focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-violet"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
          </svg>
          Aanpassen
        </button>
      </div>
    </li>
  );
}

/** Icon plus text: the state never depends on colour alone. */
function NotComplete() {
  return (
    <span className="mt-1.5 flex items-center gap-1.5 text-[15px] font-extrabold text-coral-d">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5v5.5M12 16.5v.01" />
      </svg>
      Nog niet compleet
    </span>
  );
}

/** Where the server found a problem. Icon plus text, like NotComplete. */
function LookAgain() {
  return (
    <span className="mt-1.5 flex items-center gap-1.5 text-[15px] font-extrabold text-coral-d">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      Kijk hier nog eens naar.
    </span>
  );
}

interface RowProps {
  title: string;
  highlighted: boolean;
  markRef?: Ref<HTMLElement>;
  onClick: () => void;
  children: ReactNode;
}

function Row({ title, highlighted, markRef, onClick, children }: RowProps) {
  return (
    <button
      type="button"
      ref={highlighted ? (markRef as Ref<HTMLButtonElement>) : undefined}
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between gap-3 rounded-chunky border-2 border-b-5 bg-white px-3.5 py-3 text-left',
        highlighted ? 'border-coral' : 'border-grey',
        'focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-violet',
        'enabled:active:translate-y-[3px] enabled:active:border-b-2 motion-safe:transition-transform',
      )}
    >
      <span className="min-w-0">
        <span className="block text-[17px] font-black">{title}</span>
        <span className="block text-[14px] font-bold text-sub">{children}</span>
      </span>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[22px] shrink-0 text-mute" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="m9 18 6-6-6-6" />
      </svg>
    </button>
  );
}
