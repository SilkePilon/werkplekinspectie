import { useCallback, useEffect, useRef, useState } from 'react';
import { QUESTION_IDS, type QuestionId } from '@shared/questions';
import type { Submission } from '@shared/schema';
import { QuestionScreen } from './screens/QuestionScreen';
import { StartScreen, type StartFields } from './screens/StartScreen';
import { draftReducer, newDraft, nextUnanswered, type Draft, type DraftAction } from './state/draft';
import {
  clearDraft,
  getRememberedName,
  listOutbox,
  loadDraft,
  purgeExpired,
  saveDraft,
  setRememberedName,
} from './storage/db';

export type Screen =
  | { name: 'start' }
  | { name: 'question'; id: QuestionId; returnTo?: 'summary' }
  | { name: 'goodPractice' }
  | { name: 'summary' }
  | { name: 'signature' };

/** An action, or a function that builds one from the draft as it is at that moment (for async work). */
export type DraftDispatch = (update: DraftAction | ((d: Draft) => DraftAction)) => void;

const START: Screen = { name: 'start' };
const AUTOSAVE_MS = 300;

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
    case 'summary':
    case 'signature':
      return { name };
    default:
      return START;
  }
}

function pushScreen(screen: Screen) {
  history.pushState({ screen }, '');
}

/** Saves ~300ms after the last change, and at once when asked (page hidden, unmount). */
function useAutosave() {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<Draft | null>(null);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const d = pending.current;
    pending.current = null;
    // A failed save (storage full, private mode) must not break the flow; the next change retries.
    if (d) saveDraft(d).catch(() => undefined);
  }, []);

  const schedule = useCallback(
    (d: Draft) => {
      pending.current = d;
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, AUTOSAVE_MS);
    },
    [flush],
  );

  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    pending.current = null;
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, [flush]);

  return { schedule, cancel };
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
  const hasLogo = useHasLogo();
  const { schedule, cancel } = useAutosave();

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
    const onPop = (e: PopStateEvent) => setScreen(screenFromState(e.state));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((s: Screen) => {
    pushScreen(s);
    setScreen(s);
  }, []);

  const commit = useCallback((d: Draft | null) => {
    draftRef.current = d;
    setDraft(d);
  }, []);

  const dispatch: DraftDispatch = useCallback(
    (update) => {
      const current = draftRef.current;
      if (!current) return;
      const next = draftReducer(current, typeof update === 'function' ? update(current) : update);
      commit(next);
      schedule(next);
    },
    [commit, schedule],
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
    for (const id of before) pushScreen({ name: 'question', id });
    navigate(target ? { name: 'question', id: target } : { name: 'goodPractice' });
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

  function body() {
    if (!loaded) return null;
    // Every screen but the start needs a draft (e.g. back after Weggooien).
    if (!draft || screen.name === 'start') {
      return (
        <StartScreen
          hasLogo={hasLogo}
          rememberedName={rememberedName}
          draft={draft}
          outbox={outbox}
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
            onClose={() => navigate(START)}
          />
        );
      }
      // Stand-ins until Task 12 builds these screens.
      case 'goodPractice':
        return <Placeholder title="Wat gaat hier goed?" />;
      case 'summary':
        return <Placeholder title="Klopt alles?" />;
      case 'signature':
        return <Placeholder title="Handtekening" />;
    }
  }

  return <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col">{body()}</div>;
}

function Placeholder({ title }: { title: string }) {
  return (
    <main className="flex flex-1 flex-col px-[18px] pt-[22px]">
      <h1 className="mt-2.5 mb-1 text-[30px] font-black leading-[1.1]">{title}</h1>
    </main>
  );
}
