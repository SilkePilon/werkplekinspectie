import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  InvalidImageError,
  checkPng,
  checkPngPixels,
  checkPngStructure,
  decodeDataUrl,
  imageSize,
} from '../../src/server/images.js';
import { makePng, pngChunk, pngHiddenInLongIhdr, pngHiddenInTrns, pngSecondIhdr } from '../fixtures/png.js';

// 1×1 pixels in brand violet, generated with ImageMagick (`convert -size 1x1 xc:'#431961' -strip`).
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEVDGWF0E/aVAAAACklEQVQI12NgAAAAAgAB4iG8MwAAAABJRU5ErkJggg==';
const JPEG_1X1 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCegK5j/9k=';
const GIF_1X1 = 'R0lGODlhAQABAPAAAEMZYQAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==';

const png = (b64: string) => `data:image/png;base64,${b64}`;
const jpeg = (b64: string) => `data:image/jpeg;base64,${b64}`;

describe('decodeDataUrl', () => {
  test('a real PNG gives kind png and its decoded bytes', () => {
    const result = decodeDataUrl(png(PNG_1X1));
    expect(result.kind).toBe('png');
    expect(result.data.equals(Buffer.from(PNG_1X1, 'base64'))).toBe(true);
    expect(result.data.length).toBe(82);
  });

  test('a real JPEG gives kind jpeg and its decoded bytes', () => {
    const result = decodeDataUrl(jpeg(JPEG_1X1));
    expect(result.kind).toBe('jpeg');
    expect(result.data.equals(Buffer.from(JPEG_1X1, 'base64'))).toBe(true);
    expect(result.data.length).toBe(287);
  });

  test.each([
    ['png prefix with GIF bytes', png(GIF_1X1)],
    ['jpeg prefix with GIF bytes', jpeg(GIF_1X1)],
    ['png prefix with JPEG bytes', png(JPEG_1X1)],
    ['jpeg prefix with PNG bytes', jpeg(PNG_1X1)],
    ['bytes that are no image at all', png(Buffer.from('hallo wereld!').toString('base64'))],
    ['only the first two JPEG magic bytes', jpeg(Buffer.from([0xff, 0xd8]).toString('base64'))],
    ['a truncated PNG signature', png(Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'))],
  ])('throws on %s', (_name, url) => {
    expect(() => decodeDataUrl(url)).toThrow(InvalidImageError);
  });

  test.each([
    ['garbage characters', png('niet-base64!!')],
    ['whitespace inside the payload', png(`${PNG_1X1.slice(0, 20)} ${PNG_1X1.slice(20)}`)],
    ['a newline inside the payload', png(`${PNG_1X1.slice(0, 20)}\n${PNG_1X1.slice(20)}`)],
    ['missing padding', png(PNG_1X1.replace(/=+$/, ''))],
    ['too much padding', png(`${PNG_1X1.slice(0, -2)}===`)],
    ['padding in the middle', png(`AA==${PNG_1X1}`)],
    ['the URL-safe alphabet', jpeg(JPEG_1X1.replaceAll('/', '_'))],
    ['an empty payload', png('')],
  ])('throws on non-base64 input: %s', (_name, url) => {
    expect(() => decodeDataUrl(url)).toThrow(InvalidImageError);
  });

  test.each([
    ['no data: prefix', PNG_1X1],
    ['an http URL', 'https://example.com/foto.png'],
    ['an empty string', ''],
    ['an unsupported MIME type', `data:image/gif;base64,${GIF_1X1}`],
    ['an uppercase prefix', `DATA:IMAGE/PNG;BASE64,${PNG_1X1}`],
    ['image/jpg instead of image/jpeg', `data:image/jpg;base64,${JPEG_1X1}`],
    ['a missing ;base64 marker', `data:image/png,${PNG_1X1}`],
    ['leading whitespace', ` ${png(PNG_1X1)}`],
  ])('throws on a bad prefix: %s', (_name, url) => {
    expect(() => decodeDataUrl(url)).toThrow(InvalidImageError);
  });

  test('InvalidImageError is a named Error', () => {
    let caught: unknown;
    try {
      decodeDataUrl('geen data-url');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).toBeInstanceOf(InvalidImageError);
    expect((caught as Error).name).toBe('InvalidImageError');
  });

  test('handles a payload of several megabytes without stack trouble', () => {
    const big = Buffer.concat([Buffer.from(JPEG_1X1, 'base64'), Buffer.alloc(3 * 1024 * 1024)]);
    const result = decodeDataUrl(jpeg(big.toString('base64')));
    expect(result.kind).toBe('jpeg');
    expect(result.data.length).toBe(big.length);
  });
});

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A PNG signature plus an IHDR chunk header claiming the given size (no pixel data). */
function pngHeader(width: number, height: number, type = 'IHDR'): Buffer {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write(type, 4, 'latin1');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  return Buffer.concat([PNG_SIGNATURE, ihdr]);
}

/** SOI, one APP0-like segment, then a frame header with the given SOF marker and size. */
function jpegHeader(sof: number, width: number, height: number): Buffer {
  const app = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
  const frame = Buffer.from([0xff, sof, 0x00, 0x0b, 0x08, 0, 0, 0, 0, 0x01, 0x01, 0x11, 0x00]);
  frame.writeUInt16BE(height, 5);
  frame.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app, frame]);
}

