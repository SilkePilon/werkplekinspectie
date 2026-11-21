import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { addDays, addMonths, formatDayLong, formatMonth, weekdayIndex } from '@shared/dates';
import { cn } from './cn';

export interface DatePickerProps {
  /** The question, e.g. "Opgelost vóór"; names the group. */
  legend: string;
  /** YYYY-MM-DD, or '' when nothing is chosen yet. */
  value: string;
  /** YYYY-MM-DD: the first day the form allows (the inspection day). Today is never earlier. */
  min: string;
  /** YYYY-MM-DD: today. It has a darker background; every day before it is greyed out. */
  today: string;
  onChange: (date: string) => void;
  /** Id of an error or hint for the whole group. */
  describedBy?: string;
  /** The day that takes Tab focus, so the sheet can move focus here when the date is missing. */
  focusRef?: Ref<HTMLButtonElement>;
}

const WEEKDAYS = [
  ['ma', 'maandag'],
  ['di', 'dinsdag'],
  ['wo', 'woensdag'],
  ['do', 'donderdag'],
  ['vr', 'vrijdag'],
  ['za', 'zaterdag'],
  ['zo', 'zondag'],
] as const;

const firstOfMonth = (date: string) => `${date.slice(0, 8)}01`;

/** The days of the month as weeks of 7, Monday first; '' pads the first and last week. */
function weeksOf(month: string): string[][] {
  const first = firstOfMonth(month);
  const count = Number(addDays(addMonths(first, 1), -1).slice(8));
  const cells = [
    ...Array<string>(weekdayIndex(first)).fill(''),
    ...Array.from({ length: count }, (_, i) => addDays(first, i)),
  ];
  while (cells.length % 7 !== 0) cells.push('');
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

/** Keys that move the focused day, as in the WAI-ARIA date picker pattern. */
const MOVES: Record<string, (date: string) => string> = {
  ArrowLeft: (d) => addDays(d, -1),
  ArrowRight: (d) => addDays(d, 1),
  ArrowUp: (d) => addDays(d, -7),
  ArrowDown: (d) => addDays(d, 7),
  Home: (d) => addDays(d, -weekdayIndex(d)),
  End: (d) => addDays(d, 6 - weekdayIndex(d)),
  PageUp: (d) => addMonths(d, -1),
  PageDown: (d) => addMonths(d, 1),
};

/**
 * A month calendar, Monday first. Today has a darker background; days before today (or before
 * `min`, if that is later) are greyed out and cannot be chosen. The chosen day is orange.
 * Keyboard: one Tab stop, arrows move by day and week, Home/End to the start and end of the
 * week, PageUp/PageDown by month, Enter or Space chooses (the WAI-ARIA date grid).
 */
export function DatePicker({ legend, value, min, today, onChange, describedBy, focusRef }: DatePickerProps) {
  const legendId = useId();
  const titleId = useId();
  const first = today > min ? today : min;
  const clamp = (date: string) => (date < first ? first : date);
  // The day that takes Tab focus (roving tabindex); its month is the one shown.
  const [focus, setFocus] = useState(() => clamp(value === '' ? first : value));
  const month = firstOfMonth(focus);
  const grid = useRef<HTMLTableElement>(null);
  // Only after a key press does focus follow the day; the month buttons keep their own focus.
  const keyMoved = useRef(false);

  useEffect(() => {
    if (!keyMoved.current) return;
    keyMoved.current = false;
    grid.current?.querySelector<HTMLButtonElement>(`[data-date="${focus}"]`)?.focus();
  }, [focus]);

  function onKeyDown(e: KeyboardEvent<HTMLTableElement>) {
    const move = MOVES[e.key];
    if (!move) return;
    e.preventDefault();
    keyMoved.current = true;
    setFocus(clamp(move(focus)));
  }

  return (
    <div role="group" aria-labelledby={legendId} aria-describedby={describedBy}>
      <p id={legendId} className="m-0 mb-1.5 text-[15px] font-extrabold">
        {legend}
      </p>
      <div className="rounded-chunky border-2 border-grey bg-white p-2.5">
        <div className="mb-1 flex items-center justify-between gap-2">
          <MonthButton
            label="Vorige maand"
            disabled={month <= firstOfMonth(first)}
            onClick={() => setFocus(clamp(addMonths(focus, -1)))}
          >
            <path d="m15 18-6-6 6-6" />
          </MonthButton>
          <h3 id={titleId} aria-live="polite" className="m-0 text-[17px] font-black first-letter:uppercase">
            {formatMonth(month)}
          </h3>
          <MonthButton label="Volgende maand" onClick={() => setFocus(addMonths(focus, 1))}>
            <path d="m9 18 6-6-6-6" />
          </MonthButton>
        </div>
        <table
          ref={grid}
          role="grid"
          aria-labelledby={titleId}
          className="w-full table-fixed border-collapse"
          onKeyDown={onKeyDown}
        >
          <thead>
            <tr>
              {WEEKDAYS.map(([short, full]) => (
                <th key={short} scope="col" abbr={full} className="pb-1 text-[13px] font-extrabold text-sub">
                  {short}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeksOf(month).map((week) => (
              <tr key={week.find(Boolean)}>
                {week.map((date, i) =>
                  date === '' ? (
                    <td key={`pad-${i}`} />
                  ) : (
                    <td key={date} role="gridcell" aria-selected={date === value} className="p-0.5 text-center">
                      <Day
                        ref={date === focus ? focusRef : undefined}
                        date={date}
                        selected={date === value}
                        isToday={date === today}
                        past={date < first}
                        tabbable={date === focus}
                        onPick={() => {
                          setFocus(date);
                          onChange(date);
                        }}
                      />
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface DayProps {
  ref?: Ref<HTMLButtonElement>;
  date: string;
  selected: boolean;
  isToday: boolean;
  past: boolean;
  tabbable: boolean;
  onPick: () => void;
}

function Day({ ref, date, selected, isToday, past, tabbable, onPick }: DayProps) {
  return (
    <button
      ref={ref}
      type="button"
      data-date={date}
      tabIndex={tabbable ? 0 : -1}
      aria-label={isToday ? `${formatDayLong(date)}, vandaag` : formatDayLong(date)}
      aria-current={isToday ? 'date' : undefined}
      // aria-disabled instead of disabled: the day stays reachable with the arrow keys.
      aria-disabled={past || undefined}
      onClick={() => {
        if (!past) onPick();
      }}
      className={cn(
        'mx-auto grid size-11 place-items-center rounded-xl text-[16px] font-extrabold',
        'focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-brand-d',
        'motion-safe:transition-colors',
        selected
          ? 'bg-brand text-white motion-safe:animate-pop'
          : past
            ? 'cursor-not-allowed text-mute'
            : isToday
              ? 'bg-grey text-ink hover:bg-grey-d'
              : 'text-ink hover:bg-brand-l active:bg-brand-l',
      )}
    >
      {Number(date.slice(8))}
    </button>
  );
}

function MonthButton({
  label,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grid size-11 place-items-center rounded-xl text-ink',
        'focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-brand-d',
        'enabled:hover:bg-grey/60 disabled:cursor-not-allowed disabled:text-grey-d motion-safe:transition-colors',
      )}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  );
}
