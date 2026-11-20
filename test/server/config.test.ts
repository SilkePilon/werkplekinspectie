import { describe, expect, test } from 'vitest';
import { ConfigError, loadConfig, type Config } from '../../src/server/config.js';

const REQUIRED = ['MAIL_TO', 'MAIL_FROM', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'PUBLIC_ORIGIN'];
const SECRET = 'super-geheim-wachtwoord';

function minimalEnv(): NodeJS.ProcessEnv {
  return {
    MAIL_TO: 'vgm@example.com',
    MAIL_FROM: 'inspectie@example.com',
    SMTP_HOST: 'smtp.example.com',
    SMTP_USER: 'example-user',
    SMTP_PASS: SECRET,
    PUBLIC_ORIGIN: 'https://inspectie.example.com',
    NODE_ENV: 'production',
  };
}

function fullEnv(): NodeJS.ProcessEnv {
  return {
    ...minimalEnv(),
    MAIL_FROM: 'Werkplekinspectie <inspectie@example.com>',
    SMTP_PORT: '465',
    SMTP_SECURE: 'true',
    ORG_NAME: 'Voorbeeld B.V.',
    ORG_ADDRESS: 'Voorbeeldstraat 1\\n1234 AB Voorbeeldstad',
    ORG_DEPARTMENT: 'Customer Care',
    VGM_NAME: 'J. Jansen',
    BRAND_LOGO_FILE: '/config/logo.svg',
    PORT: '8080',
    TRUST_PROXY: '10.0.0.0/8, 192.168.1.5,fd00::/8',
    RATE_LIMIT_PER_IP: '7',
    RATE_LIMIT_WINDOW: '10 minutes',
    RATE_LIMIT_GLOBAL_PER_HOUR: '30',
  };
}

/** Runs loadConfig and returns the ConfigError it throws. */
function configError(env: NodeJS.ProcessEnv): ConfigError {
  try {
    loadConfig(env);
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    return err as ConfigError;
  }
  throw new Error('loadConfig did not throw');
}

