// png-js ships no types. Only the fields images.ts reads after parsing.
declare module 'png-js' {
  export default class PNG {
    constructor(data: Uint8Array);
    width: number;
    height: number;
    bits: number;
    colorType: number;
    compressionMethod: number;
    filterMethod: number;
    interlaceMethod: number;
    /** Colour channels without alpha: 1 or 3. */
    colors: number;
    hasAlphaChannel: boolean;
    /** All IDAT data, concatenated. */
    imgData: Uint8Array;
  }
}
