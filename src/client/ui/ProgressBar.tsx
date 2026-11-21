import { cn } from './cn';

export interface ProgressBarProps {
  /** Progress from 0 to 1; values outside are clamped. */
  value: number;
  /** Accessible name, e.g. "Vraag 12 van 21". */
  label: string;
  className?: string;
}

export function ProgressBar({ value, label, className }: ProgressBarProps) {
  const percent = Math.round(Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuetext={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={cn('h-4 flex-1 overflow-hidden rounded-full bg-grey', className)}
    >
      <div
        className={cn(
          'relative h-full rounded-full bg-brand motion-safe:transition-[width] motion-safe:duration-300',
          // The light stripe on top, as in the mockup.
          "after:absolute after:inset-x-2 after:top-1 after:h-1 after:rounded-[9px] after:bg-white/28 after:content-['']",
          percent < 8 && 'after:hidden',
        )}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
