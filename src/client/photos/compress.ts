// Shrinks a photo on the phone before it goes into the draft: max 1600px, JPEG at quality 0.7.
import imageCompression from 'browser-image-compression';
import { LIMITS } from '@shared/schema';

const MESSAGE = 'Deze foto kan niet gebruikt worden. Maak een nieuwe foto.';

/** The photo could not be decoded or compressed; `message` is ready to show to the user. */
export class PhotoError extends Error {
  constructor() {
    super(MESSAGE);
    this.name = 'PhotoError';
  }
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

/** A `data:image/jpeg;base64,…` URL. Throws PhotoError when the file is not a usable image. */
export async function compressPhoto(file: File): Promise<string> {
  let url: string;
  try {
    const blob = await imageCompression(file, {
      maxWidthOrHeight: 1600,
      initialQuality: 0.7,
      fileType: 'image/jpeg',
      useWebWorker: true,
    });
    // The server refuses larger photos; better to say so now than at sending time.
    if (blob.size > LIMITS.photoBytes) throw new PhotoError();
    url = await toDataUrl(blob);
  } catch {
    throw new PhotoError();
  }
  // The server accepts only JPEG and PNG; anything else would fail at sending time.
  if (!url.startsWith('data:image/jpeg;base64,')) throw new PhotoError();
  return url;
}
