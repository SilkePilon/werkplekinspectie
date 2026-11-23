import { useId, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { PhotoError, compressPhoto } from '../photos/compress';
import { ChunkyButton } from './ChunkyButton';
import { cn } from './cn';

export interface PhotoFieldProps {
  photos: string[];
  /** Why no more photos can be added, e.g. the limit is reached; '' while adding is possible. */
  fullNote: string;
  /** Appends to the photos as they are when the compression finishes. */
  onAdd: (dataUrl: string) => void;
  onRemove: (index: number) => void;
  /** An error about the photos from outside, e.g. too many after a change elsewhere. */
  error?: string;
}

/**
 * "Foto's (niet verplicht)": a button that opens the camera or the gallery, and the photos taken
 * so far with a remove button each. Used by the Nee sheet and the "Wat gaat hier goed?" question.
 */
export function PhotoField({ photos, fullNote, onAdd, onRemove, error }: PhotoFieldProps) {
  const [busy, setBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const ids = { note: useId(), optional: useId() };

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Allow picking the same file again later.
    e.target.value = '';
    if (!file) return;
    setPhotoError('');
    setBusy(true);
    try {
      onAdd(await compressPhoto(file));
    } catch (err) {
      setPhotoError(err instanceof PhotoError ? err.message : new PhotoError().message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Same heading style as "Opgelost vóór", marked optional. */}
      <p className="mt-5 mb-2 flex items-center gap-2 text-[19px] font-black leading-tight text-ink">
        Foto&apos;s
        <span id={ids.optional} className="rounded-full bg-grey/70 px-2.5 py-0.5 text-[13px] font-extrabold text-sub">
          Niet verplicht
        </span>
      </p>
      <ChunkyButton
        variant="line"
        busy={busy}
        disabled={fullNote !== ''}
        aria-describedby={fullNote ? `${ids.optional} ${ids.note}` : ids.optional}
        className="mb-3"
        onClick={() => fileRef.current?.click()}
      >
        <CameraIcon />
        Foto toevoegen
      </ChunkyButton>
      {/* No `capture`: the phone then offers both the camera and the gallery. */}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void pick(e)} />
      {fullNote && (
        <p id={ids.note} className="mt-0 mb-3 text-[15px] text-sub">
          {fullNote}
        </p>
      )}
      <div role="alert">
        {photoError && <ErrorText>{photoError}</ErrorText>}
        {error && <ErrorText>{error}</ErrorText>}
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
                onClick={() => onRemove(i)}
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
    </>
  );
}

export function ErrorText({ id, children }: { id?: string; children: ReactNode }) {
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
