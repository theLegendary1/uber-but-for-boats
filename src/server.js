// DockWash: cleaners post the days they can wash; marina managers book them without a single phone call.
// Dependency-free Node (22.13+): node:http, node:sqlite, node:crypto.
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import * as db from './db.js';
import * as v from './views.js';
import { hashPassword, checkPassword, NO_PASSWORD } from './passwords.js';
import * as google from './google.js';
import { settings } from './settings.js';
import { localDay } from './dates.js';
import { toE164 } from './phone.js';
import * as sms from './sms.js';
import * as notify from './notify.js';
import * as reminders from './reminders.js';

const PORT = Number(process.env.PORT || 3200);
const PUBLIC = join(import.meta.dirname, '..', 'public');
const SESSION_DAYS = 60;
const AVAIL_DAYS = 42;          // six weeks of availability on the cleaner's calendar

// ---- helpers

const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
/** Admins see the Admin page (referral leaderboard): the emails in ADMIN_EMAILS in data/app.env, comma-separated. */
const isAdmin = (user) => (settings().ADMIN_EMAILS || '').toLowerCase().split(/[\s,]+/).filter(Boolean).includes(user.email.toLowerCase());
/** A referral code from a link: letters and digits only, so it can ride in a cookie or URL as is. */
const refParam = (s) => db.referralKey(s).slice(0, 20);

/** Invite codes match however they're typed: "Uber for cleaners" = UBERFORPALLBEARERS. */
const codeKey = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const clean = (s, max) => String(s ?? '').trim().slice(0, max);

// Behind the Cloudflare tunnel every request comes from the tunnel container, so the visitor's own address
// and scheme come from Cloudflare's headers. TRUST_PROXY is set in docker-compose.yml.
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const clientIp = (req) => (TRUST_PROXY && req.headers['cf-connecting-ip']) || req.socket.remoteAddress;
/** Where people outside reach DockWash: PUBLIC_URL (written by `deploy.sh --public`), else the address in use. */
function publicBase(req) {
  const fixed = settings().PUBLIC_URL;
  if (fixed) return { base: fixed.replace(/\/$/, ''), lanOnly: false };
  return { base: `${isHttps(req) ? 'https' : 'http'}://${req.headers.host}`, lanOnly: !isHttps(req) };
}

function inviteMessage(user, invite, link) {
  const hi = invite.name ? `Hi ${invite.name}, it's` : `Hi, it's`;
  const from = user.role === 'manager' ? `${user.name} from ${user.home_name}` : user.name;
  const pitch = invite.role === 'manager'
    ? 'I’ve been booking cleaners on DockWash: they post the days they can wash and you book them in a couple of taps. No more calling around.'
    : user.role === 'manager'
      ? 'I’m booking cleaners through DockWash now. You mark the days you can wash and I send you the jobs right there. No more phone tag.'
      : 'Marinas are booking cleaners on DockWash. You mark the days you can wash and they send you the jobs.';
  return `${hi} ${from}. ${pitch} Sign up here, it takes a minute: ${link}`;
}

const isHttps = (req) => TRUST_PROXY && (req.headers['x-forwarded-proto'] === 'https' || /"https"/.test(req.headers['cf-visitor'] || ''));

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((c) => c[0]));
}

async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 64 * 1024) throw Object.assign(new Error('too large'), { status: 413 });
    chunks.push(c);
  }
  const form = new URLSearchParams(Buffer.concat(chunks).toString());
  const out = {};
  for (const [k, val] of form) out[k] = k in out ? [].concat(out[k], val) : val;
  return out;
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin', 'X-Robots-Tag': 'noindex',
};
function send(res, status, html, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers });
  res.end(html);
}
const redirect = (res, to, headers = {}) => { res.writeHead(303, { Location: to, ...SECURITY_HEADERS, ...headers }); res.end(); };
const page = (res, user, title, body, flash, status = 200) => send(res, status, v.layout({ title, user, body, flash }));

