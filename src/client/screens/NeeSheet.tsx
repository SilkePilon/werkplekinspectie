import { useId, useRef, useState, type ChangeEvent } from 'react';
import { amsterdamDateKey } from '@shared/dates';
import { LIMITS } from '@shared/limits';
import { PhotoError, compressPhoto } from '../photos/compress';
import type { NeeDetails } from '../state/draft';
import { ChunkyButton } from '../ui/ChunkyButton';
import { DatePicker } from '../ui/DatePicker';
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
  const [busy, setBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const dateRef = useRef<HTMLButtonElement>(null);
  const [today] = useState(() => amsterdamDateKey(new Date().toISOString()));
  const fileRef = useRef<HTMLInputElement>(null);
  const ids = {
    comment: useId(),
    commentError: useId(),
    count: useId(),
    dateError: useId(),
    photoNote: useId(),
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

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Allow picking the same file again later.
    e.target.value = '';
    if (!file) return;
    setPhotoError('');
    setBusy(true);
    try {
      onAddPhoto(await compressPhoto(file));
    } catch (err) {
      setPhotoError(err instanceof PhotoError ? err.message : new PhotoError().message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Wat is er mis?" tone="nee">
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

      <div className="mt-4">
        <DatePicker
          legend="Opgelost vóór"
          value={date}
          min={minDate}
          today={today}
          focusRef={dateRef}
          describedBy={errors.date ? ids.dateError : undefined}
          onChange={(d) => onChange({ actionBefore: d })}
        />
      </div>
      {errors.date && <ErrorText id={ids.dateError}>{errors.date}</ErrorText>}

      <ChunkyButton
        variant="line"
        busy={busy}
        disabled={perItemFull || totalFull}
        aria-describedby={photoNote ? ids.photoNote : undefined}
        className="mt-4 mb-3"
        onClick={() => fileRef.current?.click()}
      >
        <CameraIcon />
        Foto toevoegen
      </ChunkyButton>
      {/* No `capture`: the phone then offers both the camera and the gallery. */}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void pick(e)} />
      {photoNote && (
        <p id={ids.photoNote} className="mt-0 mb-3 text-[15px] text-sub">
          {photoNote}
        </p>
      )}
      <div role="alert">
        {photoError && <ErrorText>{photoError}</ErrorText>}
        {errors.photos && <ErrorText>{errors.photos}</ErrorText>}
      </div>

      {photos.length > 0 && (
        <ul className="m-0 mb-4 flex list-none flex-wrap gap-3 p-0">
          {photos.map((src, i) => (
            <li key={i} className="relative motion-safe:animate-pop">
              <img src={src} alt={`Foto ${i + 1}`} className="size-[76px] rounded-xl border-2 border-grey object-cover" />
              <button
                type="button"
                aria-label="Foto verwijderen"
                className={cn(
                  'group absolute -top-3.5 -right-3.5 grid size-11 place-items-center rounded-full',
                  'focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-brand-d',
                )}
                onClick={() => onChange({ photos: photos.filter((_, j) => j !== i) })}
              >
                <span aria-hidden="true" className="grid size-7 place-items-center rounded-full bg-ink text-white group-hover:bg-coral-d motion-safe:transition-colors">
                  <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Sticky: with the keyboard open the sheet may scroll, Doorgaan stays in sight. */}
      <div className="sticky -bottom-px -mx-[18px] bg-white px-[18px] pt-2">
        <ChunkyButton variant="coral" onClick={submit}>
          Doorgaan
        </ChunkyButton>
      </div>
    </Sheet>
  );
}

function idList(...ids: (string | false | undefined)[]): string | undefined {
  return ids.filter(Boolean).join(' ') || undefined;
}

function ErrorText({ id, children }: { id?: string; children: string }) {
  return (
    <p id={id} className="mt-1.5 mb-2 flex items-center gap-1.5 text-[15px] font-extrabold text-coral-d motion-safe:animate-rise">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5v5.5M12 16.5v.01" />
      </svg>
      {children}
    </p>
  );
}

function CameraIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[22px]" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  );
}