describe('loadConfig', () => {
  test('a full env produces the expected Config', () => {
    const expected: Config = {
      port: 8080,
      publicOrigin: 'https://inspectie.example.com',
      trustProxy: ['10.0.0.0/8', '192.168.1.5', 'fd00::/8'],
      mail: {
        to: 'vgm@example.com',
        from: 'Werkplekinspectie <inspectie@example.com>',
        smtp: {
          host: 'smtp.example.com',
          port: 465,
          secure: true,
          user: 'example-user',
          pass: SECRET,
        },
      },
      branding: {
        orgName: 'Voorbeeld B.V.',
        orgAddress: ['Voorbeeldstraat 1', '1234 AB Voorbeeldstad'],
        department: 'Customer Care',
        vgmName: 'J. Jansen',
        logoFile: '/config/logo.svg',
      },
      rateLimit: { perIp: 7, window: 600_000, globalPerHour: 30 },
    };
    expect(loadConfig(fullEnv())).toEqual(expected);
  });

  test('only the required variables gives the documented defaults', () => {
    expect(loadConfig(minimalEnv())).toEqual({
      port: 8080,
      publicOrigin: 'https://inspectie.example.com',
      trustProxy: [],
      mail: {
        to: 'vgm@example.com',
        from: 'inspectie@example.com',
        smtp: {
          host: 'smtp.example.com',
          port: 465,
          secure: true,
          user: 'example-user',
          pass: SECRET,
        },
      },
      branding: { orgName: '', orgAddress: [], department: 'Customer Care', vgmName: '' },
      rateLimit: { perIp: 5, window: 900_000, globalPerHour: 20 },
    } satisfies Config);
  });

  test('an empty env throws and lists all six required names', () => {
    const err = configError({});
    for (const name of REQUIRED) expect(err.message).toContain(name);
    expect(err.problems).toHaveLength(REQUIRED.length);
  });

  test('blank required values count as missing', () => {
    const err = configError({ ...minimalEnv(), MAIL_TO: '   ', SMTP_PASS: '' });
    expect(err.problems).toEqual([
      expect.stringContaining('MAIL_TO'),
      expect.stringContaining('SMTP_PASS'),
    ]);
  });

  test('lists missing and invalid variables together, one per line', () => {
    const err = configError({ MAIL_TO: 'nope', SMTP_PORT: '99999', NODE_ENV: 'production' });
    const lines = err.message.split('\n');
    for (const name of [...REQUIRED, 'SMTP_PORT']) {
      expect(lines.filter((l) => l.includes(name))).toHaveLength(1);
    }
  });

  test.each([
    'a@b.c, d@e.f',
    'vgm@example.com,ander@example.com',
    'vgm@example.com; ander@example.com',
  ])(
    'MAIL_TO=%j is rejected: exactly one address',
    (value) => {
      const err = configError({ ...minimalEnv(), MAIL_TO: value });
      expect(err.problems).toEqual([expect.stringContaining('MAIL_TO')]);
    },
  );

  test('MAIL_TO in display form is rejected', () => {
    const err = configError({ ...minimalEnv(), MAIL_TO: 'VGM <vgm@example.com>' });
    expect(err.problems).toEqual([expect.stringContaining('MAIL_TO')]);
  });

  test.each([
    ['MAIL_TO', 'vgm@example.com\r\nBcc: x@example.com'],
    ['MAIL_FROM', 'Inspectie <inspectie@example.com>\nBcc: x@example.com'],
    ['SMTP_HOST', 'smtp.example.com\r\n'],
    ['SMTP_USER', 'user\nx'],
  ])('%s with CR/LF is rejected', (name, value) => {
    const err = configError({ ...minimalEnv(), [name]: value });
    expect(err.problems).toEqual([expect.stringContaining(name)]);
  });

  test.each(['inspectie', 'Inspectie <niet-een-adres>', 'Inspectie inspectie@example.com'])(
    'MAIL_FROM %j is rejected',
    (value) => {
      const err = configError({ ...minimalEnv(), MAIL_FROM: value });
      expect(err.problems).toEqual([expect.stringContaining('MAIL_FROM')]);
    },
  );

  test('SMTP_PASS with CR/LF is rejected without echoing its value', () => {
    const err = configError({ ...minimalEnv(), SMTP_PASS: `${SECRET}\r\n` });
    expect(err.problems).toEqual([expect.stringContaining('SMTP_PASS')]);
    expect(err.message).not.toContain(SECRET);
  });

  test('PUBLIC_ORIGIN over http is rejected in production', () => {
    const err = configError({ ...minimalEnv(), PUBLIC_ORIGIN: 'http://x' });
    expect(err.problems).toEqual([expect.stringContaining('PUBLIC_ORIGIN')]);
  });

  test.each([undefined, 'development', 'test'])(
    'PUBLIC_ORIGIN over http is allowed when NODE_ENV is %s',
    (nodeEnv) => {
      const config = loadConfig({ ...minimalEnv(), NODE_ENV: nodeEnv, PUBLIC_ORIGIN: 'http://x' });
      expect(config.publicOrigin).toBe('http://x');
    },
  );

  test('PUBLIC_ORIGIN with a trailing slash is normalised to the origin', () => {
    const config = loadConfig({ ...minimalEnv(), PUBLIC_ORIGIN: 'https://inspectie.example.com/' });
    expect(config.publicOrigin).toBe('https://inspectie.example.com');
  });

  test.each(['inspectie.example.com', 'https://inspectie.example.com/pad', 'ftp://x', 'https://'])(
    'PUBLIC_ORIGIN %j is rejected',
    (value) => {
      const err = configError({ ...minimalEnv(), PUBLIC_ORIGIN: value });
      expect(err.problems).toEqual([expect.stringContaining('PUBLIC_ORIGIN')]);
    },
  );

  test('SMTP_PORT=587 gives secure:false', () => {
    const config = loadConfig({ ...minimalEnv(), SMTP_PORT: '587' });
    expect(config.mail.smtp).toMatchObject({ port: 587, secure: false });
  });

  test('SMTP_SECURE overrides the port-derived default', () => {
    const secure = (port: string, flag: string) =>
      loadConfig({ ...minimalEnv(), SMTP_PORT: port, SMTP_SECURE: flag }).mail.smtp.secure;
    expect(secure('587', 'true')).toBe(true);
    expect(secure('465', 'false')).toBe(false);
  });

  test.each([
    ['SMTP_SECURE', 'yes'],
    ['SMTP_PORT', '0'],
    ['SMTP_PORT', 'abc'],
    ['PORT', '65536'],
    ['PORT', '80.5'],
    ['RATE_LIMIT_PER_IP', '0'],
    ['RATE_LIMIT_PER_IP', 'vijf'],
    ['RATE_LIMIT_GLOBAL_PER_HOUR', '-1'],
  ])('%s=%j is rejected', (name, value) => {
    const err = configError({ ...minimalEnv(), [name]: value });
    expect(err.problems).toEqual([expect.stringContaining(name)]);
  });

  test('ORG_ADDRESS accepts literal \\n and real newlines, trims lines and drops empty ones', () => {
    const config = loadConfig({
      ...minimalEnv(),
      ORG_ADDRESS: '  Voorbeeldstraat 1 \\n\\n1234 AB Voorbeeldstad\r\nPostbus 9\n\n',
    });
    expect(config.branding.orgAddress).toEqual([
      'Voorbeeldstraat 1',
      '1234 AB Voorbeeldstad',
      'Postbus 9',
    ]);
  });

  test('TRUST_PROXY ignores empty entries', () => {
    expect(loadConfig({ ...minimalEnv(), TRUST_PROXY: ' 10.0.0.1 , ,' }).trustProxy).toEqual([
      '10.0.0.1',
    ]);
  });

  test.each(['cloudflared', '10.0.0.0/33', '10.0.0.0/', '300.1.1.1', 'fd00::/129', '10.0.0.0/8/1'])(
    'TRUST_PROXY entry %j is rejected',
    (entry) => {
      const err = configError({ ...minimalEnv(), TRUST_PROXY: `10.0.0.0/8,${entry}` });
      expect(err.problems).toEqual([expect.stringContaining('TRUST_PROXY')]);
      expect(err.message).toContain(entry);
    },
  );

  test.each([
    ['15 minutes', 900_000],
    ['1 hour', 3_600_000],
    ['1s', 1000],
    [' 10m ', 600_000],
  ])('RATE_LIMIT_WINDOW %j is read as %i ms', (value, ms) => {
    expect(loadConfig({ ...minimalEnv(), RATE_LIMIT_WINDOW: value }).rateLimit.window).toBe(ms);
  });

  test.each(['bogus', '0', '15', '999', '-5m', '15 apples'])('RATE_LIMIT_WINDOW %j is rejected', (value) => {
    const err = configError({ ...minimalEnv(), RATE_LIMIT_WINDOW: value });
    expect(err.problems).toEqual([expect.stringContaining('RATE_LIMIT_WINDOW')]);
  });

  test('blank optional values fall back to their defaults', () => {
    const config = loadConfig({
      ...minimalEnv(),
      PORT: '',
      SMTP_PORT: ' ',
      ORG_DEPARTMENT: '',
      RATE_LIMIT_WINDOW: '',
      BRAND_LOGO_FILE: '',
    });
    expect(config.port).toBe(8080);
    expect(config.mail.smtp.port).toBe(465);
    expect(config.branding.department).toBe('Customer Care');
    expect(config.branding.logoFile).toBeUndefined();
    expect(config.rateLimit.window).toBe(900_000);
  });
});
