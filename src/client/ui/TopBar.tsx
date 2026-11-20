import { ProgressBar } from './ProgressBar';

export interface TopBarProps {
  /** Progress from 0 to 1. */
  progress: number;
  /** Accessible name of the progress bar, e.g. "Vraag 12 van 21". */
  label: string;
  /** The X: back to the start screen; the draft stays. */
  onClose: () => void;
}

/** The close button and progress bar at the top of every inspection screen. */
export function TopBar({ progress, label, onClose }: TopBarProps) {
  return (
    <header className="flex items-center gap-3 px-[18px] pt-[18px] pb-1.5">
      <button
        type="button"
        aria-label="Terug naar start"
        onClick={onClose}
        className="-ml-2.5 grid size-11 shrink-0 place-items-center rounded-chunky text-sub focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-violet"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[26px]" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
      <ProgressBar value={progress} label={label} />
    </header>
  );
}
