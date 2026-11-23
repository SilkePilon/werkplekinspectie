import { useId, type Ref } from 'react';
import { formatDayLong } from '@shared/dates';
import { cn } from './cn';

export interface DatePickerProps {
  /** The question, e.g. "Opgelost vóór"; labels the field. */
  legend: string;
  /** YYYY-MM-DD, or '' when nothing is chosen yet. */
  value: string;
  /** YYYY-MM-DD: the first day the form allows (the inspection day). Today is never earlier. */
  min: string;
  /** YYYY-MM-DD: today. Days before it cannot be chosen. */
  today: string;
  onChange: (date: string) => void;
  /** Id of an error or hint for the field. */
  describedBy?: string;
  /** The date input, so the sheet can move focus here when the date is missing. */
  focusRef?: Ref<HTMLInputElement>;
  invalid?: boolean;
}

/**
 * The phone's own date picker, behind a field that shows the chosen day in words
 * ("maandag 30 november 2026"). The native input lies invisibly over the whole field, so a tap
 * anywhere opens the picker of the phone (a wheel on iPhone, a calendar on Android).
 */
export function DatePicker({ legend, value, min, today, onChange, describedBy, focusRef, invalid = false }: DatePickerProps) {
  const id = useId();
  const first = today > min ? today : min;

  return (
    <div>
      <label htmlFor={id} className="m-0 mb-2 block text-[19px] font-black leading-tight text-ink">
        {legend}
      </label>
      <div
        className={cn(
          'relative flex min-h-[52px] items-center justify-between gap-3 rounded-chunky border-2 bg-[#f7f7f7] px-3.5 py-3',
          'has-[input:focus-visible]:outline-solid has-[input:focus-visible]:outline-3 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-brand-d',
          invalid ? 'border-coral' : 'border-grey hover:border-grey-d',
        )}
      >
        <span aria-hidden="true" className={cn('text-[17px] first-letter:uppercase', value ? 'font-bold text-ink' : 'font-semibold text-sub/70')}>
          {value ? formatDayLong(value) : 'Kies een datum'}
        </span>
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 shrink-0 text-sub" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
        <input
          id={id}
          ref={focusRef}
          type="date"
          value={value}
          min={first}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
          // A computer opens its picker only on its own icon, which is hidden here: open it on any click.
          onClick={(e) => {
            try {
              e.currentTarget.showPicker?.();
            } catch {
              // Not allowed here (e.g. inside a cross-origin frame): typing the date still works.
            }
          }}
          // Invisible but tappable over the whole field; 17px so iOS does not zoom in on focus.
          className="absolute inset-0 size-full cursor-pointer appearance-none opacity-0 text-[17px]"
        />
      </div>
    </div>
  );
}
