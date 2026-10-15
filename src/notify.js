// What DockWash texts, and what it does with the replies (YES, NO, STOP, START, HELP).
import * as db from './db.js';
import * as sms from './sms.js';
import * as mail from './mail.js';
import { settings } from './settings.js';
import { localDay } from './dates.js';
import { prettyTime } from './views.js';

const SHORT_DAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const when = (s) => `${SHORT_DAY.format(new Date(`${s.day}T00:00:00Z`))}, ${prettyTime(s.time)}`;
const link = () => { const u = settings().PUBLIC_URL; return u ? ` ${u.replace(/\/$/, '')}` : ''; };
const first = (name) => name.split(' ')[0];
/** Where, for a text: "St. Jude, then Calvary Boat". */
const place = (s) => s.boat_name ? `${s.location} · ${s.boat_name}` : s.location;

// A light line on good news only (confirmations, a full crew, a wash that's covered, the welcome email). Never on
// requests, cancellations or releases, and never on STOP/HELP/opt-in, whose wording carriers check. HUMOR=off in
// data/app.env turns them off. Kept short: a text over 160 characters is billed as two.
const QUIPS = {
  confirmed: ['See you dockside.'],
  fullCrew: ['Full crew, ready to shine.'],
  covered: ['Thanks for being ready to help.'],
  welcome: ['Clean boats, clear schedules.'],
};
export const quip = (kind) => settings().HUMOR === 'off' ? '' : QUIPS[kind][Math.floor(Math.random() * QUIPS[kind].length)];
/** The text plus a quip, or plus `plain` (e.g. "Thanks!") when humor is off. */
const withQuip = (text, kind, plain = '') => { const q = quip(kind) || plain; return q ? `${text} ${q}` : text; };

const STOP_WORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'OPTOUT', 'REVOKE'];
const START_WORDS = ['START', 'UNSTOP'];
const YES_WORDS = ['YES', 'Y', 'YEP', 'YEAH', 'YA'];
const NO_WORDS = ['NO', 'N', 'NOPE', 'PASS'];
/** HELP has to name the program and say how to reach a person (CTIA rules, checked in A2P review). */
const help = () => {
  const { SUPPORT_EMAIL: email } = settings();
  return `DockWash wash notifications: reply YES to take a wash, NO to pass, STOP to stop texts, START to resume.${email ? ` Help: ${email}` : ''}${site() ? ` ${site()}` : ''}. Msg&data rates may apply.`;
};

/** How a cleaner answers this request by text: plain YES/NO, or YES 12 / NO 12 when they have more than one waiting. */
function replyHint(cleanerId, requestId, [yes, no] = ['take it', 'pass']) {
  const n = db.cleanerPending(cleanerId, localDay()).length > 1 ? ` ${requestId}` : '';
  return `Reply YES${n} to ${yes} or NO${n} to ${no}.`;
}

// ---- texts (and emails) DockWash sends

const site = () => (settings().PUBLIC_URL || '').replace(/\/$/, '');
/** Emails a notice to people who keep email notices on (the default). The text says the same thing, shorter. */
function email(user, subject, lines) {
  if (user?.email && user.email_ok) mail.send(user.email, subject, [`Hi ${first(user.name)},`, '', ...lines].join('\n'));
}
const details = (s) => [`${s.title}`, `When: ${when(s)} (${s.duration_minutes} minutes)`, `Where: ${s.location}`,
  ...(s.boat_name || s.boat_details ? [`Boat: ${[s.boat_name, s.boat_details, s.owner_phone].filter(Boolean).join(', ')}`] : []), ...(s.pay ? [`Pay: ${s.pay}`] : []),
  ...(s.notes ? [`Notes: ${s.notes}`] : [])];

/** A manager asked a cleaner to wash. */
export function requested(serviceId, cleanerId) {
  const s = db.serviceById(serviceId);
  const b = db.userById(cleanerId);
  const r = db.requestFor(serviceId, cleanerId);
  sms.send(b, `DockWash: ${s.home_name} needs a cleaner ${when(s)}. ${s.title} at ${place(s)}${s.pay ? `. Pay: ${s.pay}` : ''}. ${replyHint(b.id, r.id)}`);
  email(b, `Wash request: ${s.title}, ${when(s)}`, [`${s.home_name} would like you to wash:`, '', ...details(s), '',
    `Accept or decline on DockWash${site() ? `: ${site()}/` : '.'}${b.sms_ok && b.phone_e164 ? ' Or just reply YES or NO to our text.' : ''}`,
    'The first to accept get the spots.', '', `${s.manager_name}, ${s.manager_phone}`]);
}

