// The app icon from config: one square SVG becomes every icon file the PWA asks for, under the
// same paths as the built-in icons, so manifest and index.html need no change.
import { Resvg } from '@resvg/resvg-js';

export interface IconFile {
  type: string;
  body: Buffer;
}

/** Same share as pwa-assets.config.ts: the icon at 80%, so it stays in the maskable safe zone. */
const PADDING = 0.1;
const MAX_SVG_BYTES = 512 * 1024;

function render(svg: string, size: number, background?: string): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    // No system fonts and no outside files: an icon is shapes only.
    font: { loadSystemFonts: false },
    ...(background === undefined ? {} : { background }),
  });
  return resvg.render().asPng();
}

/** The icon scaled down to 80% on a full-bleed background, as the maskable and Apple icons need. */
function padded(svg: string, size: number, background: string): Buffer {
  const inner = Math.round(size * (1 - 2 * PADDING));
  const offset = Math.round(size * PADDING);
  const png = render(svg, inner).toString('base64');
  const tile =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
    `<rect width="${size}" height="${size}" fill="${background}"/>` +
    `<image href="data:image/png;base64,${png}" x="${offset}" y="${offset}" width="${inner}" height="${inner}"/>` +
    `</svg>`;
  return render(tile, size);
}

/** An .ico holding one PNG image: every browser since IE Vista reads that. */
function ico(png: Buffer, size: number): Buffer {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // one image
  header.writeUInt8(size, 6);
  header.writeUInt8(size, 7);
  header.writeUInt8(0, 8); // no palette
  header.writeUInt8(0, 9);
  header.writeUInt16LE(1, 10); // planes
  header.writeUInt16LE(32, 12); // bits per pixel
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(header.length, 18);
  return Buffer.concat([header, png]);
}

/**
 * Renders the icon set. Throws on an SVG that cannot be read, so a broken icon stops startup
 * just like a broken logo does.
 */
export function renderIcons(svgData: Buffer, background: string): Map<string, IconFile> {
  if (svgData.length > MAX_SVG_BYTES) throw new Error(`het icoon is groter dan ${MAX_SVG_BYTES} bytes`);
  const svg = svgData.toString('utf8');
  const png = 'image/png';
  return new Map<string, IconFile>([
    ['/icons/icon.svg', { type: 'image/svg+xml', body: svgData }],
    ['/icons/pwa-192x192.png', { type: png, body: render(svg, 192) }],
    ['/icons/pwa-512x512.png', { type: png, body: render(svg, 512) }],
    ['/icons/maskable-icon-512x512.png', { type: png, body: padded(svg, 512, background) }],
    ['/icons/apple-touch-icon-180x180.png', { type: png, body: padded(svg, 180, background) }],
    ['/icons/favicon.ico', { type: 'image/x-icon', body: ico(render(svg, 48), 48) }],
  ]);
}
