// Turns the photo and signature data URLs from a submission into raw bytes, checks
// that the bytes really are a JPEG or PNG, and reads the pixel size from the header
// so oversized images are refused before they reach the PDF. A PNG is parsed with png-js
// (as pdfkit does) and its pixel data inflated with a hard cap, because pdfkit inflates it
// without any limit.
import { inflateSync } from 'node:zlib';
// The same module pdfkit imports, so the checks see the file exactly as pdfkit will.
import PNG from 'png-js';

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

/** Bit depths the PNG spec allows per colour type, limited to 8 bits: a canvas exports 8. */
const PNG_DEPTHS: Partial<Record<number, number[]>> = {
  0: [1, 2, 4, 8],
  2: [8],
  3: [1, 2, 4, 8],
  4: [8],
  6: [8],
};
/** Colour types that may carry a tRNS chunk; png-js mis-parses it on the others. */
const TRNS_TYPES = new Set([0, 2, 3]);
const IHDR_LENGTH = 13;
/** The PNG spec's maximum chunk length. */
const MAX_CHUNK = 2 ** 31 - 1;

const bad = (message: string) => new InvalidImageError(message);

/**
 * Strict chunk structure, so no PNG parser can read the file in two ways: IHDR first, exactly
 * 13 bytes and only once; every chunk inside the file; tRNS only where the spec allows it and
 * at most once; at least one IDAT; IEND present. Defence in depth for checkPngPixels.
 */
export function checkPngStructure(data: Buffer): void {
  if (sniffImage(data) !== 'png') throw bad('Geen PNG');
  let pos = 8;
  let colorType: number | undefined;
  let idat = 0;
  let trns = 0;
  while (pos + 12 <= data.length) {
    const length = data.readUInt32BE(pos);
    const type = data.toString('latin1', pos + 4, pos + 8);
    const body = pos + 8;
    if (length > MAX_CHUNK || body + length + 4 > data.length) throw bad('PNG-chunk loopt voorbij het einde');
    if (colorType === undefined && type !== 'IHDR') throw bad('PNG begint niet met IHDR');
    switch (type) {
      case 'IHDR':
        if (colorType !== undefined) throw bad('PNG met meer dan één IHDR');
        if (length !== IHDR_LENGTH) throw bad('PNG-IHDR heeft de verkeerde lengte');
        colorType = data.readUInt8(body + 9);
        break;
      case 'tRNS':
        trns += 1;
        if (!TRNS_TYPES.has(colorType!) || trns > 1) throw bad('PNG-tRNS niet toegestaan');
        break;
      case 'IDAT':
        idat += 1;
        break;
      case 'IEND':
        if (idat === 0) throw bad('PNG zonder pixeldata');
        return;
    }
    pos = body + length + 4;
  }
  throw bad('PNG zonder IEND');
}

/**
 * Parses the PNG with png-js, the parser pdfkit uses, and checks what *it* found: the size
 * against `max`, no interlacing, 8 bits or less, and pixel data that inflates to exactly
 * what that size needs. Inflating stops at that length, so a decompression bomb (a tiny
 * file whose pixel data inflates to gigabytes) costs no memory. Throws InvalidImageError.
 */
export function checkPngPixels(data: Buffer, max: ImageSize): void {
  let png: PNG;
  try {
    png = new PNG(data);
  } catch {
    throw bad('PNG niet leesbaar');
  }
  const { width, height, bits, colorType } = png;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw bad('Afmetingen van de afbeelding niet leesbaar');
  }
  if (width > max.width || height > max.height) throw bad('Afbeelding te groot');
  if (!PNG_DEPTHS[colorType]?.includes(bits)) throw bad('PNG-kleurtype of bitdiepte niet ondersteund');
  if (png.compressionMethod !== 0 || png.filterMethod !== 0 || png.interlaceMethod !== 0) {
    throw bad('PNG-indeling niet ondersteund');
  }
  if (png.imgData.length === 0) throw bad('PNG zonder pixeldata');

  const channels = png.colors + (png.hasAlphaChannel ? 1 : 0);
  const expected = height * (1 + Math.ceil((width * channels * bits) / 8));
  let pixels: Buffer;
  try {
    // Stops with an error as soon as the output would grow past `expected`.
    pixels = inflateSync(png.imgData, { maxOutputLength: expected });
  } catch {
    throw bad('PNG-pixeldata ongeldig of te groot');
  }
  if (pixels.length !== expected) throw bad('PNG-pixeldata past niet bij de afmetingen');
}

/** Both PNG checks: the strict structure, then what png-js parsed. Throws InvalidImageError. */
export function checkPng(data: Buffer, max: ImageSize): void {
  checkPngStructure(data);
  checkPngPixels(data, max);
}
