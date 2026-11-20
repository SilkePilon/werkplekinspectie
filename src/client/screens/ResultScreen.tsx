import { useEffect, useRef, type ReactNode, type Ref } from 'react';
import { QUESTION_IDS } from '@shared/questions';
import type { Submission } from '@shared/schema';
import type { SubmitOutcome } from '../api/submit';
import { ChunkyButton } from '../ui/ChunkyButton';
import { cn } from '../ui/cn';

export interface ResultScreenProps {
  outcome: SubmitOutcome;
  /** The inspection that was sent, or that waits in the outbox. */
  submission: Submission;
  /** A retry of this inspection is running. */
  busy: boolean;
  /** "Klaar", after Verstuurd!. */
  onDone: () => void;
  /** "Opnieuw proberen": the same stored inspection again. */
  onRetry: () => void;
  /** "Later versturen": to the start screen; the inspection stays in the outbox. */
  onLater: () => void;
  /** "Aanpassen", after the server refused the content. */
  onFix: () => void;
}

const NOT_SENT: Record<Exclude<SubmitOutcome, 'verzonden' | 'ongeldig'>, string> = {
  offline: 'Je hebt nu geen internet.',
  te_veel: 'Er zijn net te veel inspecties verstuurd. Probeer het over een kwartier opnieuw.',
  mail_mislukt: 'Versturen is niet gelukt. Probeer het later opnieuw.',
  onbekend: 'Versturen is niet gelukt. Probeer het later opnieuw.',
};

function stats(s: Submission) {
  let nee = 0;
  let photos = 0;
  for (const id of QUESTION_IDS) {
    const a = s.answers[id];
    if (a.answer === 'nee') {
      nee += 1;
      photos += a.photos.length;
    }
  }
  return { questions: QUESTION_IDS.length, nee, photos };
}

export function ResultScreen({ outcome, submission, busy, onDone, onRetry, onLater, onFix }: ResultScreenProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  // A new screen after waiting: move focus to its title so screen readers read the result.
  useEffect(() => heading.current?.focus(), [outcome]);

  if (outcome === 'verzonden') {
    const n = stats(submission);
    return (
      <Layout
        badge={<SentBadge />}
        title="Verstuurd!"
        headingRef={heading}
        footer={<ChunkyButton onClick={onDone}>Klaar</ChunkyButton>}
      >
        <p className="m-0 text-[17px] text-sub">De inspectie is gemaild naar de VGM-functionaris.</p>
        <ul aria-label="Samenvatting" className="m-0 mt-[26px] grid w-full list-none grid-cols-3 gap-2 p-0">
          <Stat value={n.questions} label="vragen" />
          <Stat value={n.nee} label="keer Nee" nee />
          <Stat value={n.photos} label="foto's" />
        </ul>
      </Layout>
    );
  }

  if (outcome === 'ongeldig') {
    return (
      <Layout
        badge={<NotSentBadge icon="alert" />}
        title="Nog niet verstuurd"
        headingRef={heading}
        footer={<ChunkyButton onClick={onFix}>Aanpassen</ChunkyButton>}
      >
        <p className="m-0 text-[17px] text-sub">Er klopt iets niet in de inspectie.</p>
      </Layout>
    );
  }

  return (
    <Layout
      badge={<NotSentBadge icon={outcome === 'offline' ? 'offline' : outcome === 'te_veel' ? 'clock' : 'alert'} />}
      title="Nog niet verstuurd"
      headingRef={heading}
      footer={
        <>
          <ChunkyButton busy={busy} onClick={onRetry}>
            Opnieuw proberen
          </ChunkyButton>
          <ChunkyButton variant="ghost" className="mt-1.5" disabled={busy} onClick={onLater}>
            Later versturen
          </ChunkyButton>
        </>
      }
    >
      <p className="m-0 mb-1.5 text-[17px] text-sub">{NOT_SENT[outcome]}</p>
      <p className="m-0 mt-[18px] flex items-center gap-2.5 rounded-[14px] bg-lila px-3.5 py-3 text-left text-[15px] font-bold text-violet">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
        Je inspectie staat veilig op deze telefoon. Er gaat niets verloren.
      </p>
    </Layout>
  );
}

interface LayoutProps {
  badge: ReactNode;
  title: string;
  headingRef: Ref<HTMLHeadingElement>;
  footer: ReactNode;
  children: ReactNode;
}

function Layout({ badge, title, headingRef, footer, children }: LayoutProps) {
  return (
    <>
      <main className="flex flex-1 flex-col items-center justify-center px-[26px] text-center">
        {badge}
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="mt-[30px] mb-2 text-[28px] font-black leading-[1.15] focus:outline-none"
        >
          {title}
        </h1>
        {children}
      </main>
      <footer className="px-[18px] pt-4 pb-[calc(22px+env(safe-area-inset-bottom))]">{footer}</footer>
    </>
  );
}

function Stat({ value, label, nee = false }: { value: number; label: string; nee?: boolean }) {
  return (
    <li className="rounded-[14px] border-2 border-grey px-1 pt-2.5 pb-2">
      <b className={cn('block text-[24px] font-black', nee && value > 0 && 'text-coral-d')}>{value}</b>
      <span className="text-[13px] text-sub">{label}</span>
    </li>
  );
}

function SentBadge() {
  return (
    <div aria-hidden="true" className="grid size-[118px] place-items-center rounded-full bg-violet text-white shadow-[0_8px_0_var(--color-violet-d)]">
      <svg viewBox="0 0 24 24" className="size-[62px]" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </div>
  );
}

const ICONS = {
  offline: (
    <path d="M2 8.8a15 15 0 0 1 4.2-2.6M10.7 5.1A15 15 0 0 1 22 8.8M5 12.9a10 10 0 0 1 5.2-2.8M19 12.9a10 10 0 0 0-2.1-1.6M8.5 16.4a5 5 0 0 1 7 0M12 20h.01M2 2l20 20" />
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5v.01" />
    </>
  ),
};

/** Calm grey, not coral: nothing is lost, it just has not gone out yet. */
function NotSentBadge({ icon }: { icon: keyof typeof ICONS }) {
  return (
    <div aria-hidden="true" className="grid size-[118px] place-items-center rounded-full border-4 border-grey bg-white text-sub shadow-[0_8px_0_var(--color-grey)]">
      <svg viewBox="0 0 24 24" className="size-14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        {ICONS[icon]}
      </svg>
    </div>
  );
}
