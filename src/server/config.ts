// Server settings, read once from env at startup. Missing or invalid values stop
// the container with a message that names every problem at once.
import { isIP } from 'node:net';
import { parse as parseDuration } from '@lukeed/ms';
import { z } from 'zod';

export interface Config {
  port: number;
  publicOrigin: string;
  trustProxy: string[];
  mail: {
    to: string;
    from: string;
    smtp: { host: string; port: number; secure: boolean; user: string; pass: string };
  };
  branding: {
    orgName: string;
    orgAddress: string[];
    department: string;
    vgmName: string;
    logoFile?: string;
    /** A square SVG for the app icon; replaces the built-in icons when set. */
    iconFile?: string;
    /** #RRGGBB behind the icon where it must fill the whole tile (maskable, Apple). */
    iconBackground: string;
  };
  /** `window` is in milliseconds. */
  rateLimit: { perIp: number; window: number; globalPerHour: number };
}

export class ConfigError extends Error {
  /** One line per variable, e.g. `MAIL_TO: is verplicht`. Never contains SMTP_PASS's value. */
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Ongeldige configuratie:\n${problems.map((p) => `- ${p}`).join('\n')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

const DEFAULT_PORT = 8080;
const DEFAULT_SMTP_PORT = 465;
const IMPLICIT_TLS_PORT = 465;
const MIN_RATE_WINDOW_MS = 1000;

/** Treats an unset, empty or whitespace-only variable as absent. */
const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const REQUIRED = { error: 'is verplicht' };
const NO_CRLF = { message: 'mag geen regeleinde (CR/LF) bevatten', abort: true };
const hasNoCrLf = (s: string) => !/[\r\n]/.test(s);

const emailSchema = z.email();
const isEmail = (s: string) => emailSchema.safeParse(s).success;

/** `addr@domain` or `Name <addr@domain>`; an unquoted name may not contain `,` or `;`. */
function isMailbox(s: string): boolean {
  if (isEmail(s)) return true;
  const match = /^(?<name>[^<>]*)<(?<addr>[^<>]+)>$/.exec(s);
  if (!match?.groups) return false;
  const name = match.groups.name!.trim();
  const nameOk = /^"[^"]*"$/.test(name) || /^[^",;]*$/.test(name);
  return nameOk && isEmail(match.groups.addr!);
}

function isIpOrCidr(entry: string): boolean {
  const [ip, prefix, ...rest] = entry.split('/');
  if (rest.length > 0 || ip === undefined) return false;
  const version = isIP(ip);
  if (version === 0) return false;
  if (prefix === undefined) return true;
  return /^\d{1,3}$/.test(prefix) && Number(prefix) <= (version === 4 ? 32 : 128);
}

function requiredMailValue() {
  return z.preprocess(blankToUndefined, z.string(REQUIRED).refine(hasNoCrLf, NO_CRLF).trim());
}

function intVar(fallback: number, min: number, max: number) {
  const message = `moet een geheel getal van ${min} t/m ${max} zijn`;
  return z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .regex(/^\d+$/, message)
      .transform(Number)
      .pipe(z.number().min(min, message).max(max, message))
      .default(fallback),
  );
}

function textVar(fallback: string) {
  return z.preprocess(blankToUndefined, z.string().trim().default(fallback));
}

function publicOrigin(production: boolean) {
  return z.preprocess(
    blankToUndefined,
    z
      .string(REQUIRED)
      .trim()
      .transform((value, ctx) => {
        const fail = (message: string) => {
          ctx.addIssue({ code: 'custom', message });
          return z.NEVER;
        };
        let url: URL;
        try {
          url = new URL(value);
        } catch {
          return fail('moet een URL zijn, bijv. https://inspectie.example.com');
        }
        if (url.protocol !== 'https:' && url.protocol !== 'http:') {
          return fail('moet met https:// beginnen');
        }
        if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
          return fail('moet alleen schema en host bevatten, zonder pad, query of #');
        }
        if (production && url.protocol !== 'https:') {
          return fail('moet https:// gebruiken als NODE_ENV=production');
        }
        return url.origin;
      }),
  );
}

