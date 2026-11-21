// Starts the built server (`npm run build` output) as the container does and checks that
// it answers /healthz and serves the client. The SMTP host is fake: verify only logs a warning.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, expect, test } from 'vitest';
import type { renderInspectionPdf } from '../../src/server/pdf/render.js';
import { makeSubmission } from '../fixtures/submission.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ENTRY = join(ROOT, 'dist/server/server/index.js');
const CLIENT_INDEX = join(ROOT, 'dist/client/index.html');
const START_TIMEOUT_MS = 15_000;
const START_ATTEMPTS = 3;

let child: ChildProcess | undefined;
let baseUrl = '';

/** A port that was free a moment ago. Startup is retried in case another process takes it. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address !== null && typeof address === 'object') resolve(address.port);
        else reject(new Error('geen poort gekregen'));
      });
    });
  });
}

function serverEnv(port: number): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    NODE_ENV: 'test',
    PORT: String(port),
    PUBLIC_ORIGIN: 'http://localhost',
    MAIL_TO: 'vgm@example.com',
    MAIL_FROM: 'Werkplekinspectie <inspectie@example.com>',
    // Nothing listens on port 1, so the startup verify fails fast and only logs.
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: '1',
    SMTP_USER: 'example-user',
    SMTP_PASS: 'change-me',
  };
}

/** Resolves once /healthz answers 200; rejects if the process exits first or it takes too long. */
async function waitForHealth(proc: ChildProcess, url: string): Promise<void> {
  let exited = false;
  proc.once('exit', () => {
    exited = true;
  });
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (exited) throw new Error('server stopte tijdens het opstarten');
    try {
      const res = await fetch(`${url}/healthz`);
      if (res.status === 200) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('server reageerde niet op tijd op /healthz');
}

function stop(proc: ChildProcess | undefined): Promise<void> {
  if (proc === undefined || proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    proc.once('exit', () => resolve());
    proc.kill('SIGTERM');
  });
}

beforeAll(async () => {
  for (const file of [ENTRY, CLIENT_INDEX]) {
    if (!existsSync(file)) throw new Error(`${file} ontbreekt: draai eerst \`npm run build\``);
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < START_ATTEMPTS; attempt++) {
    const port = await freePort();
    const proc = spawn(process.execPath, [ENTRY], { cwd: ROOT, env: serverEnv(port), stdio: 'pipe' });
    // Drain the JSON logs so the pipe never fills up.
    proc.stdout.resume();
    proc.stderr.resume();
    const url = `http://127.0.0.1:${port}`;
    try {
      await waitForHealth(proc, url);
      child = proc;
      baseUrl = url;
      return;
    } catch (err) {
      lastError = err;
      await stop(proc);
    }
  }
  throw lastError;
}, START_TIMEOUT_MS * START_ATTEMPTS + 5_000);

afterAll(() => stop(child));

test('/healthz answers ok', async () => {
  const res = await fetch(`${baseUrl}/healthz`);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe('ok');
});

test('/ serves the built app shell', async () => {
  const res = await fetch(`${baseUrl}/`, { headers: { accept: 'text/html' } });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toMatch(/^text\/html/);
  expect(await res.text()).toContain('Werkplekinspectie');
});

test('the built PDF renderer finds its embedded fonts', async () => {
  const built = pathToFileURL(join(ROOT, 'dist/server/server/pdf/render.js')).href;
  const { renderInspectionPdf: render } = (await import(built)) as { renderInspectionPdf: typeof renderInspectionPdf };
  const branding = { orgName: 'Voorbeeld B.V.', orgAddress: [], department: '', vgmName: '', iconBackground: '#FFFFFF' };
  const pdf = await render(makeSubmission({ monteur: 'Łukasz Wiśniewski' }), branding);
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.toString('latin1')).toContain('/FontFile2');
});
