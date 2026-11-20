// fontkit ships no types. Only what layout.ts uses: opening a TTF from a buffer and
// asking whether it has a glyph.
declare module 'fontkit' {
  export interface Font {
    hasGlyphForCodePoint(codePoint: number): boolean;
  }
  export function create(buffer: Buffer): Font;
}
