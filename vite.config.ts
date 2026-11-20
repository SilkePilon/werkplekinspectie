import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

const VIOLET = '#431961';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // The update banner asks first, and only on the start screen, never mid-inspection.
      registerType: 'prompt',
      // An external registerSW.js: the CSP allows no inline scripts.
      injectRegister: 'script',
      manifest: {
        name: 'Werkplekinspectie',
        short_name: 'Inspectie',
        description: 'Werkplekinspectie Arbo en Milieu invullen, ondertekenen en versturen.',
        lang: 'nl',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: VIOLET,
        background_color: '#FFFFFF',
        icons: [
          { src: '/icons/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache only the built app; /api is never cached (no runtimeCaching).
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/healthz/],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['test/**/*.test.{ts,tsx}'],
          exclude: ['test/client/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'client',
          environment: 'jsdom',
          include: ['test/client/**/*.test.{ts,tsx}'],
          setupFiles: ['test/client/setup.ts'],
          // jsdom has no service workers: the update hook is a stub there.
          alias: {
            'virtual:pwa-register/react': fileURLToPath(new URL('./test/client/pwa-register-stub.ts', import.meta.url)),
          },
        },
      },
    ],
  },
});