/** One-shot messages ride along in a short-lived cookie, so a redirect can say what happened. */
const flashCookie = (msg) => ({ 'Set-Cookie': `dw_flash=${encodeURIComponent(msg)}; Path=/; Max-Age=30; HttpOnly; SameSite=Lax` });

async function startSession(req, res, userId, to, moreCookies = []) {
  const token = randomBytes(32).toString('hex');
  db.createSession(token, userId, randomBytes(16).toString('hex'), Date.now() + SESSION_DAYS * 864e5);
  const secure = isHttps(req) ? '; Secure' : '';   // over the internet, never send the session over plain http
  redirect(res, to, { 'Set-Cookie': [`dw_sid=${token}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax${secure}`, ...moreCookies] });
}

// ---- Google sign-in. Someone new to DockWash comes back from Google without an account; who they are waits
// here (10 minutes, keyed by a cookie) while they fill in the rest of the sign-up form.
const googlePending = new Map();
const GOOGLE_COOKIE_TTL = 600;
function pendingGoogle(req) {
  const p = googlePending.get(cookies(req).dw_google || '');
  return p && p.expires > Date.now() ? p : null;
}
const cookie = (req, name, value, maxAge) =>
  `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${isHttps(req) ? '; Secure' : ''}`;

// ---- login attempts: 10 wrong passwords from one address lock it out for 15 minutes

const failures = new Map();
const lockedOut = (ip) => { const f = failures.get(ip); return f && f.count >= 10 && Date.now() - f.at < 15 * 60e3; };
const failed = (ip) => {
  const f = failures.get(ip);
  failures.set(ip, { count: f && Date.now() - f.at < 15 * 60e3 ? f.count + 1 : 1, at: Date.now() });
};

// ---- routes