describe('imageSize', () => {
  test('reads 1x1 from the real PNG fixture', () => {
    expect(imageSize(Buffer.from(PNG_1X1, 'base64'), 'png')).toEqual({ width: 1, height: 1 });
  });

  test('reads 1x1 from the real JPEG fixture (SOF0 after APP0 and two DQT segments)', () => {
    expect(imageSize(Buffer.from(JPEG_1X1, 'base64'), 'jpeg')).toEqual({ width: 1, height: 1 });
  });

  test('reads the size a hand-made PNG header claims, however large', () => {
    expect(imageSize(pngHeader(10000, 10000), 'png')).toEqual({ width: 10000, height: 10000 });
    expect(imageSize(pngHeader(1600, 900), 'png')).toEqual({ width: 1600, height: 900 });
  });

  test('reads width and height in the right order from a JPEG frame header', () => {
    expect(imageSize(jpegHeader(0xc0, 1600, 1200), 'jpeg')).toEqual({ width: 1600, height: 1200 });
  });

  const hex = (markers: number[]) => markers.map((m) => [m.toString(16).toUpperCase(), m] as const);

  test.each(hex([0xc1, 0xc2, 0xc3, 0xc5, 0xc7, 0xc9, 0xcb, 0xcd, 0xcf]))(
    'accepts SOF marker FF%s as a frame header',
    (_name, sof) => {
      expect(imageSize(jpegHeader(sof, 30, 20), 'jpeg')).toEqual({ width: 30, height: 20 });
    },
  );

  test.each(hex([0xc4, 0xc8, 0xcc]))('skips FF%s (DHT, JPG, DAC) instead of reading it as a frame', (_name, marker) => {
    // The fake segment has the same shape as a frame header claiming 9999x9999.
    const fake = jpegHeader(marker, 9999, 9999).subarray(2);
    const real = jpegHeader(0xc0, 40, 30).subarray(2);
    const data = Buffer.concat([Buffer.from([0xff, 0xd8]), fake, real]);
    expect(imageSize(data, 'jpeg')).toEqual({ width: 40, height: 30 });
  });

  test.each([
    ['a PNG with zero width', pngHeader(0, 10), 'png'],
    ['a PNG with zero height', pngHeader(10, 0), 'png'],
    ['a PNG whose first chunk is not IHDR', pngHeader(10, 10, 'IDAT'), 'png'],
    ['a PNG cut off inside IHDR', pngHeader(10, 10).subarray(0, 20), 'png'],
    ['a PNG without signature', pngHeader(10, 10).subarray(8), 'png'],
    ['a JPEG with zero width', jpegHeader(0xc0, 0, 10), 'jpeg'],
    ['a JPEG with zero height', jpegHeader(0xc0, 10, 0), 'jpeg'],
    ['a JPEG cut off inside the frame header', jpegHeader(0xc0, 10, 10).subarray(0, 14), 'jpeg'],
    ['a JPEG without any frame header', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02, 0xff, 0xd9]), 'jpeg'],
    ['a JPEG whose scan starts before a frame header', Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]), 'jpeg'],
    ['a JPEG with a segment length below 2', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0xff, 0xc0]), 'jpeg'],
    ['a JPEG with garbage where a marker should be', Buffer.from([0xff, 0xd8, 0x12, 0x34]), 'jpeg'],
    ['a JPEG that is only SOI', Buffer.from([0xff, 0xd8]), 'jpeg'],
  ] as const)('throws InvalidImageError on %s', (_name, data, kind) => {
    expect(() => imageSize(data, kind)).toThrow(InvalidImageError);
  });
});

