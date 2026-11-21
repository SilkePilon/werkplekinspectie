import { useId } from 'react';
import { LIMITS } from '@shared/schema';
import { ChunkyButton } from '../ui/ChunkyButton';
import { Sheet } from '../ui/Sheet';

export interface NoteSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  text: string;
  onChange: (text: string) => void;
  onDone: () => void;
}

/** Shown once fewer than this many characters are left. */
const COUNT_FROM = 100;

/** The optional comment on a Ja or Nvt answer. Never blocks: empty is fine. */
export function NoteSheet({ open, onOpenChange, text, onChange, onDone }: NoteSheetProps) {
  const ids = { field: useId(), hint: useId(), count: useId() };
  const left = LIMITS.comment - text.length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Opmerking">
      <label htmlFor={ids.field} className="sr-only">
        Opmerking
      </label>
      <textarea
        id={ids.field}
        rows={4}
        value={text}
        maxLength={LIMITS.comment}
        aria-describedby={left <= COUNT_FROM ? `${ids.hint} ${ids.count}` : ids.hint}
        onChange={(e) => onChange(e.target.value.slice(0, LIMITS.comment))}
        className={
          'block min-h-[110px] w-full resize-none rounded-chunky border-2 border-grey bg-[#f7f7f7] p-3.5 text-[17px] font-bold text-ink ' +
          'focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-brand-d'
        }
      />
      <p id={ids.hint} className="mx-0.5 mt-2.5 mb-0 text-[15px] text-sub">
        Niet verplicht. Mag kort.
      </p>
      {left <= COUNT_FROM && (
        <p id={ids.count} aria-live="polite" className="mx-0.5 mt-1.5 mb-0 text-[15px] text-sub">
          Nog {left} tekens over.
        </p>
      )}
      {/* Sticky: with the keyboard open the sheet may scroll, Klaar stays in sight. */}
      <div className="sticky -bottom-px -mx-[18px] mt-2 bg-white px-[18px] pt-2">
        <ChunkyButton onClick={onDone}>Klaar</ChunkyButton>
      </div>
    </Sheet>
  );
}