/** A cleaner answered (on the site or by text): tell the manager, and anyone still waiting if that filled it. */
export function answered(requestId, { result, filledOut }) {
  if (result !== 'accepted' && result !== 'declined') return;
  const r = db.requestById(requestId);
  const s = db.serviceById(r.service_id);
  const b = db.userById(r.cleaner_id);
  const n = db.acceptedCount(s.id);
  const manager = db.userById(s.manager_id);
  const status = `${n} of ${s.needed} confirmed.${n >= s.needed ? ' All spots filled!' : ''}`;
  const full = n >= s.needed;
  sms.send(manager, result === 'accepted'
    ? (full ? withQuip(`DockWash: ${b.name} is in for ${s.title} (${when(s)}). ${status}`, 'fullCrew') : `DockWash: ${b.name} is in for ${s.title} (${when(s)}). ${status}`)
    : `DockWash: ${b.name} can't make ${s.title} (${when(s)}). ${status}`);
  email(manager, `${b.name} ${result === 'accepted' ? 'is in for' : 'can’t make'} ${s.title}`,
    [`${b.name} (${b.phone}) ${result === 'accepted' ? 'accepted' : 'declined'} ${s.title} on ${when(s)}.`, '', status,
      ...(site() ? ['', `The service: ${site()}/services/${s.id}`] : [])]);
  filled(s, filledOut);
}

/** The spots filled before these cleaners answered. */
function filled(s, cleanerIds) {
  for (const id of cleanerIds) {
    const u = db.userById(id);
    sms.send(u, withQuip(`DockWash: ${s.title} with ${s.home_name} (${when(s)}) is filled. No need to reply.`, 'covered', 'Thanks!'));
    email(u, `${s.title} is filled`, [`${s.title} with ${s.home_name} on ${when(s)} filled before you answered, so there's nothing more to do. Thanks!`]);
  }
}

/**
 * The manager edited a service (`old` is how it was). Moved to a new day or time: everyone booked or asked is asked
 * (again) for the new time. Otherwise a change to the place, pay or notes is just passed on. A new title or headcount alone isn't.
 * Returns how many cleaners were told.
 */
export function serviceChanged(old, { moved, filledOut }) {
  const s = db.serviceById(old.id);
  filled(s, filledOut);
  const placeChanged = place(old) !== place(s);
  const changes = [
    ...(placeChanged ? [`now at ${place(s)}`] : []),
    ...(!placeChanged && (old.boat_details !== s.boat_details || old.owner_phone !== s.owner_phone) ? ['new boat details'] : []),
    ...(old.pay !== s.pay ? [s.pay ? `pay ${s.pay}` : 'no pay listed'] : []),
    ...(old.notes !== s.notes ? ['new notes'] : []),
  ];
  if (!moved && !changes.length) return 0;
  const crew = db.serviceCrew(s.id);
  for (const p of crew) {
    const u = db.userById(p.id);
    if (moved) {
      sms.send(u, `DockWash: ${s.home_name} moved ${s.title} to ${when(s)}${placeChanged ? `, now at ${place(s)}` : ''}. ${replyHint(u.id, db.requestFor(s.id, u.id).id, ['keep it', 'drop out'])}`);
      email(u, `${s.title} moved to ${when(s)}`, [`${s.home_name} moved ${s.title} from ${when(old)} to ${when(s)}. Can you still wash?`, '',
        ...details(s), '', `Accept or decline on DockWash${site() ? `: ${site()}/` : '.'}${u.sms_ok && u.phone_e164 ? ' Or just reply YES or NO to our text.' : ''}`,
        '', `${s.manager_name}, ${s.manager_phone}`]);
    } else {
      sms.send(u, `DockWash: ${s.title} with ${s.home_name} (${when(s)}) changed: ${changes.join('; ')}. Questions: ${s.manager_name} ${s.manager_phone}`);
      email(u, `${s.title} changed`, [`${s.home_name} updated ${s.title}:`, '', ...details(s), '', `Questions: ${s.manager_name}, ${s.manager_phone}.`]);
    }
  }
  return crew.length;
}