const MAX = { width: 2400, height: 1600 };
const BOMB_BYTES = 64 * 1024 * 1024;

/** Runs `fn`, which must throw InvalidImageError, and checks it allocated far less than the bomb. */
function refusesCheaply(fn: () => void) {
  const before = process.memoryUsage().rss;
  expect(fn).toThrow(InvalidImageError);
  expect(process.memoryUsage().rss - before).toBeLessThan(32 * 1024 * 1024);
}

const HOSTILE = [
  ['the plain bomb: 10x10 RGBA whose pixel data inflates to 64 MB', () => makePng({ width: 10, height: 10, rawBytes: BOMB_BYTES })],
  ['a second IHDR declaring 12000x12000', () => pngSecondIhdr(12000)],
  ['an IDAT bomb hidden inside a tRNS chunk of an RGBA PNG', () => pngHiddenInTrns(BOMB_BYTES)],
  ['an IDAT bomb hidden inside an IHDR longer than 13 bytes', () => pngHiddenInLongIhdr(BOMB_BYTES)],
] as const;

describe('checkPng', () => {
  test('accepts the real 1x1 palette PNG fixture', () => {
    expect(() => checkPng(Buffer.from(PNG_1X1, 'base64'), MAX)).not.toThrow();
  });

  test.each([
    ['RGBA 8-bit, as a canvas exports it', { width: 600, height: 200 }],
    ['RGBA 8-bit at the 2400x1600 maximum', { width: 2400, height: 1600 }],
    ['grey 1-bit with a width that is not a multiple of 8', { width: 13, height: 7, colorType: 0, bitDepth: 1 }],
    ['palette 4-bit', { width: 9, height: 3, colorType: 3, bitDepth: 4 }],
    ['grey+alpha 8-bit', { width: 5, height: 5, colorType: 4 }],
    ['pixel data over several IDAT chunks', { width: 300, height: 300, idatChunks: 4 }],
  ])('accepts a PNG with %s', (_name, opts) => {
    expect(() => checkPng(makePng(opts), MAX)).not.toThrow();
  });

  test.each(HOSTILE)('refuses %s, without inflating it', (_name, build) => {
    const png = build();
    expect(png.length).toBeLessThan(300_000);
    refusesCheaply(() => checkPng(png, MAX));
  });

  test('refuses a size over the maximum, also when only png-js would see it', () => {
    expect(() => checkPng(makePng({ width: 2401, height: 10 }), MAX)).toThrow(InvalidImageError);
    expect(() => checkPng(makePng({ width: 10, height: 1601 }), MAX)).toThrow(InvalidImageError);
  });

  test('refuses pixel data that inflates to one byte more than the size allows', () => {
    expect(() => checkPng(makePng({ width: 10, height: 10, rawBytes: 411 }), MAX)).toThrow(InvalidImageError);
  });

  test('refuses pixel data that is shorter than the size needs', () => {
    expect(() => checkPng(makePng({ width: 10, height: 10, rawBytes: 409 }), MAX)).toThrow(InvalidImageError);
  });

  test('refuses an interlaced PNG', () => {
    expect(() => checkPng(makePng({ width: 10, height: 10, interlace: 1 }), MAX)).toThrow(InvalidImageError);
  });

  test.each([
    ['an unknown colour type', { width: 4, height: 4, colorType: 5, rawBytes: 20 }],
    ['a bit depth RGBA does not allow', { width: 4, height: 4, colorType: 6, bitDepth: 4 }],
    ['16 bits per channel (a canvas exports 8)', { width: 10, height: 10, colorType: 6, bitDepth: 16 }],
    ['no IEND chunk', { width: 4, height: 4, noEnd: true }],
  ])('refuses a PNG with %s', (_name, opts) => {
    expect(() => checkPng(makePng(opts), MAX)).toThrow(InvalidImageError);
  });

  test('refuses a PNG without any IDAT chunk', () => {
    const png = makePng({ width: 4, height: 4 });
    const noIdat = Buffer.concat([png.subarray(0, 8 + 25), pngChunk('IEND')]);
    expect(() => checkPng(noIdat, MAX)).toThrow(InvalidImageError);
  });

  test('refuses a PNG whose chunk length runs past the end of the file', () => {
    const png = makePng({ width: 4, height: 4 });
    png.writeUInt32BE(0x7fffffff, 8 + 25);
    expect(() => checkPng(png, MAX)).toThrow(InvalidImageError);
  });

  test('refuses pixel data that is not a zlib stream', () => {
    const png = makePng({ width: 4, height: 4 });
    png.fill(0xaa, 8 + 25 + 8, 8 + 25 + 12);
    expect(() => checkPng(png, MAX)).toThrow(InvalidImageError);
  });

  test('refuses a header-only PNG', () => {
    expect(() => checkPng(pngHeader(10, 10), MAX)).toThrow(InvalidImageError);
  });
});

