import { useId, useRef, useState } from 'react';
import { amsterdamDateKey } from '@shared/dates';
import { LIMITS } from '@shared/limits';
import type { NeeDetails } from '../state/draft';
import { ChunkyButton } from '../ui/ChunkyButton';
import { DatePicker } from '../ui/DatePicker';
import { ErrorText, PhotoField } from '../ui/PhotoField';
import { Sheet } from '../ui/Sheet';
import { cn } from '../ui/cn';

export interface NeeSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  details: NeeDetails | undefined;
  /** YYYY-MM-DD: the Amsterdam calendar day the inspection started. */
  minDate: string;
  /** Photos already attached to other Nee items of this draft. */
  photosElsewhere: number;
  onChange: (details: Partial<NeeDetails>) => void;
  /** Appends to the item's photos as they are when the compression finishes. */
  onAddPhoto: (dataUrl: string) => void;
  /** Called only when the details are complete. */
  onDone: () => void;
}

/** Shown once fewer than this many characters are left. */
const COUNT_FROM = 100;

interface Errors {
  comment?: string;
  date?: string;
  photos?: string;
}

/** Photos over the per-item or the total limit, e.g. kept from before and back after Nee again. */
function photosOver(count: number, elsewhere: number): number {
  return Math.max(count - LIMITS.photosPerItem, elsewhere + count - LIMITS.photosTotal, 0);
}

function validate(comment: string, date: string, minDate: string, extraPhotos: number): Errors {
  const errors: Errors = {};
  if (comment.trim() === '') errors.comment = 'Schrijf kort op wat er mis is.';
  else if (comment.length > LIMITS.comment) errors.comment = `Gebruik maximaal ${LIMITS.comment} tekens.`;
  if (date === '') errors.date = 'Kies een datum.';
  // Both are YYYY-MM-DD, so string order is date order.
  else if (date < minDate) errors.date = 'Kies een datum vanaf vandaag.';
  if (extraPhotos > 0) errors.photos = `Je hebt te veel foto's. Verwijder er ${extraPhotos}.`;
  return errors;
}

// The same text box as the Opmerking sheet.
const fieldClass =
  'block min-h-[110px] w-full resize-none rounded-chunky border-2 bg-[#f7f7f7] p-3.5 text-[17px] font-bold text-ink ' +
  'focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-brand-d';

export function NeeSheet({
  open,
  onOpenChange,
  details,
  minDate,
  photosElsewhere,
  onChange,
  onAddPhoto,
  onDone,
}: NeeSheetProps) {
  const comment = details?.comment ?? '';
  const date = details?.actionBefore ?? '';
  const photos = details?.photos ?? [];

  const [tried, setTried] = useState(false);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const [today] = useState(() => amsterdamDateKey(new Date().toISOString()));
  const ids = {
    comment: useId(),
    commentError: useId(),
    count: useId(),
    dateError: useId(),
  };

  const extraPhotos = photosOver(photos.length, photosElsewhere);
  const errors = tried ? validate(comment, date, minDate, extraPhotos) : {};
  const left = LIMITS.comment - comment.length;
  const perItemFull = photos.length >= LIMITS.photosPerItem;
  const totalFull = photosElsewhere + photos.length >= LIMITS.photosTotal;
  const photoNote = perItemFull
    ? `Maximaal ${LIMITS.photosPerItem} foto's per vraag.`
    : totalFull
      ? `Maximaal ${LIMITS.photosTotal} foto's per inspectie.`
      : '';

  function submit() {
    setTried(true);
    const found = validate(comment, date, minDate, extraPhotos);
    if (found.comment) commentRef.current?.focus();
    else if (found.date) dateRef.current?.focus();
    else if (!found.photos) onDone();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Wat is er mis?">
      <label htmlFor={ids.comment} className="sr-only">
        Wat is er mis?
      </label>
      <textarea
        id={ids.comment}
        ref={commentRef}
        rows={4}
        value={comment}
        maxLength={LIMITS.comment}
        aria-invalid={errors.comment ? true : undefined}
        aria-describedby={idList(errors.comment && ids.commentError, left <= COUNT_FROM && ids.count)}
        className={cn(fieldClass, errors.comment ? 'border-coral' : 'border-grey hover:border-grey-d')}
        onChange={(e) => onChange({ comment: e.target.value.slice(0, LIMITS.comment) })}
      />
      {errors.comment && <ErrorText id={ids.commentError}>{errors.comment}</ErrorText>}
      {left <= COUNT_FROM && (
        <p id={ids.count} aria-live="polite" className="mt-1.5 mb-0 text-[15px] text-sub">
          Nog {left} tekens over.
        </p>
      )}

      <div className="mt-5">
        <DatePicker
          legend="Opgelost vóór"
          value={date}
          min={minDate}
          today={today}
          focusRef={dateRef}
          invalid={errors.date !== undefined}
          describedBy={errors.date ? ids.dateError : undefined}
          onChange={(d) => onChange({ actionBefore: d })}
        />
      </div>
      {errors.date && <ErrorText id={ids.dateError}>{errors.date}</ErrorText>}

      <PhotoField
        photos={photos}
        fullNote={photoNote}
        error={errors.photos}
        onAdd={onAddPhoto}
        onRemove={(i) => onChange({ photos: photos.filter((_, j) => j !== i) })}
      />

      {/* Sticky: with the keyboard open the sheet may scroll, Doorgaan stays in sight. */}
      <div className="sticky -bottom-px -mx-[18px] bg-white px-[18px] pt-2">
        <ChunkyButton onClick={submit}>
          Doorgaan
        </ChunkyButton>
      </div>
    </Sheet>
  );
}

function idList(...ids: (string | false | undefined)[]): string | undefined {
  return ids.filter(Boolean).join(' ') || undefined;
}
