// Turns the photo and signature data URLs from a submission into raw bytes, checks
// that the bytes really are a JPEG or PNG, and reads the pixel size from the header
// so oversized images (decompression bombs) are refused before they reach the PDF.

export type ImageKind = 'jpeg' | 'png';

export class InvalidImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidImageError';
  }
}

/** The exact prefixes the client produces (canvas/toDataURL), case-sensitive. */
const PREFIXES: Record<string, ImageKind> = {
  'data:image/jpeg;base64,': 'jpeg',
  'data:image/png;base64,': 'png',
};

const MAGIC: Record<ImageKind, Buffer> = {
  jpeg: Buffer.from([0xff, 0xd8, 0xff]),
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
};

// A single character class keeps this linear and backtrack-free on multi-MB input;
// the length check below makes the `=` padding exact.
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** The image type the leading magic bytes announce, if JPEG or PNG. */
export function sniffImage(data: Buffer): ImageKind | undefined {
  return (Object.keys(MAGIC) as ImageKind[]).find((kind) =>
    data.subarray(0, MAGIC[kind].length).equals(MAGIC[kind]),
  );
}

/** Decodes a JPEG or PNG data URL. Throws InvalidImageError if anything is off. */
export function decodeDataUrl(url: string): { kind: ImageKind; data: Buffer } {
  const prefix = Object.keys(PREFIXES).find((p) => url.startsWith(p));
  if (prefix === undefined) {
    throw new InvalidImageError('Geen data-URL van een JPEG of PNG');
  }

  // Buffer.from(…, 'base64') silently skips bad characters, so check strictly first.
  const payload = url.slice(prefix.length);
  if (payload.length % 4 !== 0 || !BASE64.test(payload)) {
    throw new InvalidImageError('Ongeldige base64');
  }

  const data = Buffer.from(payload, 'base64');
  const kind = sniffImage(data);
  if (kind === undefined) {
    throw new InvalidImageError('Bestand is geen JPEG of PNG');
  }
  if (kind !== PREFIXES[prefix]) {
    throw new InvalidImageError('Bestandstype past niet bij de data-URL');
  }
  return { kind, data };
}

export interface ImageSize {
  width: number;
  height: number;
}

/** PNG: signature, then the IHDR chunk (length 13) holding width and height. */
function pngSize(data: Buffer): ImageSize | undefined {
  if (data.length < 24 || sniffImage(data) !== 'png') return undefined;
  if (data.toString('latin1', 12, 16) !== 'IHDR') return undefined;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

// SOF0–SOF15 carry the frame size, except C4 (DHT), C8 (JPG) and CC (DAC).
const isFrameHeader = (marker: number) =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
// Markers without a length field: TEM, RST0–RST7 and SOI.
const isStandalone = (marker: number) => marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8);
const SOS = 0xda;
const EOI = 0xd9;

/** JPEG: walk the marker segments up to the first frame header. */
function jpegSize(data: Buffer): ImageSize | undefined {
  if (sniffImage(data) !== 'jpeg') return undefined;
  let pos = 2;
  while (pos < data.length) {
    if (data[pos] !== 0xff) return undefined;
    // Any number of 0xFF fill bytes may precede a marker.
    while (data[pos] === 0xff) pos += 1;
    const marker = data[pos];
    pos += 1;
    if (marker === undefined || marker === SOS || marker === EOI) return undefined;
    if (isStandalone(marker)) continue;
    if (pos + 2 > data.length) return undefined;
    const length = data.readUInt16BE(pos);
    if (length < 2) return undefined;
    if (isFrameHeader(marker)) {
      // length(2) precision(1) height(2) width(2)
      if (length < 7 || pos + 7 > data.length) return undefined;
      return { width: data.readUInt16BE(pos + 5), height: data.readUInt16BE(pos + 3) };
    }
    pos += length;
  }
  return undefined;
}

/** Reads the pixel size from the image header. Throws InvalidImageError if it is missing or zero. */
export function imageSize(data: Buffer, kind: ImageKind): ImageSize {
  const size = kind === 'png' ? pngSize(data) : jpegSize(data);
  if (size === undefined || size.width === 0 || size.height === 0) {
    throw new InvalidImageError('Afmetingen van de afbeelding niet leesbaar');
  }
  return size;
}
