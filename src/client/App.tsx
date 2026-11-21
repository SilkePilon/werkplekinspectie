import { useCallback, useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { QUESTION_IDS, type QuestionId } from '@shared/questions';
import type { Submission } from '@shared/schema';
import type { SubmitOutcome } from './api/submit';
import { GoodPracticeScreen } from './screens/GoodPracticeScreen';
import { QuestionScreen } from './screens/QuestionScreen';
import { ResultScreen } from './screens/ResultScreen';
import { SignatureScreen } from './screens/SignatureScreen';
import { StartScreen, type StartFields } from './screens/StartScreen';
import { SummaryScreen } from './screens/SummaryScreen';
import { draftReducer, newDraft, nextUnanswered, type Draft, type DraftAction } from './state/draft';
import { useAutosave } from './state/useAutosave';
import { useBackOnline } from './state/useBackOnline';
import { useSend } from './state/useSend';
import { useKeyboardInset } from './ui/useKeyboardInset';
import {
  clearDraft,
  getRememberedName,
  listOutbox,
  loadDraft,
  purgeExpired,
  setRememberedName,
} from './storage/db';

export type Screen =
  | { name: 'start' }
  | { name: 'question'; id: QuestionId; returnTo?: 'summary' }
  | { name: 'goodPractice'; returnTo?: 'summary' }
  /**
   * `highlight`: the question the server named when it refused the inspection.
   * `tooLarge`: sending stopped because the inspection is over the body limit.
   */
  | { name: 'summary'; highlight?: QuestionId; tooLarge?: boolean }
  | { name: 'signature' }
  /** Not kept in history: back from here goes to the start screen. */
  | { name: 'result'; outcome: SubmitOutcome; submissionId: string };

/**
 * An action, or a function that builds one from the draft as it is at that moment (for async
 * work); that function may return null to drop the change.
 */
export type DraftDispatch = (update: DraftAction | ((d: Draft) => DraftAction | null)) => void;

const START: Screen = { name: 'start' };

type NavDirection = 'forward' | 'back';

const isQuestionId = (v: unknown): v is QuestionId => QUESTION_IDS.includes(v as QuestionId);

/** history.state comes back from the browser, possibly from an older version: check it. */
function screenFromState(state: unknown): Screen {
  const s: unknown = (state as { screen?: unknown } | null)?.screen;
  if (typeof s !== 'object' || s === null) return START;
  const { name, id, returnTo } = s as Record<string, unknown>;
  switch (name) {
    case 'question':
      if (!isQuestionId(id)) return START;
      return returnTo === 'summary' ? { name, id, returnTo } : { name, id };
    case 'goodPractice':
      return returnTo === 'summary' ? { name, returnTo } : { name };
    case 'summary':
    case 'signature':
      return { name };
    default:
      return START;
  }
}

/** The step before this one in the form. Null on the first question: the X covers that. */
export function previousScreen(s: Screen): Screen | null {
  switch (s.name) {
    case 'question': {
      if (s.returnTo === 'summary') return { name: 'summary' };
      const i = QUESTION_IDS.indexOf(s.id);
      return i > 0 ? { name: 'question', id: QUESTION_IDS[i - 1]! } : null;
    }
    case 'goodPractice':
      return s.returnTo === 'summary'
        ? { name: 'summary' }
        : { name: 'question', id: QUESTION_IDS[QUESTION_IDS.length - 1]! };
    case 'summary':
      return { name: 'goodPractice' };
    case 'signature':
      return { name: 'summary' };
    default:
      return null;
  }
}

/** Same step of the form; a summary's highlight does not make it another step. */
function sameStep(a: Screen, b: Screen): boolean {
  const key = (s: Screen) =>
    [s.name, 'id' in s ? s.id : '', 'returnTo' in s ? (s.returnTo ?? '') : ''].join('|');
  return key(a) === key(b);
}

/** `prev` is the screen this entry was opened from, so the back arrow can reuse history. */
function pushScreen(screen: Screen, prev: Screen) {
  history.pushState({ screen, prev }, '');
}

function useHasLogo(): boolean {
  const [hasLogo, setHasLogo] = useState(false);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/api/branding', { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: unknown) => {
        if ((b as { hasLogo?: unknown } | null)?.hasLogo === true) setHasLogo(true);
      })
      // Offline or no server: just show the title.
      .catch(() => undefined);
    return () => ctrl.abort();
  }, []);
  return hasLogo;
}

