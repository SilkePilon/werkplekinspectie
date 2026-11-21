import type { ReactNode } from 'react';
import { cn } from './cn';

export type Answer = 'ja' | 'nee' | 'nvt';

export interface AnswerGroupProps {
  /** Shared `name` of the three radios, e.g. the question id. */
  name: string;
  /** The question; becomes the fieldset's accessible name. */
  legend: ReactNode;
  /** Shows the legend to screen readers only (when the question is shown elsewhere). */
  hideLegend?: boolean;
  value: Answer | undefined;
  onChange: (value: Answer) => void;
  className?: string;
}

interface Option {
  value: Answer;
  label: string;
  icon: ReactNode;
  /** Classes for the selected label. */
  on: string;
  /** Classes for the icon box when selected. */
  iconOn: string;
}

const OPTIONS: readonly Option[] = [
  {
    value: 'ja',
    label: 'Ja',
    icon: <path d="M20 6 9 17l-5-5" />,
    on: 'bg-brand-l border-brand text-brand-d',
    iconOn: 'bg-brand border-brand text-white',
  },
  {
    value: 'nee',
    label: 'Nee',
    icon: <path d="M6 6l12 12M18 6L6 18" />,
    on: 'bg-roze border-coral text-coral-d',
    iconOn: 'bg-coral border-coral text-white',
  },
  {
    value: 'nvt',
    label: 'Niet van toepassing',
    icon: <path d="M6 12h12" />,
    on: 'bg-grey border-grey-d text-ink',
    iconOn: 'bg-white border-grey-d text-ink',
  },
];

/**
 * Ja / Nee / Niet van toepassing as a native radio group: the browser handles
 * arrow keys and screen-reader semantics; the labels are the big tap targets.
 */
export function AnswerGroup({ name, legend, hideLegend = false, value, onChange, className }: AnswerGroupProps) {
  return (
    <fieldset className={cn('m-0 min-w-0 border-0 p-0', className)}>
      <legend
        className={cn(hideLegend ? 'sr-only' : 'mb-[26px] p-0 text-[25px] font-black leading-[1.2] tracking-[-.005em]')}
      >
        {legend}
      </legend>
      <div className="flex flex-col gap-3">
        {OPTIONS.map((opt) => {
          const selected = value === opt.value;
          return (
            <label
              key={opt.value}
              className={cn(
                'relative flex min-h-[62px] cursor-pointer select-none items-center gap-3.5 rounded-chunky px-4 py-2',
                'border-2 border-b-5 border-grey bg-white text-[20px] font-extrabold leading-tight text-ink',
                'has-focus-visible:outline-solid has-focus-visible:outline-3 has-focus-visible:outline-offset-3 has-focus-visible:outline-brand-d',
                // Pressing sinks it onto its bottom edge, like the buttons.
                'active:translate-y-[3px] active:border-b-2',
                'motion-safe:transition-[translate,background-color,border-color,color] motion-safe:duration-150',
                selected ? opt.on : 'hover:border-grey-d hover:bg-[#fafafa]',
              )}
            >
              <input
                type="radio"
                name={name}
                value={opt.value}
                checked={selected}
                onChange={() => onChange(opt.value)}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className={cn(
                  'grid size-[34px] shrink-0 place-items-center rounded-[10px] border-2 border-grey text-mute',
                  selected && cn(opt.iconOn, 'motion-safe:animate-pop'),
                )}
              >
                <svg
                  viewBox="0 0 24 24"
                  className="size-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {opt.icon}
                </svg>
              </span>
              {opt.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
