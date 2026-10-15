// Sending email through Google Workspace (smtp.gmail.com with an app password), using only node:tls.
// Settings in data/app.env (`./deploy.sh --email`): SMTP_USER, SMTP_PASS, MAIL_FROM (an alias of SMTP_USER, e.g.
// support@cjmtech.net). Without them it's in test mode: emails are printed to the log (`./deploy.sh --logs`).
import { connect } from 'node:tls';
import { randomBytes } from 'node:crypto';
import { settings } from './settings.js';

const config = () => {
  const s = settings();
  return s.SMTP_USER && s.SMTP_PASS
    ? { host: s.SMTP_HOST || 'smtp.gmail.com', port: Number(s.SMTP_PORT || 465), user: s.SMTP_USER, pass: s.SMTP_PASS.replace(/\s/g, ''),
        from: s.MAIL_FROM || s.SMTP_USER }
    : null;
};
export const live = () => !!config();

/** "DockWash: Your request" with non-ASCII made safe for a mail header (RFC 2047). */
const header = (text) => (/^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text).toString('base64')}?=`);
const clean = (addr) => String(addr).replace(/[\r\n<>]/g, '').trim();

function message(c, to, subject, body) {
  const domain = c.from.split('@')[1];
  return [
    `From: ${header('DockWash')} <${c.from}>`,
    `To: <${to}>`,
    `Reply-To: <${c.from}>`,
    `Subject: ${header(subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${randomBytes(12).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(body).toString('base64').replace(/.{76}/g, '$&\r\n'),
  ].join('\r\n');
}

/** One SMTP conversation: each step sends a line and waits for the expected reply code. */
function smtp(c, to, data) {
  return new Promise((resolve, reject) => {
    const sock = connect({ host: c.host, port: c.port, servername: c.host, timeout: 20000 });
    let buf = '';
    let waiting = null;
    const fail = (err) => { sock.destroy(); reject(err); };
    sock.on('error', fail);
    sock.on('timeout', () => fail(new Error('mail server timed out')));
    sock.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\r\n');
      const last = lines.at(-2);                       // a reply ends with "250 ..." (a space after the code), not "250-..."
      if (!last || !/^\d{3} /.test(last) || !waiting) return;
      buf = '';
      const w = waiting; waiting = null;
      Number(last.slice(0, 3)) === w.code ? w.ok() : fail(new Error(`mail server said: ${last}`));
    });
    const step = (line, code) => new Promise((ok) => { waiting = { code, ok }; if (line !== null) sock.write(`${line}\r\n`); });
    (async () => {
      await step(null, 220);
      await step(`EHLO dockwash`, 250);
      await step(`AUTH PLAIN ${Buffer.from(`\0${c.user}\0${c.pass}`).toString('base64')}`, 235);
      await step(`MAIL FROM:<${c.user}>`, 250);
      await step(`RCPT TO:<${to}>`, 250);
      await step('DATA', 354);
      await step(`${data.replace(/^\./gm, '..')}\r\n.`, 250);
      sock.end('QUIT\r\n');
      resolve();
    })().catch(fail);
  });
}

/** Emails one person. Never throws and doesn't hold up the page; failures go to the log. */
export function send(to, subject, body) {
  to = clean(to);
  const c = config();
  if (!c) {
    console.log(`[email, test mode] To: ${to}\nSubject: ${subject}\n\n${body}\n`);
    return Promise.resolve(false);
  }
  return smtp(c, to, message(c, to, subject, `${body}\n\n-- \nDockWash${settings().PUBLIC_URL ? ` · ${settings().PUBLIC_URL}` : ''}\n`))
    .then(() => true)
    .catch((err) => { console.error('Email to', to, 'failed:', err.message); return false; });
}