export function App() {
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  // The latest draft, for dispatches that run after an await.
  const draftRef = useRef<Draft | null>(null);
  const [rememberedName, setName] = useState('');
  const [outbox, setOutbox] = useState<Submission[]>([]);
  const [screen, setScreen] = useState<Screen>(START);
  const screenRef = useRef<Screen>(START);
  // Which way the last step went; the next screen slides in from that side (styles.css).
  const [nav, setNav] = useState<NavDirection>('forward');
  const show = useCallback((s: Screen, direction: NavDirection) => {
    screenRef.current = s;
    setScreen(s);
    setNav(direction);
  }, []);
  const hasLogo = useHasLogo();
  useKeyboardInset();
  const backOnline = useBackOnline();
  // Registered once here (App never unmounts); the start screen shows the update banner.
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  // useSend needs the autosave, and the autosave reports to useSend: through a ref.
  const noteSaved = useRef<(d: Draft) => void>(() => undefined);
  const onSaved = useCallback((d: Draft) => noteSaved.current(d), []);
  const { schedule, cancel, failed: saveFailed } = useAutosave(onSaved);

  useEffect(() => {
    let alive = true;
    void (async () => {
      await purgeExpired(new Date()).catch(() => undefined);
      const [d, name, out] = await Promise.all([
        loadDraft().catch(() => null),
        getRememberedName().catch(() => ''),
        listOutbox().catch(() => []),
      ]);
      if (!alive) return;
      draftRef.current = d;
      setDraft(d);
      setName(name);
      setOutbox(out);
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    history.replaceState({ screen: START }, '');
    const onPop = (e: PopStateEvent) => {
      const target = screenFromState(e.state);
      const before = previousScreen(screenRef.current);
      const back = target.name === 'start' || (before !== null && sameStep(before, target));
      show(target, back ? 'back' : 'forward');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [show]);

  const navigate = useCallback(
    (s: Screen) => {
      pushScreen(s, screenRef.current);
      // Back to the start screen (the X, Klaar, Later versturen) reads as going back.
      show(s, s.name === 'start' ? 'back' : 'forward');
    },
    [show],
  );

  /**
   * The back arrow: always the step before in the form, never out of the app. When the
   * browser's previous entry is that step, go back in history, so the phone's own back button
   * stays in step; otherwise replace this entry instead of piling up new ones.
   */
  const goBack = useCallback(() => {
    const target = previousScreen(screenRef.current);
    if (!target) return;
    const prev: unknown = (history.state as { prev?: unknown } | null)?.prev;
    if (prev !== undefined && sameStep(screenFromState({ screen: prev }), target)) {
      history.back();
    } else {
      history.replaceState({ screen: target }, '');
      show(target, 'back');
    }
  }, [show]);

  const commit = useCallback((d: Draft | null) => {
    draftRef.current = d;
    setDraft(d);
  }, []);

  const send = useSend({ draftRef, commit, schedule, cancelAutosave: cancel, navigate, setOutbox });
  const { isDraftLocked } = send;
  useEffect(() => {
    noteSaved.current = send.noteSaved;
  }, [send.noteSaved]);

  const dispatch: DraftDispatch = useCallback(
    (update) => {
      const current = draftRef.current;
      // While this draft is being sent it is on its way to the outbox: a change now would be
      // lost or, through autosave, bring back the draft that sending clears.
      if (!current || isDraftLocked()) return;
      const action = typeof update === 'function' ? update(current) : update;
      if (!action) return;
      const next = draftReducer(current, action);
      commit(next);
      schedule(next);
    },
    [commit, schedule, isDraftLocked],
  );

  function start(f: StartFields) {
    let d = newDraft(f.monteur, f.project, f.projectnummer, new Date());
    if (f.website) d = draftReducer(d, { type: 'honeypot', value: f.website });
    commit(d);
    schedule(d);
    setName(f.monteur);
    setRememberedName(f.monteur).catch(() => undefined);
    navigate({ name: 'question', id: QUESTION_IDS[0] });
  }

  function resume() {
    if (!draft) return;
    const target = nextUnanswered(draft);
    // Rebuild the trail of earlier questions, so the phone's back button goes to the
    // previous question, as it would have before the app was closed.
    const before = target ? QUESTION_IDS.slice(0, QUESTION_IDS.indexOf(target)) : QUESTION_IDS;
    let prev: Screen = START;
    for (const id of before) {
      const s: Screen = { name: 'question', id };
      pushScreen(s, prev);
      prev = s;
    }
    const s: Screen = target ? { name: 'question', id: target } : { name: 'goodPractice' };
    pushScreen(s, prev);
    show(s, 'forward');
  }

  function discard() {
    cancel();
    commit(null);
    clearDraft().catch(() => undefined);
  }

  function advance(from: QuestionId, returnTo: 'summary' | undefined) {
    if (returnTo === 'summary') return navigate({ name: 'summary' });
    const next = QUESTION_IDS[QUESTION_IDS.indexOf(from) + 1];
    navigate(next ? { name: 'question', id: next } : { name: 'goodPractice' });
  }

  function result(s: Extract<Screen, { name: 'result' }>) {
    const { last } = send;
    const sub =
      last?.submission.submissionId === s.submissionId
        ? last.submission
        : outbox.find((o) => o.submissionId === s.submissionId);
    if (!sub) return null;
    return (
      <ResultScreen
        outcome={s.outcome}
        submission={sub}
        busy={send.sendingId === sub.submissionId}
        otherDraftOpen={draft !== null && draft.id !== sub.submissionId}
        onDone={() => navigate(START)}
        onRetry={() => send.resend(sub)}
        onLater={() => navigate(START)}
        onFix={() => send.fix(sub, last?.submission === sub ? last.fields : undefined)}
      />
    );
  }

  function body() {
    if (!loaded) return null;
    if (screen.name === 'result') {
      const shown = result(screen);
      if (shown) return shown;
    }
    // Every screen but the start needs a draft (e.g. back after Weggooien). A result whose
    // inspection is gone (not expected) also falls back to the start.
    if (!draft || screen.name === 'start' || screen.name === 'result') {
      return (
        <StartScreen
          hasLogo={hasLogo}
          rememberedName={rememberedName}
          draft={draft}
          outbox={outbox}
          sendingId={send.sendingId}
          backOnline={backOnline}
          updateAvailable={needRefresh}
          onUpdate={() => void updateServiceWorker(true)}
          onSendNow={send.resend}
          onStart={start}
          onResume={resume}
          onDiscard={discard}
        />
      );
    }
    switch (screen.name) {
      case 'question': {
        const { id, returnTo } = screen;
        return (
          <QuestionScreen
            key={`${id}-${returnTo ?? ''}`}
            draft={draft}
            id={id}
            dispatch={dispatch}
            onNext={() => advance(id, returnTo)}
            onBack={previousScreen(screen) ? goBack : undefined}
            onClose={() => navigate(START)}
          />
        );
      }
      case 'goodPractice':
        return (
          <GoodPracticeScreen
            draft={draft}
            dispatch={dispatch}
            fromSummary={screen.returnTo === 'summary'}
            onNext={() => navigate({ name: 'summary' })}
            onBack={goBack}
            onClose={() => navigate(START)}
          />
        );
      case 'summary':
        return (
          <SummaryScreen
            draft={draft}
            highlight={screen.highlight}
            tooLarge={screen.tooLarge === true}
            onEdit={(id) => navigate({ name: 'question', id, returnTo: 'summary' })}
            onEditGoodPractice={() => navigate({ name: 'goodPractice', returnTo: 'summary' })}
            onNext={() => navigate({ name: 'signature' })}
            onBack={goBack}
            onClose={() => navigate(START)}
          />
        );
      case 'signature':
        return (
          <SignatureScreen
            draft={draft}
            dispatch={dispatch}
            onSend={send.sendDraft}
            busy={send.sendingId !== null}
            onBack={goBack}
            onClose={() => navigate(START)}
          />
        );
    }
  }

  return (
    <div
      data-nav={nav}
      className={
        // Phone: the whole screen. Tablet and desktop: a white card on the brand tint, a little
        // wider. overflow-clip (not hidden) rounds the corners without breaking sticky footers.
        // overflow-x-clip: a screen sliding in never makes the page scroll sideways.
        'mx-auto flex min-h-dvh w-full max-w-[480px] flex-col overflow-x-clip bg-white ' +
        'md:my-8 md:min-h-[calc(100dvh-4rem)] md:max-w-[560px] md:overflow-clip md:rounded-[28px] md:border-2 md:border-b-5 md:border-grey'
      }
    >
      {(saveFailed || send.storeFailed) && <SaveFailedAlert />}
      {body()}
    </div>
  );
}

/** Persistent until a save works again, so the technician knows work is not being kept. */
function SaveFailedAlert() {
  return (
    <div
      role="alert"
      className="mx-[18px] mt-3 flex items-start gap-2.5 rounded-chunky border-2 border-coral bg-roze motion-safe:animate-rise px-3.5 py-3 text-[15px] font-extrabold text-coral-d"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="mt-px size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5v5.5M12 16.5v.01" />
      </svg>
      Opslaan op deze telefoon lukt niet. Probeer het opnieuw of verwijder een foto.
    </div>
  );
}
