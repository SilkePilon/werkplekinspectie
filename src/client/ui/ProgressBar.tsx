import { useEffect, useState, type CSSProperties } from 'react';
import { cn } from './cn';

/**
 * Where the bar stood on the screen before. Each screen has its own top bar, so the bar is new
 * on every step: it grows from here instead of jumping.
 */
let lastPercent = 0;

export interface ProgressBarProps {
  /** Progress from 0 to 1; values outside are clamped. */
  value: number;
  /** Accessible name, e.g. "Vraag 12 van 21". */
  label: string;
  className?: string;
}

export function ProgressBar({ value, label, className }: ProgressBarProps) {
  const percent = Math.round(Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)) * 100);
  const [from] = useState(() => lastPercent);
  useEffect(() => {
    lastPercent = percent;
  }, [percent]);
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
          from !== percent && 'motion-safe:animate-progress',
          // The light stripe on top, as in the mockup, on every step, also the first: its side insets shrink with a short
          // bar, and a started bar is never narrower than 22px, so the stripe always fits.
          "after:absolute after:inset-x-[min(8px,28%)] after:top-1 after:h-1 after:rounded-[9px] after:bg-white/28 after:content-['']",
          percent > 0 ? 'min-w-[22px]' : 'after:hidden',
        )}
        style={{ width: `${percent}%`, '--from': `${from}%` } as CSSProperties}
      />
    </div>
  );
}