/** The manager withdrew a request or released a confirmed cleaner. */
export function withdrawn(serviceId, cleanerId, was) {
  const s = db.serviceById(serviceId);
  const u = db.userById(cleanerId);
  sms.send(u, was === 'accepted'
    ? `DockWash: ${s.home_name} released you from ${s.title} (${when(s)}). Sorry for the change. Questions: ${s.manager_name} ${s.manager_phone}`
    : `DockWash: ${s.home_name} no longer needs you for ${s.title} (${when(s)}). No need to reply.`);
  email(u, was === 'accepted' ? `You've been released from ${s.title}` : `${s.title}: request withdrawn`, [was === 'accepted'
    ? `${s.home_name} released you from ${s.title} on ${when(s)}. Sorry for the change. Questions: ${s.manager_name}, ${s.manager_phone}.`
    : `${s.home_name} no longer needs you for ${s.title} on ${when(s)}. Nothing more to do.`]);
}

/** The manager cancelled the service. */
export function cancelled(serviceId, affected) {
  const s = db.serviceById(serviceId);
  for (const a of affected) {
    const u = db.userById(a.cleaner_id);
    sms.send(u, `DockWash: ${s.home_name} cancelled ${s.title} (${when(s)}).${a.status === 'accepted' ? ' You’re no longer needed for it.' : ' No need to reply.'}`);
    email(u, `Cancelled: ${s.title}, ${when(s)}`, [`${s.home_name} cancelled ${s.title} on ${when(s)}.${a.status === 'accepted' ? ' You’re no longer needed for it.' : ''}`]);
  }
}

// ---- reminders and nudges (src/reminders.js decides when)

/** The evening before: a confirmed cleaner's reminder of where to be. */
export function reminder(requestId) {
  const r = db.requestById(requestId);
  const s = db.serviceById(r.service_id);
  const u = db.userById(r.cleaner_id);
  sms.send(u, `DockWash reminder: ${s.title} tomorrow ${prettyTime(s.time)} at ${place(s)}. ${s.home_name}: ${first(s.manager_name)} ${s.manager_phone}`);
  email(u, `Tomorrow: ${s.title}, ${when(s)}`, ['A reminder that you’re cleaning tomorrow:', '', ...details(s), '', `${s.manager_name}, ${s.manager_phone}`]);
}

/** A cleaner hasn't answered a request: one nudge. */
export function nudge(requestId) {
  const r = db.requestById(requestId);
  const s = db.serviceById(r.service_id);
  const u = db.userById(r.cleaner_id);
  sms.send(u, `DockWash: ${s.home_name} is still waiting to hear about ${s.title} (${when(s)}). ${replyHint(u.id, r.id)}`);
  email(u, `Still waiting: ${s.title}, ${when(s)}`, [`${s.home_name} is still waiting to hear if you can wash:`, '', ...details(s), '',
    `Accept or decline on DockWash${site() ? `: ${site()}/` : '.'}`]);
}

/** A service in the next couple of days still has open spots: tell the manager. */
export function managerNudge(s) {
  const d = db.userById(s.manager_id);
  const status = `still has ${s.needed - s.accepted} of ${s.needed} spots open, ${s.pending} waiting.`;
  const url = site() ? ` ${site()}/services/${s.id}` : '';
  sms.send(d, `DockWash: ${s.title} (${when(s)}) ${status}${url}`);
  email(d, `${s.title} ${status.replace(/\.$/, '')}`, [`${s.title} on ${when(s)} ${status}`,
    '', 'Request more cleaners, or call a few of your backup cleaners.', ...(url ? ['', url.trim()] : [])]);
}

const optInText = (user) => `DockWash: you’re signed up for ${user.role === 'manager' ? 'texts when cleaners answer your requests'
  : 'wash request texts'}. Msg frequency varies. Msg&data rates may apply. Reply HELP for help, STOP to opt out.`;

/** Someone turned texts on (signing up or in their profile): confirm it, as carriers expect. */
export function optedIn(userId) {
  const u = db.userById(userId);
  if (u?.sms_ok) sms.send(u, optInText(u));
}

