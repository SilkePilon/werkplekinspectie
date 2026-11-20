// SMTP sender (any provider; Resend in production). TLS is mandatory: at least
// TLS 1.2, STARTTLS required on non-implicit-TLS ports, certificates always checked.
import { createTransport } from 'nodemailer';
import type { Config } from '../config.js';
import type { MailMessage } from './build.js';

export interface Mailer {
  /** Sends the message. Throws a generic Error that never contains credentials or content. */
  send(msg: MailMessage): Promise<void>;
  /** Checks connection and login. Never throws. */
  verify(): Promise<boolean>;
}

/** A short, safe error code such as `EAUTH`, or undefined. */
function errorCode(err: unknown): string | undefined {
  const code: unknown = typeof err === 'object' && err !== null ? Reflect.get(err, 'code') : undefined;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,31}$/.test(code) ? code : undefined;
}

export function createMailer(cfg: Config['mail']): Mailer {
  const { host, port, secure, user, pass } = cfg.smtp;
  const transport = createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    requireTLS: !secure,
    tls: { minVersion: 'TLSv1.2' },
  });

  return {
    async send(msg) {
      try {
        await transport.sendMail({
          from: msg.from,
          to: msg.to,
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
          attachments: msg.attachments,
        });
      } catch (err) {
        // Deliberately no `cause`: SMTP errors can echo server responses or login details.
        const code = errorCode(err);
        // eslint-disable-next-line preserve-caught-error -- see above
        throw new Error(code === undefined ? 'Mail versturen mislukt' : `Mail versturen mislukt (${code})`);
      }
    },
    async verify() {
      try {
        await transport.verify();
        return true;
      } catch {
        return false;
      }
    },
  };
}