// Each layer on its own refuses every hostile shape: the structure check (defence in depth)
// and the check on what png-js itself parsed (what pdfkit will draw).
describe('checkPngStructure', () => {
  test.each(HOSTILE.slice(1))('refuses %s', (_name, build) => {
    expect(() => checkPngStructure(build())).toThrow(InvalidImageError);
  });

  test.each([
    ['tRNS on grey+alpha', () => Buffer.concat([pngHead(4, 4, 4), pngChunk('tRNS', Buffer.alloc(2)), ...pngTail(4, 4, 4)])],
    ['a chunk before IHDR', () => Buffer.concat([PNG_SIGNATURE, pngChunk('tEXt', Buffer.from('a\0b')), pngHead(4, 4).subarray(8), ...pngTail(4, 4)])],
  ])('refuses %s', (_name, build) => {
    expect(() => checkPngStructure(build())).toThrow(InvalidImageError);
  });

  test('allows tRNS where the spec allows it (palette)', () => {
    const png = Buffer.concat([pngHead(4, 4, 3, 8), pngChunk('PLTE', Buffer.alloc(3)), pngChunk('tRNS', Buffer.from([0])), ...pngTail(4, 4, 3, 8)]);
    expect(() => checkPngStructure(png)).not.toThrow();
    expect(() => checkPng(png, MAX)).not.toThrow();
  });

  test('accepts a canvas-like PNG', () => {
    expect(() => checkPngStructure(makePng({ width: 600, height: 200, idatChunks: 3 }))).not.toThrow();
  });
});

describe('checkPngPixels (on what png-js parsed)', () => {
  test.each(HOSTILE)('refuses %s', (_name, build) => {
    refusesCheaply(() => checkPngPixels(build(), MAX));
  });

  test('accepts a canvas-like PNG', () => {
    expect(() => checkPngPixels(makePng({ width: 2400, height: 1600, idatChunks: 5 }), MAX)).not.toThrow();
  });
});

/** Signature plus IHDR, as makePng writes them. */
function pngHead(width: number, height: number, colorType = 6, bitDepth = 8): Buffer {
  const png = makePng({ width, height, colorType, bitDepth });
  return png.subarray(0, 8 + 25);
}

/** IDAT and IEND, as makePng writes them. */
function pngTail(width: number, height: number, colorType = 6, bitDepth = 8): Buffer[] {
  const png = makePng({ width, height, colorType, bitDepth });
  const idat = png.indexOf('IDAT', 0, 'latin1') - 4;
  return [png.subarray(idat)];
}

test('images.ts and pdfkit load the same png-js package', () => {
  const fromImages = createRequire(new URL('../../src/server/images.ts', import.meta.url)).resolve('png-js');
  const pdfkit = createRequire(import.meta.url).resolve('pdfkit');
  const fromPdfkit = createRequire(pdfkit).resolve('png-js');
  expect(dirname(fromImages)).toBe(dirname(fromPdfkit));
});