const STATIC_TYPES = { '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;
  const method = req.method;

  if (method === 'GET' && /^\/[\w-]+\.(css|js|svg|png)$/.test(path)) {
    try {
      const file = await readFile(join(PUBLIC, path));
      res.writeHead(200, { 'Content-Type': STATIC_TYPES[extname(path)], 'Cache-Control': 'max-age=300', ...SECURITY_HEADERS });
      return res.end(file);
    } catch { return send(res, 404, 'Not found'); }
  }
  if (path === '/health') return send(res, 200, 'ok', { 'Content-Type': 'text/plain' });
  if ((path === '/privacy' || path === '/terms') && method === 'GET') {
    const info = { support: settings().SUPPORT_EMAIL, base: publicBase(req).base };
    const user = cookies(req).dw_sid ? db.sessionUser(cookies(req).dw_sid) : null;
    return page(res, user, path === '/privacy' ? 'Privacy Policy' : 'Terms', path === '/privacy' ? v.privacyPage(info) : v.termsPage(info));
  }

  const jar = cookies(req);
  const user = jar.dw_sid ? db.sessionUser(jar.dw_sid) : null;
  if (user) user.isAdmin = isAdmin(user);
  const flash = jar.dw_flash ? decodeURIComponent(jar.dw_flash) : '';
  if (flash) res.setHeader('Set-Cookie', 'dw_flash=; Path=/; Max-Age=0');
  const form = method === 'POST' ? await body(req) : {};

  // Texts people send to the DockWash number, forwarded by Twilio. Signed by Twilio instead of a session.
  if (path === '/sms/inbound' && method === 'POST') {
    if (!sms.fromTwilio(req, form)) return send(res, 403, 'Not from Twilio', { 'Content-Type': 'text/plain' });
    const reply = notify.incoming(toE164(form.From), String(form.Body || ''));
    // Twilio's opt-out management has already answered STOP, START and HELP (it marks them with OptOutType);
    // DockWash still records the opt-out or opt-in above, but doesn't send a second reply.
    const twilioAnswered = ['STOP', 'START', 'HELP'].includes(String(form.OptOutType || '').toUpperCase());
    return send(res, 200, sms.twiml(twilioAnswered ? '' : sms.plain(reply || '')), { 'Content-Type': 'text/xml' });
  }

  if (method === 'POST') {
    // Forms only from our own pages: same origin, and (when logged in) the session's token.
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) return send(res, 403, 'Cross-site form refused');
    if (user && form.csrf !== user.csrf && path !== '/login') return send(res, 403, 'Form expired. Go back, reload, and try again.');
  }

  // -- signed out
  if (path === '/login' && method === 'GET') return user ? redirect(res, '/') : page(res, null, 'Log in', v.loginPage({ googleOn: google.enabled() }), flash);

  // Continue with Google: off to Google, remembering (in a cookie) what to check when it sends the browser back.
  if (path === '/auth/google' && method === 'GET') {
    if (!google.enabled()) return redirect(res, '/login');
    const { url: to, state, nonce } = google.start(publicBase(req).base);
    const invite = /^[\w-]{1,40}$/.test(url.searchParams.get('invite') || '') ? url.searchParams.get('invite') : '';
    const role = url.searchParams.get('role') === 'manager' ? 'manager' : 'cleaner';
    const ref = refParam(url.searchParams.get('ref'));
    return redirect(res, to, { 'Set-Cookie': cookie(req, 'pc_oauth', [state, nonce, role, invite, ref].join('.'), GOOGLE_COOKIE_TTL) });
  }
  if (path === '/auth/google/callback' && method === 'GET') {
    const [state, nonce, role, invite, ref] = (cookies(req).pc_oauth || '').split('.');
    const clear = cookie(req, 'pc_oauth', '', 0);
    const back = (msg) => redirect(res, '/login', { 'Set-Cookie': [clear, flashCookie(msg)['Set-Cookie']] });
    if (url.searchParams.get('error')) return back('Google sign-in was cancelled.');
    if (!state || url.searchParams.get('state') !== state) return back('That Google sign-in expired. Please try again.');
    let who;
    try { who = await google.finish(publicBase(req).base, String(url.searchParams.get('code') || ''), nonce); }
    catch (err) { console.error('Google sign-in failed:', err.message); return back('Google sign-in didn’t work. Please try again.'); }
    // Known Google account, or an existing account with the same email (which gets linked to it).
    const existing = db.userByGoogle(who.sub) || db.userByEmail(who.email);
    if (existing) {
      if (!existing.google_sub) db.linkGoogle(existing.id, who.sub);
      return startSession(req, res, existing.id, '/', [clear]);
    }
    const key = randomBytes(18).toString('base64url');
    googlePending.set(key, { ...who, expires: Date.now() + GOOGLE_COOKIE_TTL * 1000 });
    for (const [k, p] of googlePending) if (p.expires < Date.now()) googlePending.delete(k);
    return redirect(res, `/signup?role=${role}${invite ? `&invite=${invite}` : ''}${ref ? `&ref=${ref}` : ''}`,
      { 'Set-Cookie': [clear, cookie(req, 'dw_google', key, GOOGLE_COOKIE_TTL)] });
  }
  if (path === '/login' && method === 'POST') {
    const ip = clientIp(req);
    const email = clean(form.email, 120);
    if (lockedOut(ip)) return page(res, null, 'Log in', v.loginPage({ email, error: 'Too many wrong passwords. Try again in 15 minutes.' }), '', 429);
    const u = db.userByEmail(email);
    if (!u || !(await checkPassword(String(form.password || ''), u.password_hash))) {
      failed(ip);
      return page(res, null, 'Log in', v.loginPage({ email, error: 'That email and password don’t match.' }), '', 401);
    }
    failures.delete(ip);
    return startSession(req, res, u.id, '/');
  }
  if (path === '/signup' && method === 'GET') {
    const token = url.searchParams.get('invite');
    const invite = token ? db.openInvite(token) : null;
    const error = token && !invite ? 'That invite link has already been used. Ask for a new one, or sign up below.' : '';
    const ref = refParam(url.searchParams.get('ref'));
    const referrer = ref ? db.userByReferral(ref) : null;
    return page(res, null, 'Sign up', v.signupPage({ role: url.searchParams.get('role'), needCode: !!settings().SIGNUP_CODE, invite, error,
      google: pendingGoogle(req), googleOn: google.enabled(), ref: referrer ? ref : '', referrerName: referrer?.name }));
  }
  if (path === '/signup' && method === 'POST') {
    const invite = form.invite ? db.openInvite(String(form.invite)) : null;
    const role = invite ? invite.role : form.role === 'manager' ? 'manager' : 'cleaner';
    const viaGoogle = pendingGoogle(req);   // signed in with Google: its email, and no password needed
    const vals = { name: clean(form.name, 80), email: viaGoogle ? viaGoogle.email : clean(form.email, 120), phone: clean(form.phone, 30),
      home_name: role === 'manager' ? clean(form.home_name, 120) : '', area: role === 'cleaner' ? clean(form.area, 120) : '', sms: !!form.sms, terms: !!form.terms };
    const password = String(form.password || '');
    // Who brought them in: a personal invite's sender, else the owner of the referral code they typed or came in with.
    // SIGNUP_CODE, if set, makes a code required; it or anyone's referral code will do.
    const code = settings().SIGNUP_CODE;
    const typed = clean(form.code, 40);
    const referrer = !invite && typed ? db.userByReferral(typed) : null;
    const legacy = !invite && !referrer && typed && code && codeKey(typed) === codeKey(code);
    vals.code = typed;
    const error = !invite && typed && !referrer && !legacy ? 'We don’t recognize that referral code. Check it, or leave it blank.'
      : code && !invite && !referrer && !legacy ? 'Please enter a referral code. Ask whoever told you about DockWash for theirs.'
      : !vals.name || !vals.phone || !/^\S+@\S+\.\S+$/.test(vals.email) ? 'Please fill in your name, phone and a valid email.'
      : role === 'manager' && !vals.home_name ? 'Please enter your marina.'
      : !form.terms ? 'Please agree to the Terms of Service and Privacy Policy.'
      : !viaGoogle && password.length < 8 ? 'Passwords need at least 8 characters.'
      : db.userByEmail(vals.email) ? 'There’s already an account with that email. Try logging in.' : '';
    if (error) return page(res, null, 'Sign up', v.signupPage({ role, error, v: vals, needCode: !!code, invite, google: viaGoogle, googleOn: google.enabled(),
      ref: form.via === 'link' && referrer ? typed : '', referrerName: form.via === 'link' ? referrer?.name : '' }), '', 400);
    const id = db.createUser({ ...vals, role, sms_ok: vals.sms ? 1 : 0, google_sub: viaGoogle?.sub,
      password_hash: viaGoogle ? NO_PASSWORD : await hashPassword(password),
      referred_by: invite ? invite.inviter_id : referrer?.id,
      referral_via: invite ? 'invite' : referrer ? (form.via === 'link' ? 'link' : 'code') : legacy ? 'legacy' : null });
    if (viaGoogle) googlePending.delete(cookies(req).dw_google);
    notify.optedIn(id);
    notify.welcome(id);
    if (invite && db.useInvite(invite.token, id) && invite.tier) db.setCrew(invite.inviter_id, id, invite.tier);
    return startSession(req, res, id, role === 'cleaner' ? '/availability' : '/', viaGoogle ? [cookie(req, 'dw_google', '', 0)] : []);
  }

  // Forgot password: the same answer whether or not the email has an account, so nobody can fish for accounts.
  if (path === '/forgot' && method === 'GET') return page(res, null, 'Reset password', v.forgotPage({}));
  if (path === '/forgot' && method === 'POST') {
    const email = clean(form.email, 120);
    const u = db.userByEmail(email);
    if (u && db.recentResets(u.id) < 3) {
      const token = randomBytes(24).toString('base64url');
      db.createReset(sha256(token), u.id, Date.now() + 3600e3);
      notify.passwordReset(u, `${publicBase(req).base}/reset?token=${token}`);
    }
    return page(res, null, 'Reset password', v.forgotPage({ sent: true, email }));
  }
  if (path === '/reset' && method === 'GET') {
    const token = String(url.searchParams.get('token') || '');
    return page(res, null, 'New password', v.resetPage({ token, expired: !db.openReset(sha256(token)) }));
  }
  if (path === '/reset' && method === 'POST') {
    const token = String(form.token || '');
    const reset = db.openReset(sha256(token));
    if (!reset) return page(res, null, 'New password', v.resetPage({ expired: true }), '', 400);
    const password = String(form.password || '');
    if (password.length < 8) return page(res, null, 'New password', v.resetPage({ token, error: 'Passwords need at least 8 characters.' }), '', 400);
    if (!db.useReset(sha256(token))) return page(res, null, 'New password', v.resetPage({ expired: true }), '', 400);
    db.setPassword(reset.user_id, await hashPassword(password));
    return startSession(req, res, reset.user_id, '/');
  }

  if (!user) return redirect(res, '/login');

  // -- everyone signed in
  if (path === '/logout' && method === 'POST') {
    db.deleteSession(jar.dw_sid);
    return redirect(res, '/login', { 'Set-Cookie': 'dw_sid=; Path=/; Max-Age=0' });
  }
  if (path === '/profile' && method === 'GET') return page(res, user, 'Profile', v.profilePage({ user }), flash);
  if (path === '/profile/password' && method === 'POST') {
    const password = String(form.password || '');
    const hasPassword = user.password_hash.startsWith('scrypt$');
    const pwError = hasPassword && !(await checkPassword(String(form.current || ''), user.password_hash)) ? 'Your current password isn’t right.'
      : password.length < 8 ? 'Passwords need at least 8 characters.' : '';
    if (pwError) return page(res, user, 'Profile', v.profilePage({ user, pwError }), '', 400);
    db.setPassword(user.id, await hashPassword(password));   // ends every session, this one included...
    return startSession(req, res, user.id, '/', [flashCookie('Password saved. Any other devices are logged out.')['Set-Cookie']]);   // ...so start a new one
  }
  if (path === '/profile' && method === 'POST') {
    const p = { name: clean(form.name, 80), phone: clean(form.phone, 30), home_name: clean(form.home_name, 120),
      area: clean(form.area, 120), bio: clean(form.bio, 500), sms_ok: form.sms ? 1 : 0, email_ok: form.email_ok ? 1 : 0 };
    if (user.role === 'manager' && !p.home_name) p.home_name = user.home_name;
    if (user.role === 'cleaner') p.home_name = '';
    if (!p.name || !p.phone) return page(res, user, 'Profile', v.profilePage({ user: { ...user, ...p }, error: 'Name and phone are required.' }), '', 400);
    db.updateProfile(user.id, p);
    if (p.sms_ok && (!user.sms_ok || toE164(p.phone) !== user.phone_e164)) notify.optedIn(user.id);
    const warn = p.sms_ok && !toE164(p.phone) ? ' That phone number doesn’t look like a US cell number, so texts can’t reach it.' : '';
    return redirect(res, '/', flashCookie(`Profile saved.${warn}`));
  }

  if (path === '/texts' && method === 'GET') {
    return page(res, user, 'Texts', v.textsPage({ user, messages: db.userMessages(user.id), live: sms.live() }), flash);
  }
  // Test mode: type a reply as if it were texted from your phone.
  if (path === '/texts/reply' && method === 'POST') {
    if (sms.live()) return redirect(res, '/texts', flashCookie('Texts are live: reply from your phone.'));
    if (!user.phone_e164) return redirect(res, '/texts', flashCookie('Add a US cell number to your profile first.'));
    notify.incoming(user.phone_e164, clean([].concat(form.body).filter(Boolean).pop(), 300));   // a quick button, or the typed reply
    return redirect(res, '/texts');
  }

  if (path === '/invite' && method === 'GET') {
    const base = publicBase(req).base;
    const referral = { code: user.referral_code, people: db.referralsOf(user.id),
      cleanerLink: `${base}/signup?ref=${user.referral_code}`, managerLink: `${base}/signup?role=manager&ref=${user.referral_code}` };
    return page(res, user, 'Invite', v.invitePage({ user, sent: db.sentInvites(user.id), lanOnly: publicBase(req).lanOnly, referral }), flash);
  }
  if (path === '/admin' && method === 'GET') {
    if (!user.isAdmin) return page(res, user, 'Not found', v.notFound(), '', 404);
    return page(res, user, 'Admin', v.adminPage({ leaders: db.referralLeaderboard(), signups: db.recentSignups(), totals: db.referralTotals() }), flash);
  }
  if (path === '/invite' && method === 'POST') {
    const kind = user.role === 'manager' && ['regular', 'outside', 'manager'].includes(form.kind) ? form.kind : 'cleaner';
    const token = randomBytes(12).toString('base64url');
    db.createInvite({ token, inviter_id: user.id, role: kind === 'manager' ? 'manager' : 'cleaner',
      tier: kind === 'regular' || kind === 'outside' ? kind : null, name: clean(form.name, 80), phone: clean(form.phone, 30) });
    return redirect(res, `/invite/${token}`);
  }
  const inv = path.match(/^\/invite\/([\w-]+)$/);
  if (inv && method === 'GET') {
    const invite = db.inviteByToken(inv[1]);
    if (!invite || invite.inviter_id !== user.id) return page(res, user, 'Not found', v.notFound(), '', 404);
    const { base, lanOnly } = publicBase(req);
    const link = `${base}/signup?invite=${invite.token}`;
    return page(res, user, 'Invite', v.inviteReadyPage({ user, invite, link, message: inviteMessage(user, invite, link), lanOnly }), flash);
  }

  return user.role === 'cleaner' ? cleanerRoutes(req, res, { user, path, method, form, flash })
    : managerRoutes(req, res, { user, path, method, form, flash });
}

