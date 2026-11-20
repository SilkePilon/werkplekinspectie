// Builds the client into a temp folder (self-contained: no earlier `vite build` needed)
// and checks the PWA output: manifest, icons, service worker and a CSP-safe index.html.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
let outDir: string;

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'werkplekinspectie-build-'));
  // vite-plugin-pwa prints its own build summary with console.log.
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    await build({
      root: ROOT,
      configFile: join(ROOT, 'vite.config.ts'),
      logLevel: 'silent',
      build: { outDir, emptyOutDir: true },
    });
  } finally {
    log.mockRestore();
  }
}, 180_000);

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

const read = (file: string) => readFileSync(join(outDir, file), 'utf8');

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

describe('manifest.webmanifest', () => {
  test('has the app name, Dutch language, colours and standalone display', () => {
    const m = JSON.parse(read('manifest.webmanifest')) as Record<string, unknown>;
    expect(m).toMatchObject({
      name: 'Werkplekinspectie',
      short_name: 'Inspectie',
      description: 'Werkplekinspectie Arbo en Milieu invullen, ondertekenen en versturen.',
      lang: 'nl',
      display: 'standalone',
      orientation: 'portrait',
      start_url: '/',
      scope: '/',
      theme_color: '#431961',
      background_color: '#FFFFFF',
    });
  });

  test('lists 192 and 512 icons plus a maskable one, and each file is in the build', () => {
    const { icons } = JSON.parse(read('manifest.webmanifest')) as { icons: ManifestIcon[] };
    const byPurpose = (p: string) => icons.filter((i) => (i.purpose ?? 'any') === p).map((i) => i.sizes);
    expect(byPurpose('any')).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(byPurpose('maskable')).toEqual(['512x512']);
    for (const icon of icons) {
      expect(icon.type).toBe('image/png');
      expect(existsSync(join(outDir, icon.src))).toBe(true);
    }
  });
});

describe('sw.js', () => {
  test('exists, precaches the app shell and never mentions the API', () => {
    const sw = read('sw.js');
    expect(sw).toContain('index.html');
    expect(sw).not.toContain('/api/inspecties');
    expect(sw).not.toContain('/api/branding');
  });

  test('serves index.html for navigations, except /api/ and /healthz', () => {
    const sw = read('sw.js').replace(/\s+/g, '');
    expect(sw).toContain('createHandlerBoundToURL("/index.html")');
    expect(sw).toContain('denylist:[/^\\/api\\//,/^\\/healthz/]');
  });
});

describe('index.html', () => {
  test('has no inline <script> (the CSP allows only scripts from self)', () => {
    const html = read('index.html');
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) expect(tag).toMatch(/\ssrc="[^"]+"/);
  });

  test('links the manifest, the service worker registration and the icons', () => {
    const html = read('index.html');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest">');
    expect(html).toContain('src="/registerSW.js"');
    expect(existsSync(join(outDir, 'registerSW.js'))).toBe(true);
    for (const href of ['/icons/favicon.ico', '/icons/apple-touch-icon-180x180.png']) {
      expect(html).toContain(`href="${href}"`);
      expect(existsSync(join(outDir, href))).toBe(true);
    }
  });
});
