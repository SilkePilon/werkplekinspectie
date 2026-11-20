import { describe, expect, test } from 'vitest';
import { InvalidImageError, decodeDataUrl } from '../../src/server/images.js';

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