function cleanerRoutes(req, res, { user, path, method, form, flash }) {
  const today = localDay();
  if (path === '/' && method === 'GET') {
    const body = v.cleanerHome({
      user, pending: db.cleanerPending(user.id, today), upcoming: db.cleanerUpcoming(user.id, today),
      cancelled: db.cleanerRecentCancelled(user.id, today), washes: db.cleanerWashCount(user.id),
      availableSoon: db.availableDays(user.id, today, localDay(13)).length,
    });
    return page(res, user, 'Wash jobs', body, flash);
  }
  if (path === '/availability' && method === 'GET') {
    const days = Array.from({ length: AVAIL_DAYS }, (_, i) => localDay(i));
    return page(res, user, 'Availability', v.availabilityPage({ user, days, chosen: db.availableDays(user.id, days[0], days.at(-1)) }), flash);
  }
  if (path === '/availability' && method === 'POST') {
    const chosen = [].concat(form.day || []).filter(isDay);
    // Only touch the window the cleaner saw, never past days.
    const from = isDay(form.from) && form.from > today ? form.from : today;
    const to = isDay(form.to) ? form.to : localDay(AVAIL_DAYS - 1);
    db.setAvailability(user.id, from, to, chosen);
    return redirect(res, '/', flashCookie(`Saved. You're available ${chosen.length} day${chosen.length === 1 ? '' : 's'}.`));
  }
  const m = path.match(/^\/requests\/(\d+)\/(accept|decline)$/);
  if (m && method === 'POST') {
    const r = db.requestById(Number(m[1]));
    if (!r || r.cleaner_id !== user.id) return page(res, user, 'Not found', v.notFound(), '', 404);
    const outcome = db.answerRequest(r.id, m[2] === 'accept');
    notify.answered(r.id, outcome);
    const result = outcome.result;
    const msg = { accepted: 'You’re confirmed. The manager can see it now.', declined: 'Declined. Thanks for letting them know.',
      conflict: 'You already have a wash booked during this time. Ask the manager about another slot.',
      full: 'Sorry, every spot on that one just filled.', gone: 'That request was already called off.' }[result];
    return redirect(res, '/', flashCookie(msg));
  }
  return page(res, user, 'Not found', v.notFound(), '', 404);
}

