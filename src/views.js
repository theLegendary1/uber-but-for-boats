// The pages' HTML. Every value from the database or the visitor goes through esc().

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const pun = () => 'Clean boats. A crew you trust. A schedule that works.';

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });
const SHORT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const shortDay = (day) => SHORT.format(utc(day));
const LONG = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
const utc = (day) => new Date(`${day}T00:00:00Z`);
export const prettyDay = (day) => LONG.format(utc(day));
export const prettyTime = (t) => {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const tel = (phone) => (phone ? `<a href="tel:${esc(phone.replace(/[^\d+]/g, ''))}">${esc(phone)}</a>` : '<span class="muted">no phone</span>');
// What Twilio's A2P reviewers look for next to the opt-in: who, what, frequency, rates, STOP/HELP, and the policies.
const SMS_CONSENT = 'By checking this box you agree to receive text messages from DockWash about wash requests, confirmations and changes. '
  + 'Message frequency varies. Message and data rates may apply. Reply STOP to opt out, HELP for help. '
  + 'Consent is not a condition of using DockWash. See our <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.';
const csrfField = (user) => `<input type="hidden" name="csrf" value="${esc(user.csrf)}">`;
const post = (user, action, label, cls = '', extra = '') =>
  `<form method="post" action="${esc(action)}" class="inline">${csrfField(user)}${extra}<button class="${cls}">${label}</button></form>`;

export function layout({ title, user, body, flash }) {
  const nav = !user ? '' : user.role === 'manager'
    ? `<a href="/">Schedule</a><a href="/crew">My Crew</a><a href="/cleaners">Find Cleaners</a><a href="/invite">Invite</a><a href="/texts">Texts</a>`
    : `<a href="/">Wash jobs</a><a href="/availability">Availability</a><a href="/invite">Invite</a><a href="/texts">Texts</a>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · DockWash</title><link rel="stylesheet" href="/styles.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚓</text></svg>">
</head><body>
<header><a class="brand" href="/">⚓ Dock<b>Wash</b></a>
${user ? `<nav>${nav}${user.isAdmin ? '<a href="/admin">Admin</a>' : ''}<a href="/profile">${esc(user.name.split(' ')[0])}</a>${post(user, '/logout', 'Log out', 'link')}</nav>` : ''}
</header>
<main>${flash ? `<p class="flash">${esc(flash)}</p>` : ''}${body}</main>
<footer>${esc(pun())}<br><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></footer>
<script src="/app.js"></script>
</body></html>`;
}

// ---- signed out

const GOOGLE_G = `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z"/><path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>`;
const googleButton = (href, label = 'Continue with Google') => `<a class="button google" href="${esc(href)}">${GOOGLE_G}<span>${label}</span></a>
<p class="or"><span>or</span></p>`;

export const loginPage = ({ error, email = '', googleOn }) => `
<section class="hero"><h1>A clean boat. A clear schedule.</h1>
<p>Find your dockside crew. Plan boat washes around your marina, and let cleaners choose the days they work.</p></section>
<section class="card narrow"><h2>Log in</h2>
${error ? `<p class="error">${esc(error)}</p>` : ''}
${googleOn ? googleButton('/auth/google') : ''}
<form method="post" action="/login">
<label>Email <input name="email" type="email" required autocomplete="username" value="${esc(email)}"></label>
<label>Password <input name="password" type="password" required autocomplete="current-password"></label>
<button class="primary">Log in</button></form>
<p><a href="/forgot">Forgot your password?</a></p>
<p class="muted">New here? <a href="/signup?role=cleaner">Sign up as a cleaner</a> or <a href="/signup?role=manager">as a marina manager</a>.</p>
</section>`;

export function signupPage({ role, error, v = {}, needCode, invite, google, googleOn, ref = '', referrerName }) {
  if (invite) role = invite.role;
  const manager = role === 'manager';
  v = { name: invite?.name || google?.name, phone: invite?.phone, ...v };
  const refQ = ref ? `&ref=${encodeURIComponent(ref)}` : '';
  const googleHref = `/auth/google?role=${manager ? 'manager' : 'cleaner'}${invite ? `&invite=${encodeURIComponent(invite.token)}` : ''}${refQ}`;
  return `<section class="card narrow"><h2>${manager ? 'Marina manager sign-up' : 'Cleaner sign-up'}</h2>
${invite ? `<p class="flash">${esc(invite.inviter_name)}${invite.inviter_home ? ` from ${esc(invite.inviter_home)}` : ''} invited you to DockWash.</p>`
    : referrerName ? `<p class="flash">${esc(referrerName)} referred you to DockWash.</p>` : ''}
${error ? `<p class="error">${esc(error)}</p>` : ''}
${google ? `<p class="flash">Signed in with Google as <b>${esc(google.email)}</b>. Just a few more details.</p>` : googleOn ? googleButton(googleHref, 'Sign up with Google') : ''}
<form method="post" action="/signup"><input type="hidden" name="role" value="${manager ? 'manager' : 'cleaner'}">
${invite ? `<input type="hidden" name="invite" value="${esc(invite.token)}">` : ''}${ref ? '<input type="hidden" name="via" value="link">' : ''}
<label>Your name <input name="name" required maxlength="80" value="${esc(v.name)}"></label>
${manager ? `<label>Marina <input name="home_name" required maxlength="120" value="${esc(v.home_name)}"></label>`
    : `<label>Area you'll travel <input name="area" maxlength="120" placeholder="e.g. Queens & Nassau" value="${esc(v.area)}"></label>`}
<label>Mobile phone number <input name="phone" type="tel" required maxlength="30" placeholder="(555) 000-0000" value="${esc(v.phone)}"></label>
${google ? '' : `<label>Email <input name="email" type="email" required maxlength="120" autocomplete="username" value="${esc(v.email)}"></label>
<label>Password <input name="password" type="password" required minlength="8" autocomplete="new-password"></label>`}
<label class="check"><input type="checkbox" name="sms"${v.sms ? ' checked' : ''}> ${manager ? 'Text me when cleaners answer my requests' : 'Text me wash requests I can answer YES or NO'}
<small class="muted">${SMS_CONSENT}</small></label>
${invite ? '' : `<label>Referral code${needCode ? '' : ' <small class="muted">(optional: who told you about DockWash?)</small>'}
<input name="code"${needCode ? ' required' : ''} maxlength="40" autocomplete="off" autocapitalize="characters" placeholder="e.g. FRANK7K2" value="${esc(v.code || ref)}"></label>`}
<label class="check"><input type="checkbox" name="terms" required${v.terms ? ' checked' : ''}> I have read and agree to the
<a href="/terms">Terms of Service</a> and <a href="/privacy">Privacy Policy</a>.</label>
<button class="primary">Yes, create my account</button></form>
${invite ? '' : `<p class="muted">Signing up as a ${manager ? `manager? <a href="/signup?role=cleaner${refQ}">I'm a cleaner</a>` : `cleaner? <a href="/signup?role=manager${refQ}">I'm a marina manager</a>`}.
Have an account? <a href="/login">Log in</a>.</p>`}</section>`;
}

export function profilePage({ user, error, pwError }) {
  const manager = user.role === 'manager';
  return `<section class="card narrow"><h2>Your profile</h2>
${error ? `<p class="error">${esc(error)}</p>` : ''}
<form method="post" action="/profile">${csrfField(user)}
<label>Name <input name="name" required maxlength="80" value="${esc(user.name)}"></label>
${manager ? `<label>Marina <input name="home_name" required maxlength="120" value="${esc(user.home_name)}"></label>`
    : `<label>Area you'll travel <input name="area" maxlength="120" value="${esc(user.area)}"></label>
<label>About you <textarea name="bio" maxlength="500" rows="3" placeholder="Boat detailing experience, equipment, transport, areas you cover...">${esc(user.bio)}</textarea></label>`}
<label>Cell phone <input name="phone" type="tel" required maxlength="30" value="${esc(user.phone)}"></label>
<label class="check"><input type="checkbox" name="sms"${user.sms_ok ? ' checked' : ''}> ${manager ? 'Text me when cleaners answer my requests' : 'Text me wash requests I can answer YES or NO'}
<small class="muted">${SMS_CONSENT}</small></label>
<label class="check"><input type="checkbox" name="email_ok"${user.email_ok ? ' checked' : ''}> Email me the same notices</label>
<p class="muted">Email: ${esc(user.email)}</p>
<button class="primary">Save</button></form></section>
<section class="card narrow" id="password"><h2>${user.password_hash.startsWith('scrypt$') ? 'Change password' : 'Set a password'}</h2>
${pwError ? `<p class="error">${esc(pwError)}</p>` : ''}
<form method="post" action="/profile/password">${csrfField(user)}
${user.password_hash.startsWith('scrypt$') ? '<label>Current password <input name="current" type="password" required autocomplete="current-password"></label>'
    : '<p class="muted">You sign in with Google. A password lets you sign in with your email too.</p>'}
<label>New password <input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
<button>Save password</button></form></section>`;
}

// ---- cleaners

/** Where a service is: the church (or other location), then the boat_name with its address and phone if there is one. */
const where = (s) => `<p>📍 ${esc(s.location)}</p>${s.boat_name || s.boat_details ? `<p>⛵ ${[s.boat_name, s.boat_details].filter(Boolean).map(esc).join(' · ')}${
  s.owner_phone ? ` · ${tel(s.owner_phone)}` : ''}</p>` : ''}`;

function jobCard(user, j, actions) {
  return `<article class="card job">
<div class="when"><b>${esc(prettyDay(j.day))}</b> · ${esc(prettyTime(j.time))} · ${j.duration_minutes} min</div>
<h3>${esc(j.title)} <span class="muted">· ${esc(j.home_name)}</span></h3>
${where(j)}
${j.pay ? `<p>💵 ${esc(j.pay)}</p>` : ''}${j.notes ? `<p class="notes">${esc(j.notes)}</p>` : ''}
<p class="muted">${j.accepted} of ${j.needed} cleaners confirmed · ${esc(j.manager_name)} ${tel(j.manager_phone)}</p>
${actions}</article>`;
}

export function cleanerHome({ user, pending, upcoming, cancelled, washes, availableSoon }) {
  const answer = (j) => `<div class="actions">
${post(user, `/requests/${j.request_id}/accept`, 'Accept the wash', 'primary')}
${post(user, `/requests/${j.request_id}/decline`, 'Decline')}</div>`;
  return `<h1>Hi, ${esc(user.name.split(' ')[0])}</h1>
<p class="muted">${washes} wash${washes === 1 ? '' : 'es'} through DockWash ·
${availableSoon ? `available ${availableSoon} day${availableSoon === 1 ? '' : 's'} in the next 2 weeks` : `<b>you're not marked available for the next 2 weeks</b>`} ·
<a href="/availability">update availability</a></p>
<h2>Requests ${pending.length ? `<span class="badge">${pending.length}</span>` : ''}</h2>
${pending.map((j) => jobCard(user, j, answer(j))).join('') || '<p class="empty">No requests right now. Managers see you on the days you mark yourself available.</p>'}
<h2>Your upcoming washes</h2>
${upcoming.map((j) => jobCard(user, j, `<p class="ok">✔ You're confirmed</p>`)).join('') || '<p class="empty">Nothing booked yet.</p>'}
${cancelled.length ? `<h2>Recently called off</h2>${cancelled.map((j) => `<p class="muted">✖ ${esc(j.title)}, ${esc(j.home_name)} on ${esc(prettyDay(j.day))}:
${j.cancelled ? 'the service was cancelled' : j.accepted >= j.needed ? 'the spots filled up' : 'the manager withdrew the request'}.</p>`).join('')}` : ''}`;
}

export function availabilityPage({ user, days, chosen }) {
  const set = new Set(chosen);
  const pad = (utc(days[0]).getUTCDay() + 6) % 7;     // Monday-first grid
  const cells = Array(pad).fill('<span></span>').concat(days.map((d) => {
    const dd = Number(d.slice(8));
    const month = d === days[0] || dd === 1 ? MONTH.format(utc(d)) : '&nbsp;';  // name the month where it starts
    return `<label class="day${set.has(d) ? ' on' : ''}" title="${esc(prettyDay(d))}"><input type="checkbox" name="day" value="${d}"${set.has(d) ? ' checked' : ''}>
<small>${month}</small><b>${dd}</b></label>`;
  }));
  return `<h1>When can you wash?</h1>
<p class="muted">Tap the days you're free. Managers only see you on the days you pick.</p>
<form method="post" action="/availability" class="card">${csrfField(user)}
<input type="hidden" name="from" value="${days[0]}"><input type="hidden" name="to" value="${days.at(-1)}">
<div class="quick"><button type="button" data-pick="all">All</button><button type="button" data-pick="weekdays">Weekdays</button>
<button type="button" data-pick="weekends">Weekends</button><button type="button" data-pick="none">Clear</button></div>
<div class="cal">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<span class="head">${d}</span>`).join('')}${cells.join('')}</div>
<button class="primary">Save availability</button></form>`;
}

// ---- managers

/** A manager's own stars for a cleaner, e.g. ★★★★☆ (nothing if unrated). */
const stars = (rating) => rating ? `<span class="stars" title="${rating} of 5">${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}</span>` : '';
/** A cleaner's name, linking to what the manager keeps on them, then their stars and the start of the note. */
const cleanerName = (p) => `<a href="/cleaners/${p.id}"><b>${esc(p.name)}</b></a> ${stars(p.rating)}`;
const noteLine = (p) => p.note ? `<br><small class="note">📝 ${esc(p.note.length > 90 ? `${p.note.slice(0, 90)}…` : p.note)}</small>` : '';

const statusPill = (s) => s.cancelled ? '<span class="pill gray">Cancelled</span>'
  : s.accepted >= s.needed ? '<span class="pill green">Filled</span>'
  : `<span class="pill amber">${s.needed - s.accepted} open</span>`;

/** The service form's fields, for booking a new one (`s` empty) or editing one. */
const serviceFields = (s, today) => `
<label class="wide">Wash job <input name="title" required maxlength="120" placeholder="e.g. Sea Breeze · exterior wash" value="${esc(s.title)}"></label>
<label>Date <input name="day" type="date" required min="${today}" value="${esc(s.day || today)}"></label>
<label>Start time <input name="time" type="time" required value="${esc(s.time || '10:00')}"></label>
<label>Duration (minutes) <input name="duration_minutes" type="number" min="15" max="720" step="15" required value="${esc(s.duration_minutes || 120)}"></label>
<label>Cleaners needed <input name="needed" type="number" min="1" max="12" value="${esc(s.needed || 1)}" required></label>
<label>Pay <input name="pay" maxlength="60" placeholder="e.g. $75 cash" value="${esc(s.pay)}"></label>
<label class="wide">Marina / dock / slip <input name="location" required maxlength="200" placeholder="e.g. Harbor Marina, Dock B, Slip 12" value="${esc(s.location)}"></label>
<label>Boat name <input name="boat_name" maxlength="120" placeholder="e.g. Sea Breeze" value="${esc(s.boat_name)}"></label>
<label>Owner phone <input name="owner_phone" type="tel" maxlength="30" value="${esc(s.owner_phone)}"></label>
<label class="wide">Boat details <input name="boat_details" placeholder="e.g. 32 ft Sea Ray · fiberglass · exterior wash" maxlength="200" value="${esc(s.boat_details)}"></label>
<label class="wide">Notes for the cleaners <textarea name="notes" rows="2" maxlength="500" placeholder="Wash package, supplies, water access, gate code, special instructions...">${esc(s.notes)}</textarea></label>`;

export function managerHome({ user, services, past, today }) {
  const row = (s) => `<a class="card service-row" href="/services/${s.id}">
<div><b>${esc(prettyDay(s.day))}</b> · ${esc(prettyTime(s.time))} · ${s.duration_minutes} min<br><span>${esc(s.title)}</span> <span class="muted">· ${esc(s.location)}${s.boat_name ? ` · ${esc(s.boat_name)}` : ''}</span></div>
<div class="right">${statusPill(s)}<small class="muted">${s.accepted}/${s.needed} confirmed${s.pending ? ` · ${s.pending} waiting` : ''}</small></div></a>`;
  const active = services.filter((s) => !s.cancelled);
  const dates = [...new Set(active.map((s) => s.day))];
  const agenda = dates.map((day) => `<section class="agenda-day"><h3>${esc(prettyDay(day))}</h3>${active.filter((s) => s.day === day).map(row).join('')}</section>`).join('');
  return `<p class="eyebrow">MARINA WORKSPACE</p><h1>${esc(user.home_name)}</h1>
<p class="muted">Your boats, your crew, your schedule. Open a wash to assign cleaners or move its time.</p>
<div class="stats"><div class="card"><b>${active.length}</b><small>Upcoming washes</small></div><div class="card"><b>${active.filter((s) => s.day === today).length}</b><small>Washes today</small></div><div class="card"><b>${active.reduce((n, s) => n + Math.max(0, s.needed - s.accepted), 0)}</b><small>Cleaner spots open</small></div><div class="card"><b>${active.reduce((n, s) => n + s.accepted, 0)}</b><small>Confirmed bookings</small></div></div>
<h2>Wash schedule</h2>${agenda || '<p class="empty">Your schedule is clear. Create your first boat wash below.</p>'}
<details class="card" open><summary>Schedule a boat wash</summary>
<form method="post" action="/services" class="grid">${csrfField(user)}${serviceFields({}, today)}
<button class="primary wide">Next: choose cleaners →</button></form></details>
${services.some((s) => s.cancelled) ? `<details><summary>Cancelled washes</summary>${services.filter((s) => s.cancelled).map(row).join('')}</details>` : ''}
${past.length ? `<details><summary>Past washes</summary>${past.map(row).join('')}</details>` : ''}`;
}

export function serviceEditPage({ user, s, today, error }) {
  return `<p><a href="/services/${s.id}">← ${esc(s.title)}</a></p>
<section class="card"><h1>Reschedule / edit wash</h1>
${error ? `<p class="error">${esc(error)}</p>` : ''}
<p class="muted">Everyone booked or asked hears about a new place, pay or notes. A new date, time or duration asks them again:
confirmed cleaners go back to <i>Waiting</i> until they say yes.</p>
<form method="post" action="/services/${s.id}/edit" class="grid">${csrfField(user)}${serviceFields(s, today)}
<button class="primary wide">Save changes</button></form></section>`;
}

export function servicePage({ user, s, people, accepted, today }) {
  const open = !s.cancelled && accepted < s.needed;
  const card = (p) => {
    const st = p.request_status;
    const state = st === 'accepted' ? '<span class="pill green">Confirmed</span>'
      : st === 'pending' ? '<span class="pill amber">Waiting</span>'
      : st === 'declined' ? '<span class="pill gray">Declined</span>'
      : p.booked_elsewhere ? `<span class="pill gray">Cleaning ${esc(p.booked_elsewhere)}</span>`
      : p.available ? '<span class="pill blue">Available</span>' : '<span class="pill gray">Not marked available</span>';
    const action = s.cancelled ? ''
      : st === 'pending' || st === 'accepted' ? post(user, `/services/${s.id}/withdraw`, st === 'accepted' ? 'Release' : 'Withdraw', 'small', `<input type="hidden" name="cleaner" value="${p.id}">`)
      : open ? post(user, `/services/${s.id}/request`, st === 'declined' ? 'Ask again' : 'Request', p.available ? 'small primary' : 'small', `<input type="hidden" name="cleaner" value="${p.id}">`) : '';
    return `<div class="person${p.available || st === 'accepted' || st === 'pending' ? '' : ' dim'}"><div>${cleanerName(p)} ${tel(p.phone)}<br>
<small class="muted">${esc(p.area)}${p.bio ? ` · ${esc(p.bio)}` : ''}</small>${noteLine(p)}</div><div class="right">${state}${action}</div></div>`;
  };
  // Backup cleaners and strangers only show when they've said they're free (or are already on this service).
  const relevant = (p) => p.available || p.request_status;
  const regulars = people.filter((p) => p.tier === 'regular');
  const outside = people.filter((p) => p.tier === 'outside' && relevant(p));
  const others = people.filter((p) => !p.tier && relevant(p));
  const askable = regulars.filter((p) => p.available && !p.booked_elsewhere && (!p.request_status || p.request_status === 'cancelled'));
  const section = (title, list, empty) => `<section class="card"><h2>${title}</h2>${list.map(card).join('') || `<p class="empty">${empty}</p>`}</section>`;
  return `<p><a href="/">← Services</a></p>
<section class="card job"><div class="when"><b>${esc(prettyDay(s.day))}</b> · ${esc(prettyTime(s.time))} ${statusPill({ ...s, accepted })}</div>
<h1>${esc(s.title)}</h1><p class="muted">${s.duration_minutes} minute wash</p>${where(s)}${s.pay ? `<p>💵 ${esc(s.pay)}</p>` : ''}${s.notes ? `<p class="notes">${esc(s.notes)}</p>` : ''}
<p><b>${accepted} of ${s.needed}</b> cleaners confirmed.${open ? '' : s.cancelled ? '' : ' The rest of the requests were called off.'}</p>
${!s.cancelled ? `<div class="actions">
${open && askable.length ? post(user, `/services/${s.id}/request-regulars`, `Request all ${askable.length} available regular${askable.length === 1 ? '' : 's'}`, 'primary') : ''}
${s.day >= today ? `<a class="button" href="/services/${s.id}/edit">Reschedule / edit</a>` : ''}
${post(user, `/services/${s.id}/cancel`, 'Cancel wash', 'danger', '')}</div>` : ''}</section>
${section('Your regulars', regulars, 'No regulars yet. Add your usual cleaners from <a href="/cleaners">Find Cleaners</a>.')}
${section('Backup cleaners available', outside, 'None of your backup cleaners are free that day.')}
${section('Everyone else available', others, 'No one else has marked themselves free that day.')}`;
}

export function crewPage({ user, regulars, outside }) {
  const list = (people, other) => people.map((p) => `<div class="person"><div>${cleanerName(p)} ${tel(p.phone)}<br>
<small class="muted">${esc(p.area)}${p.bio ? ` · ${esc(p.bio)}` : ''}</small>${noteLine(p)}</div><div class="right">
${post(user, '/crew', other === 'regular' ? 'Make regular' : 'Move to outside', 'small', `<input type="hidden" name="cleaner" value="${p.id}"><input type="hidden" name="tier" value="${other}">`)}
${post(user, '/crew', 'Remove', 'small', `<input type="hidden" name="cleaner" value="${p.id}"><input type="hidden" name="tier" value="none">`)}</div></div>`).join('');
  return `<h1>My crew</h1>
<section class="card"><h2>Regulars</h2><p class="muted">Your usual cleaners. They're listed first on every service, and you can request them all in one tap.</p>
${list(regulars, 'outside') || '<p class="empty">No regulars yet.</p>'}</section>
<section class="card"><h2>Backup cleaners</h2><p class="muted">People you know and would call in a jam.</p>
${list(outside, 'regular') || '<p class="empty">No backup cleaners yet.</p>'}</section>
<p><a href="/cleaners">Find cleaners to add →</a></p>`;
}

export function cleanersPage({ user, cleaners }) {
  return `<h1>Find cleaners</h1><p class="muted">Everyone on DockWash. Add the ones you trust to your crew.</p>
<input class="search" type="search" placeholder="Search by name or area" oninput="for (const el of document.querySelectorAll('.person')) el.hidden = !el.textContent.toLowerCase().includes(this.value.toLowerCase())">
<section class="card">${cleaners.map((p) => `<div class="person"><div>${cleanerName(p)} ${tel(p.phone)}
${p.tier ? `<span class="pill ${p.tier === 'regular' ? 'green' : 'blue'}">${p.tier === 'regular' ? 'Regular' : 'Outside'}</span>` : ''}<br>
<small class="muted">${esc(p.area)} · ${p.washes} wash${p.washes === 1 ? '' : 'es'}${p.bio ? ` · ${esc(p.bio)}` : ''}</small>${noteLine(p)}</div><div class="right">
${p.tier !== 'regular' ? post(user, '/crew', '+ Regular', 'small', `<input type="hidden" name="cleaner" value="${p.id}"><input type="hidden" name="tier" value="regular"><input type="hidden" name="back" value="/cleaners">`) : ''}
${p.tier !== 'outside' ? post(user, '/crew', '+ Outside', 'small', `<input type="hidden" name="cleaner" value="${p.id}"><input type="hidden" name="tier" value="outside"><input type="hidden" name="back" value="/cleaners">`) : ''}
</div></div>`).join('') || '<p class="empty">No cleaners have signed up yet.</p>'}</section>`;
}

export function cleanerPage({ user, b, history: h }) {
  const tier = (to, label) => post(user, '/crew', label, 'small', `<input type="hidden" name="cleaner" value="${b.id}"><input type="hidden" name="tier" value="${to}">
<input type="hidden" name="back" value="/cleaners/${b.id}">`);
  const options = ['<option value="">No rating</option>'].concat([5, 4, 3, 2, 1].map((n) =>
    `<option value="${n}"${b.rating === n ? ' selected' : ''}>${'★'.repeat(n)}${'☆'.repeat(5 - n)}</option>`)).join('');
  return `<p><a href="/crew">← My Crew</a></p>
<section class="card"><h1>${esc(b.name)} ${stars(b.rating)}</h1>
<p>${tel(b.phone)}${b.tier ? ` <span class="pill ${b.tier === 'regular' ? 'green' : 'blue'}">${b.tier === 'regular' ? 'Regular' : 'Outside'}</span>` : ''}</p>
<p class="muted">${esc(b.area)}${b.bio ? ` · ${esc(b.bio)}` : ''}</p>
<div class="actions">${b.tier !== 'regular' ? tier('regular', b.tier ? 'Make regular' : '+ Regular') : ''}
${b.tier !== 'outside' ? tier('outside', b.tier ? 'Move to outside' : '+ Outside') : ''}${b.tier ? tier('none', 'Remove from crew') : ''}</div></section>
<section class="card"><h2>Your notes</h2><p class="muted">Only you see these. Not ${esc(b.name.split(' ')[0])}, not other marinas.</p>
<form method="post" action="/cleaners/${b.id}/note">${csrfField(user)}
<label>Rating <select name="rating">${options}</select></label>
<label>Note <textarea name="note" rows="3" maxlength="1000" placeholder="Reliable? Good with teak? Equipment, preferred wash packages...">${esc(b.note)}</textarea></label>
<button class="primary">Save notes</button></form></section>
<section class="card"><h2>With ${esc(user.home_name)}</h2>
<p><b>${h.washes} wash${h.washes === 1 ? '' : 'es'} with you</b>${h.last_day ? ` · last on ${esc(shortDay(h.last_day))}` : ''}${h.declined ? ` · ${h.declined} declined` : ''}</p>
${h.services.map((s) => `<p><a href="/services/${s.id}">${esc(s.title)}</a> <span class="muted">· ${esc(prettyDay(s.day))}</span></p>`).join('')
    || '<p class="empty">No washes with you yet.</p>'}</section>`;
}

// ---- invites

function referralCard(user, r) {
  const active = r.people.filter((p) => p.active).length;
  const share = `Join me on DockWash: cleaners post the days they can wash and marinas book them, no phone calls. Sign up here: ${r.cleanerLink}`;
  return `<section class="card referral"><h2>Your referral code</h2>
<p class="code">${esc(r.code)}</p>
<p class="muted">Anyone who signs up with your code or from your links counts as yours. So do people you invite below.</p>
<label>Cleaner sign-up link <span class="copyrow"><input id="ref-cleaner" readonly value="${esc(r.cleanerLink)}"><button type="button" data-copy="ref-cleaner">Copy</button></span></label>
<label>Marina manager sign-up link <span class="copyrow"><input id="ref-manager" readonly value="${esc(r.managerLink)}"><button type="button" data-copy="ref-manager">Copy</button></span></label>
<div class="actions"><button type="button" class="primary" data-share-url="${esc(r.cleanerLink)}" data-share-text="Find boat-washing work near you. Choose your days and get booked by marinas.">Share with cleaners</button>
<button type="button" data-share-url="${esc(r.managerLink)}" data-share-text="Find your boat-washing crew and schedule washes around your marina.">Share with marina managers</button>
<a class="button" href="sms:?&amp;body=${esc(encodeURIComponent(share))}">Share by text</a></div>
<p class="muted" id="share-status" role="status" aria-live="polite"></p>
<h3>People you've brought in: ${r.people.length}${r.people.length ? ` · ${active} active` : ''}</h3>
${r.people.length ? r.people.map((p) => `<div class="person"><div><b>${esc(p.name)}</b><br><small class="muted">${p.role === 'manager' ? `Marina manager${p.home_name ? `, ${esc(p.home_name)}` : ''}` : 'Cleaner'}
· joined ${esc(shortDay(p.created_at.slice(0, 10)))}</small></div><div class="right">${p.active
    ? `<span class="pill green">Active</span>` : '<span class="pill gray">Joined</span>'}</div></div>`).join('')
    : '<p class="empty">No one yet. Share your link to get started.</p>'}
<p class="muted note">Active means they've used DockWash for real: a cleaner booked on a wash, or a marina manager with a cleaner booked.</p></section>`;
}

export function invitePage({ user, sent, lanOnly, referral }) {
  const manager = user.role === 'manager';
  const who = (i) => i.role === 'manager' ? 'Marina manager' : i.tier === 'regular' ? 'Regular' : i.tier === 'outside' ? 'Backup cleaner' : 'Cleaner';
  return `${referral ? referralCard(user, referral) : ''}
<h1>Invite by text</h1>
<p class="muted">${manager ? 'Get your crew on DockWash. Anyone who signs up from your text lands straight in your crew.'
    : 'Know another cleaner? Send them a link.'}</p>
${lanOnly ? `<p class="error">DockWash isn't on the internet yet, so this link only works on your home Wi-Fi. Ask your marina administrator for a public invitation link.</p>` : ''}
<form method="post" action="/invite" class="card">${csrfField(user)}
${manager ? `<label>Who are you inviting?
<select name="kind"><option value="regular">One of my regular cleaners</option><option value="outside">An outside cleaner</option>
<option value="manager">Another marina manager</option></select></label>` : '<input type="hidden" name="kind" value="cleaner">'}
<label>Their first name <input name="name" maxlength="80" placeholder="Optional, makes the text personal"></label>
<label>Their cell phone <input name="phone" type="tel" maxlength="30" placeholder="Optional, you can pick them in Messages instead"></label>
<button class="primary">Write the text →</button></form>
${sent.length ? `<h2>Sent invites</h2><section class="card">${sent.map((i) => `<div class="person"><div><b>${esc(i.name || 'No name')}</b>
${i.phone ? esc(i.phone) : ''}<br><small class="muted">${who(i)}</small></div><div class="right">
${i.used_by ? `<span class="pill green">Joined${i.joined_name ? ` as ${esc(i.joined_name)}` : ''}</span>` : `<span class="pill gray">Not yet</span><a class="small-link" href="/invite/${esc(i.token)}">Send again</a>`}
</div></div>`).join('')}</section>` : ''}`;
}

export function inviteReadyPage({ invite, link, message, lanOnly }) {
  const digits = invite.phone.replace(/[^\d+]/g, '');
  return `<p><a href="/invite">← Invites</a></p>
<section class="card"><h1>Your text${invite.name ? ` to ${esc(invite.name)}` : ''}</h1>
${lanOnly ? `<p class="error">This link only works on your home Wi-Fi until your marina administrator enables public invitations.</p>` : ''}
<textarea id="invite-text" rows="6" readonly>${esc(message)}</textarea>
<div class="actions"><a class="button primary" href="sms:${esc(digits)}?&amp;body=${esc(encodeURIComponent(message))}">💬 Open in Messages</a>
<button type="button" data-copy="invite-text">Copy text</button></div>
<p class="muted">On your phone, <b>Open in Messages</b> starts the text for you. On a computer, copy it and send it however you like.
The link works once: ${invite.role === 'manager' ? 'it signs them up as a marina manager' : `it signs them up${invite.tier ? ` and adds them to your ${invite.tier === 'regular' ? 'regulars' : 'backup cleaners'}` : ''}`}.</p>
<p class="muted small">${esc(link)}</p></section>`;
}

// ---- texts

const STAMP = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export function textsPage({ user, messages, live }) {
  const bubbles = messages.slice().reverse().map((m) => `<div class="bubble ${m.direction}">${esc(m.body)}
<small>${esc(STAMP.format(new Date(`${m.created_at.replace(' ', 'T')}Z`)))}${m.direction === 'out' && m.status !== 'sent' && m.status !== 'test'
    ? ` · <b>${esc(m.status === 'skipped' ? `not sent: ${m.error}` : m.status === 'failed' ? `failed: ${m.error}` : m.status)}</b>` : ''}</small></div>`).join('');
  return `<h1>Texts</h1>
${live ? `<p class="muted">Texts between DockWash and ${esc(user.phone)}. Reply from your phone: <b>YES</b>, <b>NO</b>, <b>STOP</b> or <b>HELP</b>.</p>`
    : `<p class="flash"><b>Test mode.</b> DockWash isn't connected to a texting service yet, so these are the texts it <i>would</i> send to ${esc(user.phone)}.
Type a reply below as if you'd texted it back.</p>`}
${!user.sms_ok ? '<p class="error">Texts are off for you (STOP). Reply START, or turn them on in your profile.</p>' : ''}
<section class="card thread">${bubbles || '<p class="empty">No texts yet.</p>'}</section>
${live ? '' : `<form method="post" action="/texts/reply" class="card reply">${csrfField(user)}
<input name="body" required maxlength="300" placeholder="Reply as if by text: YES, NO, STOP, HELP" autocomplete="off" autofocus>
<button class="primary">Send</button>
<div class="quick">${['YES', 'NO', 'HELP', 'STOP', 'START'].map((w) => `<button name="body" value="${w}" formnovalidate>${w}</button>`).join('')}</div></form>`}`;
}

// ---- policies (public; Twilio's A2P registration links to both)

const contact = (support) => support ? `<a href="mailto:${esc(support)}">${esc(support)}</a>` : 'Through the marina that invited you.';

export function privacyPage({ support, base }) {
  return `<section class="card policy"><h1>Privacy Policy</h1><p class="muted">Last updated October 14, 2026</p>
<p>DockWash (${esc(base)}) connects cleaners with marina managers who need them. This policy explains what we collect and how we use it.</p>
<h2>What we collect</h2>
<p>Your name, email address, mobile phone number and password (stored only as a secure hash); for cleaners, the area you travel,
an optional note about yourself and the days you're available; for marina managers, your marina and the services you book;
and the requests, answers, emails and text messages exchanged through DockWash.</p>
<h2>How we use it</h2>
<p>Only to run DockWash: to show cleaners to marina managers on the days they're available, to send and track wash requests,
to email you account messages such as password resets, and, if you opt in, to text you about requests, confirmations and changes.
Marina managers on DockWash can see cleaners' names, phone numbers, areas and notes. Cleaners see the marina,
contact and details of services they're asked to wash.</p>
<h2>Text messages</h2>
<p>If you opt in, DockWash texts you about wash requests and changes to them. Message frequency varies with how often you're
asked to wash. Message and data rates may apply. Reply <b>STOP</b> to stop, <b>START</b> to resume, <b>HELP</b> for help, or turn texts off in your profile.</p>
<p><b>No mobile information will be shared with third parties or affiliates for marketing or promotional purposes.
Text messaging originator opt-in data and consent will not be shared with any third parties.</b>
We use Twilio only to deliver our text messages, and Google only to deliver our emails.</p>
<h2>Sharing</h2>
<p>We don't sell your information or share it with anyone except as above, or when the law requires it.</p>
<h2>Keeping and deleting it</h2>
<p>Your information stays while your account is open. To delete your account and its information, email us.</p>
<h2>Contact</h2><p>${contact(support)}</p></section>`;
}

export function termsPage({ support, base }) {
  return `<section class="card policy"><h1>Terms of Service</h1><p class="muted">Last updated October 14, 2026</p>
<p>DockWash (${esc(base)}) is a tool for cleaners to share when they're available and for marina managers to request them.
Marina managers and cleaners make their own arrangements, including pay; DockWash isn't a party to them.</p>
<h2>Your account</h2>
<p>Give accurate information, keep your password to yourself, and use DockWash only to arrange cleaner work.</p>
<h2>DockWash text messages</h2>
<p><b>Program:</b> DockWash wash notifications. Cleaners who opt in get wash requests they can answer by replying YES or NO,
plus confirmations and changes; marina managers who opt in get notified when cleaners answer.</p>
<p><b>Opting in:</b> by checking the text-message box when you sign up or in your profile. Consent isn't a condition of using DockWash.</p>
<p><b>Frequency:</b> varies with how often you're asked to wash or book. <b>Message and data rates may apply.</b></p>
<p><b>Opting out:</b> reply <b>STOP</b> at any time; we'll confirm and send nothing more unless you reply <b>START</b>.
<b>Help:</b> reply <b>HELP</b>${support ? ` or email ${contact(support)}` : ''}.</p>
<p>Carriers are not liable for delayed or undelivered messages. See our <a href="/privacy">Privacy Policy</a>.</p>
<h2>No guarantee</h2>
<p>DockWash is provided as is. We can't guarantee that a request will be answered or a service filled, and we aren't liable for arrangements made through it.</p>
<h2>Contact</h2><p>${contact(support)}</p></section>`;
}

// ---- password reset

export const forgotPage = ({ sent, email = '' }) => `<section class="card narrow"><h2>Reset your password</h2>
${sent ? `<p class="flash">If there's an account for that email, a reset link is on its way. It works for an hour.
Check your spam folder if it doesn't show up in a few minutes.</p>` : ''}
<form method="post" action="/forgot"><label>Your email <input name="email" type="email" required autocomplete="username" value="${esc(email)}"></label>
<button class="primary">Email me a link</button></form>
<p class="muted"><a href="/login">Back to log in</a></p></section>`;

export const resetPage = ({ token, error, expired }) => `<section class="card narrow"><h2>Choose a new password</h2>
${expired ? `<p class="error">That link has expired or was already used. <a href="/forgot">Get a new one</a>.</p>` : `
${error ? `<p class="error">${esc(error)}</p>` : ''}
<form method="post" action="/reset"><input type="hidden" name="token" value="${esc(token)}">
<label>New password <input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
<button class="primary">Save and log in</button></form>`}</section>`;

// ---- admin

const VIA = { code: 'Typed code', link: 'Share link', invite: 'Personal invite', legacy: 'Old sign-up code' };
export function adminPage({ leaders, signups, totals }) {
  const pct = totals.users ? Math.round((100 * (totals.referred || 0)) / totals.users) : 0;
  return `<h1>Admin</h1>
<section class="stats"><div class="card"><b>${totals.users}</b><small>accounts</small></div>
<div class="card"><b>${totals.cleaners || 0}</b><small>cleaners</small></div>
<div class="card"><b>${totals.managers || 0}</b><small>marina managers</small></div>
<div class="card"><b>${pct}%</b><small>came by referral</small></div></section>
<section class="card"><h2>Referral leaderboard</h2>
<p class="muted">Who has brought people in. <b>Active</b> referrals have used DockWash for real (a cleaner booked on a wash, or a manager with a cleaner booked), so they're the ones worth rewarding.</p>
${leaders.length ? `<div class="scroll"><table><thead><tr><th>#</th><th>Name</th><th>Code</th><th>Brought in</th><th>Active</th><th>Latest</th></tr></thead><tbody>
${leaders.map((l, i) => `<tr><td>${i + 1}</td><td><b>${esc(l.name)}</b><br><small class="muted">${l.role === 'manager' ? esc(l.home_name || 'Marina manager') : 'Cleaner'} · ${esc(l.email)}</small></td>
<td><code>${esc(l.referral_code)}</code></td><td>${l.brought}</td><td>${l.active || 0}</td><td><small>${esc(shortDay(l.last_at.slice(0, 10)))}</small></td></tr>`).join('')}
</tbody></table></div>` : '<p class="empty">No referrals yet.</p>'}</section>
<section class="card"><h2>Recent sign-ups</h2>
<div class="scroll"><table><thead><tr><th>Name</th><th>Joined</th><th>Referred by</th><th>How</th><th></th></tr></thead><tbody>
${signups.map((u) => `<tr><td><b>${esc(u.name)}</b><br><small class="muted">${u.role === 'manager' ? esc(u.home_name || 'Marina manager') : 'Cleaner'} · ${esc(u.email)}</small></td>
<td><small>${esc(shortDay(u.created_at.slice(0, 10)))}</small></td><td>${u.referrer_name ? esc(u.referrer_name) : '<span class="muted">-</span>'}</td>
<td><small>${esc(VIA[u.referral_via] || '')}</small></td><td>${u.active ? '<span class="pill green">Active</span>' : ''}</td></tr>`).join('')}
</tbody></table></div></section>`;
}

export const notFound = () => `<section class="card narrow"><h2>Not found</h2><p>That page could not be found. <a href="/">Go home</a>.</p></section>`;
