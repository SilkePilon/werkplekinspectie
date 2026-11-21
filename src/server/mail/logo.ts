// The logo for the notification mail. Gmail and Outlook do not show SVG, and a remote image
// would be fetched (and often blocked) when the mail is opened, so the configured logo is made
// into a PNG once at startup and sent inside the mail as an inline attachment (cid:).
import { imageSize } from '../images.js';

export interface MailLogo {
  png: Buffer;
  /** CSS pixels the mail shows it at; the PNG itself has twice that, for sharp screens. */
  width: number;
  height: number;
}

/** Content-ID the HTML refers to as `cid:…`. */
export const LOGO_CID = 'logo@werkplekinspectie';

const HEIGHT = 44;
/** A very wide logo is scaled down to this width instead. */
const MAX_WIDTH = 240;
const SCALE = 2;

/** The logo as a mail-ready PNG, or undefined when it cannot be rendered: then the mail goes without. */
export async function mailLogo(logo: { data: Buffer; kind: 'svg' | 'png' }): Promise<MailLogo | undefined> {
  try {
    let png = logo.data;
    if (logo.kind === 'svg') {
      // A native module: only loaded when there is an SVG logo.
      const { Resvg } = await import('@resvg/resvg-js');
      png = new Resvg(logo.data.toString('utf8'), {
        fitTo: { mode: 'height', value: HEIGHT * SCALE },
        // No system fonts and no outside files: a logo is shapes only.
        font: { loadSystemFonts: false },
      })
        .render()
        .asPng();
    }
    const size = imageSize(png, 'png');
    let height = HEIGHT;
    let width = Math.round((size.width * HEIGHT) / size.height);
    if (width > MAX_WIDTH) {
      width = MAX_WIDTH;
      height = Math.round((size.height * MAX_WIDTH) / size.width);
    }
    return { png, width, height };
  } catch {
    return undefined;
  }
}
