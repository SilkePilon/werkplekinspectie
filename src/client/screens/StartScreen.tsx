import { useId, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { formatDate } from '@shared/dates';
import { QUESTION_IDS } from '@shared/questions';
import { LIMITS, type Submission } from '@shared/schema';
import type { Draft } from '../state/draft';
import { useIosHint } from '../state/useIosHint';
import { ChunkyButton } from '../ui/ChunkyButton';
import { Sheet } from '../ui/Sheet';

export interface StartFields {
  monteur: string;
  project: string;
  projectnummer: string;
  /** Honeypot value; people never see the field. */
  website: string;
}

export interface StartScreenProps {
  hasLogo: boolean;
  rememberedName: string;
  /** The unfinished inspection, if any. */
  draft: Draft | null;
  outbox: readonly Submission[];
  onStart: (fields: StartFields) => void;
  onResume: () => void;
  onDiscard: () => void;
  /** "Nu versturen" on an outbox item. */
  onSendNow: (s: Submission) => void;
  /** The outbox item being sent right now, if any. Starting or resuming waits for it. */
  sendingId: string | null;
  /** The phone got internet back since the app opened. */
  backOnline: boolean;
  /** A new app version is waiting. Only this screen offers it, never mid-inspection. */
  updateAvailable: boolean;
  /** "Vernieuwen": activate the new version and reload. */
  onUpdate: () => void;
}

// scroll-mb: a field focused under the sticky Start button is scrolled up past it.
const inputClass =
  'block w-full min-h-[52px] scroll-mb-[150px] rounded-chunky border-2 border-grey bg-[#f7f7f7] px-3.5 py-3 text-[17px] font-bold text-ink ' +
  'focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-brand-d';

export function StartScreen({
  hasLogo,
  rememberedName,
  draft,
  outbox,
  onStart,
  onResume,
  onDiscard,
  onSendNow,
  sendingId,
  backOnline,
  updateAvailable,
  onUpdate,
}: StartScreenProps) {
  const [monteur, setMonteur] = useState(rememberedName);
  const [editName, setEditName] = useState(rememberedName === '');
  const [project, setProject] = useState('');
  const [projectnummer, setProjectnummer] = useState('');
  const [website, setWebsite] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [iosHint, dismissIosHint] = useIosHint();
  const ids = { naam: useId(), project: useId(), nummer: useId(), hint: useId(), outbox: useId() };

  const complete = [monteur, project, projectnummer].every((v) => v.trim() !== '');
  // While an outbox item is sent, its result screen opens when it is done: don't start
  // something that would be interrupted.
  const sending = sendingId !== null;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!complete || draft || sending) return;
    onStart({ monteur: monteur.trim(), project: project.trim(), projectnummer: projectnummer.trim(), website });
  }

  return (
    <form className="flex flex-1 flex-col" onSubmit={submit} noValidate>
      <header className="px-[18px] pt-[22px]">
        {hasLogo && <img src="/api/branding/logo" alt="" className="block h-[30px] w-auto" />}
        <h1 className={hasLogo ? 'sr-only' : 'm-0 text-[18px] font-black text-brand-d'}>Werkplekinspectie</h1>
      </header>

      <main className="flex flex-1 flex-col px-[18px] pt-[18px]">
        {updateAvailable && (
          <Notice role="status" action="Vernieuwen" onAction={onUpdate}>
            Er is een nieuwe versie.
          </Notice>
        )}
        {iosHint && (
          <Notice action="Oké" onAction={dismissIosHint}>
            Tip: zet de app op je beginscherm via Delen → Zet op beginscherm.
          </Notice>
        )}
        {outbox.length > 0 && backOnline && (
          <p
            role="status"
            className="m-0 mb-3 flex items-center gap-2.5 rounded-chunky bg-brand-l px-3.5 py-3 text-[15px] font-extrabold text-brand-d"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.6a10 10 0 0 1 14 0M8.5 16.1a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0M12 20h.01" />
            </svg>
            Je hebt weer internet. Je kunt je inspecties nu versturen.
          </p>
        )}
        {outbox.length > 0 && (
          <section aria-labelledby={ids.outbox} className="mb-6 rounded-chunky border-2 border-coral bg-roze p-4">
            <h2 id={ids.outbox} className="m-0 mb-3 text-[18px] font-black text-coral-d">
              Nog te versturen
            </h2>
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {outbox.map((s) => (
                <li key={s.submissionId} className="flex flex-col gap-2">
                  <span className="font-bold break-words">{`${s.project}, ${formatDate(s.startedAt)}`}</span>
                  <ChunkyButton
                    variant="line"
                    busy={sendingId === s.submissionId}
                    disabled={sending}
                    onClick={() => onSendNow(s)}
                  >
                    Nu versturen
                  </ChunkyButton>
                </li>
              ))}
            </ul>
          </section>
        )}

        {rememberedName && !editName ? (
          <div className="mt-2.5 mb-1 flex items-center justify-between gap-3">
            <p className="m-0 text-[30px] font-black leading-[1.1]">Hoi {rememberedName}!</p>
            {/* The name belongs to a new inspection; the open draft keeps its own. */}
            {!draft && (
              <ChunkyButton
                variant="ghost"
                className="min-h-11 w-auto px-2"
                aria-label="Naam aanpassen"
                onClick={() => setEditName(true)}
              >
                Aanpassen
              </ChunkyButton>
            )}
          </div>
        ) : null}

        {draft ? (
          <section className="mt-4 rounded-chunky border-2 border-b-5 border-grey p-4">
            <h2 className="m-0 text-[20px] font-black leading-tight">Je bent nog bezig met een inspectie</h2>
            <p className="mt-1 mb-4 text-sub">
              {draft.project} · {Object.keys(draft.answers).length} van {QUESTION_IDS.length} vragen gedaan
            </p>
            <div className="flex flex-col gap-3">
              <ChunkyButton disabled={sending} onClick={onResume}>
                Verder gaan
              </ChunkyButton>
              <ChunkyButton variant="line" onClick={() => setConfirmDiscard(true)}>
                Weggooien
              </ChunkyButton>
            </div>
          </section>
        ) : (
          <>
            <p className="mt-0 mb-[22px] text-sub">Waar doe je vandaag de inspectie?</p>
            {editName && (
              <Field id={ids.naam} label="Naam">
                <input
                  id={ids.naam}
                  className={inputClass}
                  value={monteur}
                  maxLength={LIMITS.monteur}
                  autoComplete="name"
                  enterKeyHint="next"
                  onKeyDown={(e) => focusOnEnter(e, ids.project)}
                  onChange={(e) => setMonteur(e.target.value)}
                />
              </Field>
            )}
            <Field id={ids.project} label="Project">
              <input
                id={ids.project}
                className={inputClass}
                value={project}
                maxLength={LIMITS.project}
                autoComplete="off"
                enterKeyHint="next"
                onKeyDown={(e) => focusOnEnter(e, ids.nummer)}
                onChange={(e) => setProject(e.target.value)}
              />
            </Field>
            <Field id={ids.nummer} label="Projectnummer">
              <input
                id={ids.nummer}
                className={inputClass}
                value={projectnummer}
                maxLength={LIMITS.projectnummer}
                autoComplete="off"
                enterKeyHint="go"
                onChange={(e) => setProjectnummer(e.target.value)}
              />
            </Field>
            {/*
              Honeypot: off-screen and skipped by keyboard and screen readers; bots fill it in. It is
              sent as `website`, but the input has a meaningless name and opts out of password
              managers, so autofill never fills it for a real technician.
            */}
            <input
              name="hp_ref"
              id="hp_ref"
              tabIndex={-1}
              autoComplete="off"
              data-1p-ignore=""
              data-lpignore="true"
              data-bwignore=""
              data-form-type="other"
              aria-hidden="true"
              className="absolute -left-[9999px] size-px opacity-0"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
            <p className="mt-1.5 text-[15px] text-sub">21 korte vragen. Duurt ongeveer 5 minuten.</p>
          </>
        )}
      </main>

      {!draft && (
        // Sticky above the keyboard: Start stays in sight while typing, without scrolling.
        <footer className="sticky bottom-[var(--keyboard-inset,0px)] z-10 bg-white px-[18px] pt-4 pb-[calc(22px+env(safe-area-inset-bottom))]">
          <ChunkyButton
            type="submit"
            disabled={!complete || sending}
            aria-describedby={complete ? undefined : ids.hint}
          >
            Start inspectie
          </ChunkyButton>
          {!complete && (
            <p id={ids.hint} className="mt-2 mb-0 text-center text-[15px] text-sub">
              Vul eerst alle velden in.
            </p>
          )}
        </footer>
      )}

      <Sheet open={confirmDiscard} onOpenChange={setConfirmDiscard} title="Inspectie weggooien?">
        <p className="mt-0 mb-5 text-sub">Al je antwoorden en foto&apos;s van deze inspectie worden gewist.</p>
        <div className="flex flex-col gap-3">
          <ChunkyButton
            variant="coral"
            onClick={() => {
              setConfirmDiscard(false);
              onDiscard();
            }}
          >
            Weggooien
          </ChunkyButton>
          <ChunkyButton variant="line" onClick={() => setConfirmDiscard(false)}>
            Terug
          </ChunkyButton>
        </div>
      </Sheet>
    </form>
  );
}

function Notice({
  role,
  action,
  onAction,
  children,
}: {
  role?: 'status';
  action: string;
  onAction: () => void;
  children: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center gap-3 rounded-chunky bg-brand-l px-3.5 py-3">
      <p role={role} className="m-0 flex-1 text-[15px] font-extrabold text-brand-d">
        {children}
      </p>
      <ChunkyButton variant="line" className="min-h-11 w-auto shrink-0 px-4" onClick={onAction}>
        {action}
      </ChunkyButton>
    </div>
  );
}

/** The keyboard's "Volgende" key goes to the next field instead of submitting the form. */
function focusOnEnter(e: KeyboardEvent<HTMLInputElement>, nextId: string) {
  if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
  e.preventDefault();
  document.getElementById(nextId)?.focus();
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="mb-3.5">
      <label htmlFor={id} className="mb-1.5 block text-[15px] font-extrabold">
        {label}
      </label>
      {children}
    </div>
  );
}
