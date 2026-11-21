import type { ComponentProps } from 'react';
import { cn } from './cn';

export type ChunkyButtonVariant = 'main' | 'coral' | 'line' | 'ghost';

export interface ChunkyButtonProps extends ComponentProps<'button'> {
  variant?: ChunkyButtonVariant;
  /** Shows a spinner, sets aria-busy and blocks taps while work is running. */
  busy?: boolean;
}

const base =
  'relative flex w-full min-h-14 select-none items-center justify-center gap-2 rounded-chunky px-5 ' +
  // 19px black: white on the logo orange counts as large text (WCAG 3:1).
  'text-[19px] font-black tracking-[.01em] ' +
  // Never add bare `outline-none`: in Tailwind 4 it sets --tw-outline-style to none, which also
  // hides the focus-visible ring. The explicit outline-solid keeps the ring visible.
  'focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-brand-d ' +
  'motion-safe:transition-transform ' +
  'disabled:cursor-not-allowed';

// The 5px bottom border gives the "press me" feel; pressing sinks the button onto it.
const chunky = 'border-b-5 enabled:active:translate-y-[3px] enabled:active:border-b-2';

const variants: Record<ChunkyButtonVariant, string> = {
  main: cn(chunky, 'bg-brand text-white border-brand-d'),
  coral: cn(chunky, 'bg-coral text-white border-coral-d'),
  line: cn(chunky, 'bg-white text-ink border-2 border-b-5 border-grey text-[16px]'),
  ghost: 'bg-transparent text-brand-d text-[16px] enabled:active:opacity-70 disabled:text-mute',
};

// Same grey for every variant: clearly "not yet" without relying on the label colour.
const disabledLook = 'bg-grey text-mute border-grey';

export function ChunkyButton({
  variant = 'main',
  busy = false,
  disabled,
  type = 'button',
  className,
  children,
  ...rest
}: ChunkyButtonProps) {
  const off = disabled || busy;
  return (
    <button
      {...rest}
      type={type}
      disabled={off}
      aria-busy={busy || undefined}
      className={cn(base, variants[variant], disabled && !busy && variant !== 'ghost' && disabledLook, className)}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5 shrink-0 motion-safe:animate-spin"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="9" opacity=".3" />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  );
}
