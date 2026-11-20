// Generates the PWA icons from public/icons/icon.svg: `npm run icons`. The PNGs are committed.
import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

const VIOLET = '#431961';
// The icon is a violet rounded square, so padding on violet blends into one full-bleed tile.
// The mark stays inside the maskable safe zone (the inner circle of 80%).
const onViolet = { padding: 0.1, resizeOptions: { background: VIOLET } };

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    transparent: { ...minimal2023Preset.transparent, sizes: [192, 512] },
    maskable: { ...minimal2023Preset.maskable, ...onViolet },
    apple: { ...minimal2023Preset.apple, ...onViolet },
  },
  images: ['public/icons/icon.svg'],
});
