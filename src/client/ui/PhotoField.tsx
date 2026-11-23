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
  /** The heading; "Foto's" by default. */
  title?: string;
}

type Source = 'camera' | 'gallery';

/**
 * "Foto's (niet verplicht)": "Foto maken" opens the camera, "Uit galerij" the gallery, and the
 * photos so far with a remove button each. Two buttons, because without `capture` some Android
 * phones offer only the gallery. Used by the Nee sheet and the "Wat gaat hier goed?" question.
 */
export function PhotoField({ photos, fullNote, onAdd, onRemove, error, title = "Foto's" }: PhotoFieldProps) {
  const [busy, setBusy] = useState<Source | null>(null);
  const [photoError, setPhotoError] = useState('');
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const ids = { note: useId(), optional: useId() };
  const describedBy = fullNote ? `${ids.optional} ${ids.note}` : ids.optional;

  async function pick(e: ChangeEvent<HTMLInputElement>, source: Source) {
    const file = e.target.files?.[0];
    // Allow picking the same file again later.
    e.target.value = '';
    if (!file) return;
    setPhotoError('');
    setBusy(source);
    try {
      onAdd(await compressPhoto(file));
    } catch (err) {
      setPhotoError(err instanceof PhotoError ? err.message : new PhotoError().message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {/* Same heading style as "Opgelost vóór", marked optional. */}
      <p className="mt-5 mb-2 flex items-center gap-2 text-[19px] font-black leading-tight text-ink">
        {title}
        <span id={ids.optional} className="rounded-full bg-grey/70 px-2.5 py-0.5 text-[13px] font-extrabold text-sub">
          Niet verplicht
        </span>
      </p>
      <div className="mb-3 grid grid-cols-2 gap-2.5">
        <ChunkyButton
          variant="line"
          busy={busy === 'camera'}
          disabled={fullNote !== ''}
          aria-describedby={describedBy}
          onClick={() => cameraRef.current?.click()}
        >
          <CameraIcon />
          Foto maken
        </ChunkyButton>
        <ChunkyButton
          variant="line"
          busy={busy === 'gallery'}
          disabled={fullNote !== ''}
          aria-describedby={describedBy}
          onClick={() => galleryRef.current?.click()}
        >
          <GalleryIcon />
          Uit galerij
        </ChunkyButton>
      </div>
      {/* `capture`: straight to the back camera. Without it: the gallery (and on some phones the camera too). */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void pick(e, 'camera')} />
      <input ref={galleryRef} type="file" accept="image/*" hidden onChange={(e) => void pick(e, 'gallery')} />
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

function GalleryIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[22px]" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m21 16-5-5-9 9" />
    </svg>
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
