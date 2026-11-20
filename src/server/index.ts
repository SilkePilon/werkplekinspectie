// Entrypoint: read config and logo once, start the server, stop cleanly on SIGTERM/SIGINT.
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { buildApp, type AppDeps } from './app.js';
import { ConfigError, loadConfig, type Config } from './config.js';
import { sniffImage } from './images.js';
import { createMailer } from './mail/send.js';

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function readConfig(): Config {
  try {
    return loadConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) fail(err.message);
    throw err;
  }
}

/** SVG by extension, otherwise it must be a real PNG. A configured but broken logo stops startup. */
function readLogo(file: string): NonNullable<AppDeps['logo']> {
  let data: Buffer;
  try {
    data = readFileSync(file);
  } catch {
    fail(`BRAND_LOGO_FILE: kan ${file} niet lezen`);
  }
  if (extname(file).toLowerCase() === '.svg') return { data, kind: 'svg' };
  if (sniffImage(data) !== 'png') fail(`BRAND_LOGO_FILE: ${file} is geen SVG of PNG`);
  return { data, kind: 'png' };
}

const cfg = readConfig();
const logo = cfg.branding.logoFile === undefined ? undefined : readLogo(cfg.branding.logoFile);
const mailer = createMailer(cfg.mail);
const app = await buildApp(cfg, { mailer, logo, logStream: process.stdout });

// Only the outcome is logged; a failed check does not stop the server.
void mailer.verify().then((ok) => {
  if (ok) app.log.info('smtp_ok');
  else app.log.warn('smtp_verify_failed');
});

let closing = false;
function shutdown(signal: NodeJS.Signals): void {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'shutdown');
  app.close().then(
    () => process.exit(0),
    () => process.exit(1),
  );
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

try {
  await app.listen({ host: '0.0.0.0', port: cfg.port });
} catch (err) {
  app.log.error({ err }, 'listen_failed');
  process.exit(1);
}
