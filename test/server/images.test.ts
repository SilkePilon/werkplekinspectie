import { describe, expect, test } from 'vitest';
import { InvalidImageError, decodeDataUrl, imageSize } from '../../src/server/images.js';

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
