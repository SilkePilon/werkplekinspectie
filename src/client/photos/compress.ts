// Shrinks a photo on the phone before it goes into the draft: max 1280px and 0.4 MB, JPEG at
// quality 0.7. In the PDF a photo fills half an A4, so 1280px still prints at about 200 dpi,
// and every byte saved here is a byte less to upload and mail when the inspection is sent.
// 15 photos of 0.4 MB plus the signature stay well under the 12 MB body limit.
import imageCompression from 'browser-image-compression';
import { LIMITS } from '@shared/limits';

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
      maxSizeMB: 0.4,
      maxWidthOrHeight: 1280,
      initialQuality: 0.7,
      fileType: 'image/jpeg',
      // The worker would load the library from a CDN, which the CSP (rightly) blocks.
      useWebWorker: false,
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