/** The book-a-service form (also used to edit one), cleaned and checked; null if something required is missing. */
function serviceForm(form, today) {
  const s = { title: clean(form.title, 120), day: clean(form.day, 10), time: clean(form.time, 5), location: clean(form.location, 200),
    duration_minutes: Number(form.duration_minutes || 120), needed: Number(form.needed), pay: clean(form.pay, 60), notes: clean(form.notes, 500),
    boat_name: clean(form.boat_name, 120), boat_details: clean(form.boat_details, 200), owner_phone: clean(form.owner_phone, 30) };
  const ok = s.title && s.location && isDay(s.day) && s.day >= today && isTime(s.time) && Number.isInteger(s.needed) && s.needed >= 1 && s.needed <= 12 && Number.isInteger(s.duration_minutes) && s.duration_minutes >= 15 && s.duration_minutes <= 720 && s.duration_minutes % 15 === 0 && Number(s.time.slice(0, 2)) * 60 + Number(s.time.slice(3)) + s.duration_minutes <= 1440;
  return ok ? s : null;
}
const SERVICE_FORM_ERROR = 'Please fill in the service, a date from today on, a time, the marina or slip, and 1–12 cleaners, and a duration of 15–720 minutes that ends by midnight.';

function managerRoutes(req, res, { user, path, method, form, flash }) {
  const today = localDay();
  if (path === '/' && method === 'GET') {
    return page(res, user, 'Services', v.managerHome({ user, today, services: db.managerServices(user.id, today), past: db.pastServices(user.id, today) }), flash);
  }
  if (path === '/services' && method === 'POST') {
    const s = serviceForm(form, today);
    if (!s) return redirect(res, '/', flashCookie(SERVICE_FORM_ERROR));
    return redirect(res, `/services/${db.createService({ ...s, manager_id: user.id })}`);
  }
  if (path === '/crew' && method === 'GET') {
    return page(res, user, 'My Crew', v.crewPage({ user, regulars: db.crewList(user.id, 'regular'), outside: db.crewList(user.id, 'outside') }), flash);
  }
  if (path === '/crew' && method === 'POST') {
    const b = db.userById(Number(form.cleaner));
    if (b?.role === 'cleaner') {
      if (form.tier === 'regular' || form.tier === 'outside') db.setCrew(user.id, b.id, form.tier);
      else db.removeCrew(user.id, b.id);
    }
    const back = /^\/cleaners(\/\d+)?$/.test(form.back || '') ? form.back : '/crew';
    return redirect(res, back, flashCookie(b ? `${b.name}: ${form.tier === 'regular' ? 'added to regulars' : form.tier === 'outside' ? 'added to backup cleaners' : 'removed from your crew'}.` : 'Cleaner not found.'));
  }
  if (path === '/cleaners' && method === 'GET') return page(res, user, 'Find Cleaners', v.cleanersPage({ user, cleaners: db.allCleaners(user.id) }), flash);
  // One cleaner: the manager's own stars and note on them, and their washes with this home.
  const bp = path.match(/^\/cleaners\/(\d+)(\/note)?$/);
  if (bp) {
    const b = db.cleanerProfile(user.id, Number(bp[1]));
    if (!b) return page(res, user, 'Not found', v.notFound(), '', 404);
    if (!bp[2] && method === 'GET') return page(res, user, b.name, v.cleanerPage({ user, b, history: db.historyWithHome(user.id, b.id) }), flash);
    if (bp[2] && method === 'POST') {
      const rating = form.rating ? Number(form.rating) : null;
      if (rating !== null && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) {
        return redirect(res, `/cleaners/${b.id}`, flashCookie('Pick 1 to 5 stars, or none.'));
      }
      db.saveNote(user.id, b.id, rating, clean(form.note, 1000));
      return redirect(res, `/cleaners/${b.id}`, flashCookie(`Saved. Only you see what you keep on ${b.name}.`));
    }
    return page(res, user, 'Not found', v.notFound(), '', 404);
  }

  const m = path.match(/^\/services\/(\d+)(?:\/(request|request-regulars|withdraw|cancel|edit))?$/);
  const s = m && db.serviceById(Number(m[1]));
  if (!s || s.manager_id !== user.id) return page(res, user, 'Not found', v.notFound(), '', 404);
  const back = `/services/${s.id}`;
  if (!m[2] && method === 'GET') {
    return page(res, user, s.title, v.servicePage({ user, s, people: db.candidates(s.id), accepted: db.acceptedCount(s.id), today }), flash);
  }
  if (m[2] === 'edit') {
    if (s.cancelled) return redirect(res, back, flashCookie('That service is cancelled.'));
    if (s.day < today) return redirect(res, back, flashCookie('That service already happened, so it can’t be changed.'));
    if (method === 'GET') return page(res, user, `Edit ${s.title}`, v.serviceEditPage({ user, s, today }), flash);
    if (method !== 'POST') return page(res, user, 'Not found', v.notFound(), '', 404);
    const changed = serviceForm(form, today);
    if (!changed) {
      const typed = Object.fromEntries(['title', 'day', 'time', 'duration_minutes', 'needed', 'location', 'pay', 'notes', 'boat_name', 'boat_details', 'owner_phone']
        .map((k) => [k, clean(form[k], 500)]));
      return page(res, user, `Edit ${s.title}`, v.serviceEditPage({ user, s: { ...s, ...typed }, today, error: SERVICE_FORM_ERROR }), '', 400);
    }
    const saved = db.updateService(s.id, changed);
    if (!saved.ok) {
      return redirect(res, `${back}/edit`, flashCookie(`${saved.accepted} ${saved.accepted === 1 ? 'is' : 'are'} confirmed. Release someone first to need fewer.`));
    }
    const told = notify.serviceChanged(s, saved);
    const people = `${told} cleaner${told === 1 ? '' : 's'}`;
    return redirect(res, back, flashCookie(!told ? 'Saved.' : saved.moved ? `Saved. ${people} asked again for the new time.` : `Saved. ${people} told what changed.`));
  }
  if (method !== 'POST') return page(res, user, 'Not found', v.notFound(), '', 404);
  if (s.cancelled) return redirect(res, back, flashCookie('That service is cancelled.'));
  if (m[2] === 'cancel') {
    notify.cancelled(s.id, db.cancelService(s.id));
    return redirect(res, '/', flashCookie(`${s.title} cancelled. Everyone booked or asked has been told.`));
  }
  const full = db.acceptedCount(s.id) >= s.needed;
  if (m[2] === 'request') {
    const b = db.userById(Number(form.cleaner));
    if (b?.role !== 'cleaner' || full) return redirect(res, back, flashCookie(full ? 'All spots are filled.' : 'Cleaner not found.'));
    if (db.createRequest(s.id, b.id)) notify.requested(s.id, b.id);
    return redirect(res, back, flashCookie(`Request sent to ${b.name}.`));
  }
  if (m[2] === 'request-regulars') {
    if (full) return redirect(res, back, flashCookie('All spots are filled.'));
    const ask = db.candidates(s.id).filter((p) => p.tier === 'regular' && p.available && !p.booked_elsewhere && (!p.request_status || p.request_status === 'cancelled'));
    for (const p of ask) if (db.createRequest(s.id, p.id)) notify.requested(s.id, p.id);
    return redirect(res, back, flashCookie(`Requests sent to ${ask.length} regular${ask.length === 1 ? '' : 's'}. First ${s.needed} to accept get the wash.`));
  }
  if (m[2] === 'withdraw') {
    const was = db.withdrawRequest(s.id, Number(form.cleaner));
    if (was) notify.withdrawn(s.id, Number(form.cleaner), was);
    return redirect(res, back, flashCookie('Request withdrawn.'));
  }
}

// ---- start

setInterval(() => db.pruneSessions(), 3600e3).unref();
setInterval(() => sms.syncWebhook(), 60e3).unref();
setInterval(() => { try { reminders.run(); } catch (err) { console.error('Reminders failed:', err); } }, 10 * 60e3).unref();
sms.syncWebhook();
createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(new Date().toISOString(), req.method, req.url, err);
    if (!res.headersSent) send(res, err.status || 500, err.status === 413 ? 'Too large' : 'Something went wrong. Please try again.');
  });
}).listen(PORT, function () { console.log(`DockWash listening on http://0.0.0.0:${this.address().port}`); });
