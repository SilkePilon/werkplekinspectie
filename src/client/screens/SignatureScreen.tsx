import { useRef, useState } from 'react';
import { formatDateLong } from '@shared/dates';
import type { DraftDispatch } from '../App';
import { toIsoWithOffset, type Draft } from '../state/draft';
import { ChunkyButton } from '../ui/ChunkyButton';
import { TopBar } from '../ui/TopBar';
import { useSignaturePad } from '../ui/useSignaturePad';

export interface SignatureScreenProps {
  draft: Draft;
  dispatch: DraftDispatch;
  /** "Verstuur inspectie" with the exported signature; signing and sending happen there. */
  onSend: (signature: string, signedAt: string) => void;
  /** Sending is running: the button shows a spinner and takes no taps. */
  busy: boolean;
  /** One step back in the form (the arrow at the top). */
  onBack?: () => void;
  onClose: () => void;
}

const DECLARATION = 'Ik heb deze inspectie zelf gedaan en de antwoorden kloppen.';

export function SignatureScreen({ draft, dispatch, onSend, busy, onBack, onClose }: SignatureScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { isEmpty, clear, exportPng } = useSignaturePad(canvasRef);
  const [tooBig, setTooBig] = useState(false);
  const [today] = useState(() => formatDateLong(new Date().toISOString()));

  function send() {
    const signature = exportPng();
    if (!signature) {
      setTooBig(true);
      return;
    }
    onSend(signature, toIsoWithOffset(new Date()));
  }

  function redo() {
    clear();
    setTooBig(false);
  }

  return (
    <>
      <TopBar progress={1} label="Laatste stap" onBack={onBack} onClose={onClose} />

      <main className="flex flex-1 flex-col px-[18px] pt-[18px]">
        <h1 className="mt-2.5 mb-4 text-[25px] font-black leading-[1.2] tracking-[-.005em]">Zet je handtekening</h1>

        <div className="relative h-[230px] rounded-chunky border-2 border-dashed border-grey-d bg-[#fbfafd]">
          <div aria-hidden="true" className="absolute inset-x-[18px] bottom-[46px] border-t-2 border-grey" />
          <span className="absolute bottom-4 left-[18px] text-[14px] text-sub">
            {draft.monteur}, {today}
          </span>
          <canvas
            ref={canvasRef}
            role="img"
            aria-label="Tekenvlak: teken hier met je vinger, pen of muis"
            className="absolute inset-0 size-full cursor-crosshair touch-none rounded-chunky"
          />
          <button
            type="button"
            onClick={redo}
            disabled={isEmpty}
            className="absolute top-1 right-1 z-10 min-h-11 rounded-chunky px-3 text-[15px] font-black text-brand-d enabled:hover:bg-brand-l disabled:text-mute focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-brand-d motion-safe:transition-colors"
          >
            Opnieuw
          </button>
        </div>

        {tooBig && (
          <p role="alert" className="mt-3 mb-0 text-[15px] font-extrabold text-coral-d motion-safe:animate-rise">
            Je handtekening is te groot. Tik op Opnieuw en teken hem nog een keer.
          </p>
        )}

        <label className="group mt-4 flex min-h-11 cursor-pointer items-start gap-3 rounded-chunky py-1 text-[16px] has-focus-visible:outline-solid has-focus-visible:outline-3 has-focus-visible:outline-offset-3 has-focus-visible:outline-brand-d">
          <input
            type="checkbox"
            checked={draft.declaration}
            onChange={(e) => dispatch({ type: 'declare', value: e.target.checked })}
            className="peer sr-only"
          />
          <span
            aria-hidden="true"
            className="grid size-7 shrink-0 place-items-center rounded-[8px] border-2 border-grey-d bg-white text-transparent peer-not-checked:group-hover:border-sub peer-checked:border-brand peer-checked:bg-brand peer-checked:text-white motion-safe:transition-colors motion-safe:peer-checked:animate-pop"
          >
            <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>
          <span>{DECLARATION}</span>
        </label>
      </main>

      <footer className="px-[18px] pt-4 pb-[calc(22px+env(safe-area-inset-bottom))]">
        <ChunkyButton busy={busy} disabled={isEmpty || !draft.declaration} onClick={send}>
          Verstuur inspectie
        </ChunkyButton>
        {/* Always in the page, so screen readers announce the text when sending starts. */}
        <p role="status" className="mt-2 mb-0 min-h-[1lh] text-center text-[15px] text-sub">
          {busy ? "Bezig met versturen. Met veel foto's kan dit even duren." : ''}
        </p>
      </footer>
    </>
  );
}
