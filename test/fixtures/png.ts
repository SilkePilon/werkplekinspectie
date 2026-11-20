// Builds PNG files in tests: real ones, and hostile ones (decompression bombs, interlaced).
import { crc32, deflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export function pngChunk(type: string, data: Buffer = Buffer.alloc(0)): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

export interface PngOptions {
  width: number;
  height: number;
  /** Default 6 (RGBA), what a canvas exports. */
  colorType?: number;
  bitDepth?: number;
  interlace?: number;
  /** Bytes the IDAT stream inflates to. Default: exactly what the size needs (all zero). */
  rawBytes?: number;
  /** Split the IDAT stream over this many chunks. */
  idatChunks?: number;
  /** Leave out the IEND chunk. */
  noEnd?: boolean;
}

/** Scanline bytes a non-interlaced PNG of this size inflates to. */
export function pngRawBytes(width: number, height: number, colorType = 6, bitDepth = 8): number {
  return height * (1 + Math.ceil((width * CHANNELS[colorType]! * bitDepth) / 8));
}

export function makePng(opts: PngOptions): Buffer {
  const { width, height, colorType = 6, bitDepth = 8, interlace = 0, idatChunks = 1 } = opts;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(bitDepth, 8);
  ihdr.writeUInt8(colorType, 9);
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(interlace, 12);
  const raw = Buffer.alloc(opts.rawBytes ?? pngRawBytes(width, height, colorType, bitDepth));
  const z = deflateSync(raw, { level: 9 });
  const step = Math.ceil(z.length / idatChunks);
  const idat = Array.from({ length: idatChunks }, (_, i) => pngChunk('IDAT', z.subarray(i * step, (i + 1) * step)));
  const plte = colorType === 3 ? [pngChunk('PLTE', Buffer.from([0x43, 0x19, 0x61]))] : [];
  return Buffer.concat([
    SIGNATURE,
    pngChunk('IHDR', ihdr),
    ...plte,
    ...idat,
    ...(opts.noEnd ? [] : [pngChunk('IEND')]),
  ]);
}

export const pngDataUrl = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`;
