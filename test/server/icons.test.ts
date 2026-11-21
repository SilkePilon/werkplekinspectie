import { inflateSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import { renderIcons } from '../../src/server/icons.js';

// A white rounded tile with an orange square in the middle, like the configured icon.
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">' +
    '<rect width="512" height="512" rx="112" fill="#FFFFFF"/>' +
    '<rect x="156" y="156" width="200" height="200" fill="#FF5800"/></svg>',
);

function size(png: Buffer): [number, number] {
  expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

/**
 * RGBA of one pixel. resvg writes 8-bit RGBA without interlacing, so a small decoder will do:
 * join the IDAT chunks, inflate, and undo the per-row filters.
 */
function pixel(png: Buffer, x: number, y: number): number[] {
  const [width, height] = size(png);
  expect([png[24], png[25], png[28]]).toEqual([8, 6, 0]);
  const idat: Buffer[] = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    if (png.toString('latin1', at + 4, at + 8) === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const rows: Buffer[] = [];
  for (let r = 0; r <= y && r < height; r++) {
    const filter = raw[r * (stride + 1)]!;
    const line = Buffer.from(raw.subarray(r * (stride + 1) + 1, (r + 1) * (stride + 1)));
    const up = rows[r - 1] ?? Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? line[i - 4]! : 0;
      const b = up[i]!;
      const c = i >= 4 ? up[i - 4]! : 0;
      const p = a + b - c;
      const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      const add = [0, a, b, (a + b) >> 1, paeth][filter]!;
      line[i] = (line[i]! + add) & 0xff;
    }
    rows.push(line);
  }
  return [...rows[y]!.subarray(x * 4, x * 4 + 4)];
}

describe('renderIcons', () => {
  const icons = renderIcons(SVG, '#431961');
  const body = (path: string) => icons.get(path)!.body;

  test('makes every file the manifest and index.html point to, at the right size', () => {
    expect([...icons.keys()].sort()).toEqual([
      '/icons/apple-touch-icon-180x180.png',
      '/icons/favicon.ico',
      '/icons/icon.svg',
      '/icons/maskable-icon-512x512.png',
      '/icons/pwa-192x192.png',
      '/icons/pwa-512x512.png',
    ]);
    expect(size(body('/icons/pwa-192x192.png'))).toEqual([192, 192]);
    expect(size(body('/icons/pwa-512x512.png'))).toEqual([512, 512]);
    expect(size(body('/icons/maskable-icon-512x512.png'))).toEqual([512, 512]);
    expect(size(body('/icons/apple-touch-icon-180x180.png'))).toEqual([180, 180]);
    expect(icons.get('/icons/icon.svg')).toEqual({ type: 'image/svg+xml', body: SVG });
  });

  test('the plain icons keep transparent corners; maskable and Apple fill them with the background', () => {
    expect((pixel(body('/icons/pwa-512x512.png'), 0, 0))[3]).toBe(0);
    expect(pixel(body('/icons/pwa-512x512.png'), 256, 256)).toEqual([255, 88, 0, 255]);
    expect(pixel(body('/icons/maskable-icon-512x512.png'), 2, 2)).toEqual([0x43, 0x19, 0x61, 255]);
    expect(pixel(body('/icons/maskable-icon-512x512.png'), 256, 256)).toEqual([255, 88, 0, 255]);
    expect(pixel(body('/icons/apple-touch-icon-180x180.png'), 1, 1)).toEqual([0x43, 0x19, 0x61, 255]);
  });

  test('the favicon is an .ico with one 48px PNG inside', () => {
    const ico = body('/icons/favicon.ico');
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([0, 1, 1]);
    expect([ico[6], ico[7]]).toEqual([48, 48]);
    const png = ico.subarray(ico.readUInt32LE(18));
    expect(png.length).toBe(ico.readUInt32LE(14));
    expect(size(png)).toEqual([48, 48]);
  });

  test('refuses something that is not an SVG, and an oversized one', () => {
    expect(() => renderIcons(Buffer.from('geen svg'), '#FFFFFF')).toThrow();
    expect(() => renderIcons(Buffer.alloc(600 * 1024, 32), '#FFFFFF')).toThrow(/groter/);
  });
});