function envSchema(production: boolean) {
  return z
    .object({
      MAIL_TO: requiredMailValue().refine(isEmail, 'moet precies één e-mailadres zijn'),
      MAIL_FROM: requiredMailValue().refine(
        isMailbox,
        'moet een e-mailadres zijn, eventueel als "Naam <adres@domein>"',
      ),
      SMTP_HOST: requiredMailValue(),
      SMTP_PORT: intVar(DEFAULT_SMTP_PORT, 1, 65535),
      SMTP_SECURE: z.preprocess(
        blankToUndefined,
        z.enum(['true', 'false'], { error: 'moet "true" of "false" zijn' }).optional(),
      ),
      SMTP_USER: requiredMailValue(),
      // Not trimmed: the password is used exactly as given.
      SMTP_PASS: z.preprocess(blankToUndefined, z.string(REQUIRED).refine(hasNoCrLf, NO_CRLF)),

      ORG_NAME: textVar(''),
      ORG_ADDRESS: textVar('').transform((s) =>
        s
          .split(/\\n|\r?\n|\r/)
          .map((line) => line.trim())
          .filter((line) => line !== ''),
      ),
      ORG_DEPARTMENT: textVar('Customer Care'),
      VGM_NAME: textVar(''),
      BRAND_LOGO_FILE: z.preprocess(blankToUndefined, z.string().trim().optional()),
      BRAND_ICON_FILE: z.preprocess(blankToUndefined, z.string().trim().optional()),
      BRAND_ICON_BACKGROUND: z.preprocess(
        blankToUndefined,
        z
          .string()
          .trim()
          .regex(/^#[0-9a-fA-F]{6}$/, 'moet een kleur zijn als #FFFFFF')
          .default('#FFFFFF'),
      ),

      PORT: intVar(DEFAULT_PORT, 1, 65535),
      PUBLIC_ORIGIN: publicOrigin(production),
      TRUST_PROXY: textVar('').transform((s, ctx) => {
        const entries = s
          .split(',')
          .map((e) => e.trim())
          .filter((e) => e !== '');
        const invalid = entries.filter((e) => !isIpOrCidr(e));
        if (invalid.length > 0) {
          ctx.addIssue({
            code: 'custom',
            message: `moet een kommalijst van IP-adressen of CIDR-blokken zijn; ongeldig: ${invalid.join(', ')}`,
          });
        }
        return entries;
      }),

      RATE_LIMIT_PER_IP: intVar(5, 1, 1_000_000),
      RATE_LIMIT_WINDOW: textVar('15 minutes').transform((s, ctx) => {
        const ms = parseDuration(s);
        if (ms === undefined || !Number.isFinite(ms) || ms < MIN_RATE_WINDOW_MS) {
          ctx.addIssue({
            code: 'custom',
            message: 'moet een duur van minstens 1 seconde zijn, bijv. "15 minutes" of "1h"',
          });
          return z.NEVER;
        }
        return ms;
      }),
      RATE_LIMIT_GLOBAL_PER_HOUR: intVar(20, 1, 1_000_000),
    })
    .transform(
      (e): Config => ({
        port: e.PORT,
        publicOrigin: e.PUBLIC_ORIGIN,
        trustProxy: e.TRUST_PROXY,
        mail: {
          to: e.MAIL_TO,
          from: e.MAIL_FROM,
          smtp: {
            host: e.SMTP_HOST,
            port: e.SMTP_PORT,
            secure:
              e.SMTP_SECURE === undefined
                ? e.SMTP_PORT === IMPLICIT_TLS_PORT
                : e.SMTP_SECURE === 'true',
            user: e.SMTP_USER,
            pass: e.SMTP_PASS,
          },
        },
        branding: {
          orgName: e.ORG_NAME,
          orgAddress: e.ORG_ADDRESS,
          department: e.ORG_DEPARTMENT,
          vgmName: e.VGM_NAME,
          ...(e.BRAND_LOGO_FILE === undefined ? {} : { logoFile: e.BRAND_LOGO_FILE }),
          ...(e.BRAND_ICON_FILE === undefined ? {} : { iconFile: e.BRAND_ICON_FILE }),
          iconBackground: e.BRAND_ICON_BACKGROUND,
        },
        rateLimit: {
          perIp: e.RATE_LIMIT_PER_IP,
          window: e.RATE_LIMIT_WINDOW,
          globalPerHour: e.RATE_LIMIT_GLOBAL_PER_HOUR,
        },
      }),
    );
}

/** Reads and validates the server settings. Throws a ConfigError that lists every problem. */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const result = envSchema(env.NODE_ENV === 'production').safeParse(env);
  if (result.success) return result.data;

  // One line per variable: the first issue is the most specific one.
  const problems = new Map<string, string>();
  for (const issue of result.error.issues) {
    const name = String(issue.path[0] ?? 'env');
    if (!problems.has(name)) problems.set(name, `${name}: ${issue.message}`);
  }
  throw new ConfigError([...problems.values()]);
}
