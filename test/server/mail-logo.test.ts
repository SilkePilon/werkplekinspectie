import { describe, expect, test } from 'vitest';
import { imageSize, sniffImage } from '../../src/server/images.js';
import { mailLogo } from '../../src/server/mail/logo.js';
import { makePng } from '../fixtures/png.js';

const svg = (w: number, h: number) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#ff5800"/></svg>`);

describe('mailLogo', () => {
  test('an SVG becomes a PNG at twice the size it is shown: 44px high, width to scale', async () => {
    const logo = await mailLogo({ data: svg(300, 100), kind: 'svg' });
    expect(logo).toBeDefined();
    expect(sniffImage(logo!.png)).toBe('png');
    expect(imageSize(logo!.png, 'png')).toEqual({ width: 264, height: 88 });
    expect({ width: logo!.width, height: logo!.height }).toEqual({ width: 132, height: 44 });
  });

  test('a very wide logo is capped at 240px wide instead', async () => {
    const logo = await mailLogo({ data: svg(1000, 100), kind: 'svg' });
    expect({ width: logo!.width, height: logo!.height }).toEqual({ width: 240, height: 24 });
  });

  test('a PNG is sent as it is, sized by its own proportions', async () => {
    const png = makePng({ width: 400, height: 100 });
    const logo = await mailLogo({ data: png, kind: 'png' });
    expect(logo!.png).toBe(png);
    expect({ width: logo!.width, height: logo!.height }).toEqual({ width: 176, height: 44 });
  });

  test('a logo that cannot be rendered gives undefined: the mail then goes without', async () => {
    expect(await mailLogo({ data: Buffer.from('not an svg'), kind: 'svg' })).toBeUndefined();
    expect(await mailLogo({ data: Buffer.from('not a png'), kind: 'png' })).toBeUndefined();
  });
});