/** A welcome email after signing up. */
export function welcome(userId) {
  const u = db.userById(userId);
  const refer = site() ? ['', `Know someone who'd use DockWash? Your referral code is ${u.referral_code}. Share your link:`,
    `${site()}/signup?ref=${u.referral_code}`, 'Everyone who joins with it counts as yours (see the Invite page).'] : [];
  email(u, 'Welcome to DockWash', (u.role === 'manager'
    ? ['Your DockWash account for ' + u.home_name + ' is ready.', '', 'Add your regulars from Find Cleaners (or invite them from the Invite tab),',
        'then book cleaners for a service in a couple of taps.', ...(site() ? ['', site()] : [])]
    : ['Your DockWash account is ready.', '', 'Mark the days you can wash on the Availability page. Marina managers see you on those days',
        'and send you requests, which you can accept on the site' + (u.sms_ok ? ' or by replying YES to our text.' : '.'), ...(site() ? ['', site()] : [])]
    .concat(quip('welcome') ? ['', quip('welcome')] : [])).concat(refer));
}

/** A "forgot password" link. Sent even if the person turned email notices off: they asked for it. */
export function passwordReset(user, link) {
  mail.send(user.email, 'Reset your DockWash password', [`Hi ${first(user.name)},`, '',
    'Someone (hopefully you) asked to reset your DockWash password. Choose a new one here:', '', link, '',
    'The link works once, for the next hour. If you didn’t ask for this, ignore this email; your password hasn’t changed.'].join('\n'));
}

// ---- replies people text in

/**
 * Handles one incoming text and returns the reply to send back ('' for none). `from` is E.164.
 */
export function incoming(from, body) {
  const user = db.userByPhone(from);
  db.logMessage({ user_id: user?.id, direction: 'in', phone: from, body: String(body).slice(0, 1600), status: 'received' });
  const [word = '', num] = String(body).trim().toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const reply = answer(user, word, num);
  if (reply && user) db.logMessage({ user_id: user.id, direction: 'out', phone: from, body: sms.plain(reply), status: sms.live() ? 'sent' : 'test' });
  return reply;
}

function answer(user, word, num) {
  if (!user) return `DockWash: we don’t know this number. Sign up or add it to your profile at${link() || ' DockWash'}.`;
  if (STOP_WORDS.includes(word)) {
    db.setSmsOk(user.id, false);
    return 'DockWash: you’re unsubscribed and won’t get any more texts. Reply START to resubscribe.';
  }
  if (START_WORDS.includes(word) || (!user.sms_ok && YES_WORDS.includes(word))) {
    db.setSmsOk(user.id, true);
    return optInText(user);
  }
  if (word === 'HELP' || word === 'INFO') return help();
  const yes = YES_WORDS.includes(word);
  if (!yes && !NO_WORDS.includes(word)) return help();
  if (user.role !== 'cleaner') return `DockWash: YES and NO are for cleaners answering requests. Manage your services at${link() || ' DockWash'}.`;

  const waiting = db.cleanerPending(user.id, localDay());
  if (!waiting.length) return 'DockWash: you don’t have any requests waiting for an answer right now.';
  let job;
  if (num) {
    job = waiting.find((j) => String(j.request_id) === num);
    if (!job) return `DockWash: there’s no open request ${num}. ${list(waiting)}`;
  } else if (waiting.length === 1) {
    job = waiting[0];
  } else {
    return `DockWash: you have ${waiting.length} requests waiting. ${list(waiting)}`;
  }

  const outcome = db.answerRequest(job.request_id, yes);
  answered(job.request_id, outcome);
  return {
    accepted: withQuip(`DockWash: you’re confirmed for ${job.title}, ${when(job)} at ${place(job)}. ${job.manager_name} ${job.manager_phone}.`, 'confirmed', `Thanks, ${first(user.name)}!`),
    declined: `DockWash: got it, you passed on ${job.title} (${when(job)}). Thanks for letting ${job.home_name} know.`,
    conflict: `DockWash: you already have a wash booked during this time. Ask the manager about another slot.`,
    full: `DockWash: sorry, every spot on ${job.title} just filled.`,
    gone: `DockWash: ${job.title} was already called off.`,
  }[outcome.result];
}

const list = (jobs) => jobs.map((j) => `Reply YES ${j.request_id} for ${j.title}, ${when(j)} (${j.home_name}).`).join(' ') + ' NO with the number passes.';
