// Sending and receiving texts. With Twilio settings in data/app.env it uses Twilio; without them it's in
// test mode: texts are only recorded, shown on each person's Texts page, where replies can be typed in.
import { createHmac, timingSafeEqual } from 'node:crypto';
import * as db from './db.js';
import { settings } from './settings.js';

const twilio = () => {
  const s = settings();
  return s.TWILIO_ACCOUNT_SID && s.TWILIO_AUTH_TOKEN && s.TWILIO_FROM
    ? { sid: s.TWILIO_ACCOUNT_SID, token: s.TWILIO_AUTH_TOKEN, from: s.TWILIO_FROM, publicUrl: s.PUBLIC_URL } : null;
};
export const live = () => !!twilio();

async function twilioApi(t, path, form, method = 'POST') {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${t.sid}${path}`, {
    method,
    headers: { Authorization: `Basic ${Buffer.from(`${t.sid}:${t.token}`).toString('base64')}`,
      ...(form && { 'Content-Type': 'application/x-www-form-urlencoded' }) },
    body: form && new URLSearchParams(form),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${data.message || res.statusText}`);
  return data;
}

/**
 * Curly quotes, dashes and ellipses as plain characters. One character outside the GSM-7 set makes a whole text
 * Unicode, billed per 70 characters instead of 160 (two to three times the cost).
 */
export const plain = (text) => text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...');

/**
 * Texts one person. Never throws, and doesn't hold up the page: the outcome is recorded in the messages table.
 * Skipped for people who replied STOP or have no usable number.
 */
export function send(user, body) {
  body = plain(body);
  const to = user.phone_e164;
  const status = !to ? 'skipped' : !user.sms_ok ? 'skipped' : live() ? 'sending' : 'test';
  const id = db.logMessage({ user_id: user.id, direction: 'out', phone: to || user.phone, body, status,
    error: !to ? 'not a US cell number' : !user.sms_ok ? 'replied STOP' : null });
  const t = twilio();
  if (status !== 'sending' || !t) return;
  twilioApi(t, '/Messages.json', { To: to, From: t.from, Body: body })
    .then(() => db.setMessageStatus(id, 'sent'))
    .catch((err) => { db.setMessageStatus(id, 'failed', err.message); console.error('Text to', to, 'failed:', err.message); });
}

/** Is this request really from Twilio? It signs the webhook URL plus the sorted form fields with our auth token. */
export function fromTwilio(req, form) {
  const t = twilio();
  if (!t || !t.publicUrl) return false;
  const url = `${t.publicUrl.replace(/\/$/, '')}/sms/inbound`;
  const signed = url + Object.keys(form).sort().map((k) => k + form[k]).join('');
  const expected = createHmac('sha1', t.token).update(signed).digest();
  const given = Buffer.from(String(req.headers['x-twilio-signature'] || ''), 'base64');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** A TwiML answer: Twilio texts `reply` back to whoever wrote in. */
export const twiml = (reply) => `<?xml version="1.0" encoding="UTF-8"?><Response>${reply
  ? `<Message>${reply.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])}</Message>` : ''}</Response>`;

/**
 * Points the Twilio number's incoming texts at PUBLIC_URL/sms/inbound. The quick tunnel's address changes
 * on every restart, so this runs every minute and only calls Twilio when the address has changed.
 */
let pointedAt = '';
export async function syncWebhook() {
  const t = twilio();
  if (!t?.publicUrl) return;
  const url = `${t.publicUrl.replace(/\/$/, '')}/sms/inbound`;
  if (url === pointedAt) return;
  try {
    const found = await twilioApi(t, `/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(t.from)}`, null, 'GET');
    const number = found.incoming_phone_numbers?.[0];
    if (!number) throw new Error(`${t.from} isn't a number on this Twilio account`);
    if (number.sms_url !== url) await twilioApi(t, `/IncomingPhoneNumbers/${number.sid}.json`, { SmsUrl: url, SmsMethod: 'POST' });
    pointedAt = url;
    console.log('Twilio replies now come to', url);
  } catch (err) { console.error('Could not point Twilio at', url, '-', err.message); }
}
