// Generates the PWA icons from public/icons/icon.svg: `npm run icons`. The PNGs are committed.
import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

const ORANGE = '#FF5800';
// The icon is an orange rounded square, so padding on orange blends into one full-bleed tile.
// The mark stays inside the maskable safe zone (the inner circle of 80%).
const onOrange = { padding: 0.1, resizeOptions: { background: ORANGE } };

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    transparent: { ...minimal2023Preset.transparent, sizes: [192, 512] },
    maskable: { ...minimal2023Preset.maskable, ...onOrange },
    apple: { ...minimal2023Preset.apple, ...onOrange },
  },
  images: ['public/icons/icon.svg'],
});
