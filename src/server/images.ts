// Turns the photo and signature data URLs from a submission into raw bytes, and
// checks that the bytes really are a JPEG or PNG before they reach the PDF.

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

function sniff(data: Buffer): ImageKind | undefined {
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
  const kind = sniff(data);
  if (kind === undefined) {
    throw new InvalidImageError('Bestand is geen JPEG of PNG');
  }
  if (kind !== PREFIXES[prefix]) {
    throw new InvalidImageError('Bestandstype past niet bij de data-URL');
  }
  return { kind, data };
}
