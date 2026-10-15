// Every query DockWash runs. SQLite through Node's built-in node:sqlite, so there's nothing to npm install.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { toE164 } from './phone.js';

export const DATA_DIR = process.env.DATA_DIR || join(import.meta.dirname, '..', 'data');
mkdirSync(DATA_DIR, { recursive: true });
export const db = new DatabaseSync(join(DATA_DIR, 'dockwash.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('cleaner', 'manager')),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  home_name TEXT NOT NULL DEFAULT '',   -- managers: the marina
  area TEXT NOT NULL DEFAULT '',        -- cleaners: where they'll travel
  bio TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Days a cleaner can wash.
CREATE TABLE IF NOT EXISTS availability (
  cleaner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,                    -- YYYY-MM-DD
  PRIMARY KEY (cleaner_id, day)
);

-- A manager's lists: their regular guys, and backup cleaners they know for when they're in a jam.
CREATE TABLE IF NOT EXISTS crew (
  manager_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cleaner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier TEXT NOT NULL CHECK (tier IN ('regular', 'outside')),
  PRIMARY KEY (manager_id, cleaner_id)
);

-- What a manager keeps on a cleaner, for their eyes only: a 1-5 star rating (or none) and a note.
CREATE TABLE IF NOT EXISTS cleaner_notes (
  manager_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cleaner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (manager_id, cleaner_id)
);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY,
  manager_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,                  -- e.g. "Smith service"
  day TEXT NOT NULL,
  time TEXT NOT NULL,
  location TEXT NOT NULL,
  needed INTEGER NOT NULL CHECK (needed BETWEEN 1 AND 12),
  pay TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  cancelled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A manager asking a cleaner to wash. Pending until the cleaner answers; cancelled once the spots fill.
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  cleaner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  responded_at TEXT,
  UNIQUE (service_id, cleaner_id)
);

-- A personal sign-up link someone texted out. Signing up through it skips the invite code and,
-- from a manager, puts the new cleaner straight onto their regulars or backup cleaners. Single use.
CREATE TABLE IF NOT EXISTS invites (
  token TEXT PRIMARY KEY,
  inviter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('cleaner', 'manager')),
  tier TEXT CHECK (tier IN ('regular', 'outside')),
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  used_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- Every text in and out (in test mode, the texts DockWash would have sent).
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('out', 'in')),
  phone TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL,                 -- out: test, sent, failed, skipped; in: received
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS messages_user ON messages (user_id, id);

-- "Forgot password" links. Only a hash of the token is kept, so a copy of the database can't reset anyone's password.
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
`);

// Columns added after the first release. SQLite has no ADD COLUMN IF NOT EXISTS, so check first.
const userColumns = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!userColumns.includes('phone_e164')) {
  db.exec(`ALTER TABLE users ADD COLUMN phone_e164 TEXT NOT NULL DEFAULT ''`);   // the phone as +15165550199, to match incoming texts
  for (const u of db.prepare('SELECT id, phone FROM users').all()) {
    db.prepare('UPDATE users SET phone_e164 = ? WHERE id = ?').run(toE164(u.phone), u.id);
  }
}
if (!userColumns.includes('sms_ok')) db.exec('ALTER TABLE users ADD COLUMN sms_ok INTEGER NOT NULL DEFAULT 1');   // 0 after STOP
if (!userColumns.includes('email_ok')) db.exec('ALTER TABLE users ADD COLUMN email_ok INTEGER NOT NULL DEFAULT 1');   // email notices
if (!userColumns.includes('google_sub')) db.exec('ALTER TABLE users ADD COLUMN google_sub TEXT');   // Google account id, once linked
// Referrals: everyone has a code to share, and each account remembers who brought it in and how
// ('code' typed in, 'link' a share link, 'invite' a personal invite, 'legacy' the old shared sign-up code).
if (!userColumns.includes('referral_code')) db.exec('ALTER TABLE users ADD COLUMN referral_code TEXT');
if (!userColumns.includes('referred_by')) db.exec('ALTER TABLE users ADD COLUMN referred_by INTEGER REFERENCES users(id) ON DELETE SET NULL');
if (!userColumns.includes('referral_via')) db.exec('ALTER TABLE users ADD COLUMN referral_via TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_referral ON users (referral_code) WHERE referral_code IS NOT NULL');
for (const u of db.prepare('SELECT id, name FROM users WHERE referral_code IS NULL').all()) {
  db.prepare('UPDATE users SET referral_code = ? WHERE id = ?').run(newReferralCode(u.name), u.id);
}
// A service's location is the church (or wherever the service is); the boat_name, if there is one, has its own fields.
const serviceColumns = db.prepare('PRAGMA table_info(services)').all().map((c) => c.name);
for (const col of ['boat_name', 'boat_details', 'owner_phone']) {
  if (!serviceColumns.includes(col)) db.exec(`ALTER TABLE services ADD COLUMN ${col} TEXT NOT NULL DEFAULT ''`);
}
if (!serviceColumns.includes('duration_minutes')) db.exec('ALTER TABLE services ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 120');
if (!serviceColumns.includes('manager_nudged_on')) db.exec('ALTER TABLE services ADD COLUMN manager_nudged_on TEXT');   // last day the manager heard spots are open
// When the day-before reminder and the one nudge to answer went out; cleared whenever the cleaner is asked again.
const requestColumns = db.prepare('PRAGMA table_info(requests)').all().map((c) => c.name);
for (const col of ['reminded_at', 'nudged_at']) if (!requestColumns.includes(col)) db.exec(`ALTER TABLE requests ADD COLUMN ${col} TEXT`);
db.exec('CREATE INDEX IF NOT EXISTS users_phone ON users (phone_e164)');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_google ON users (google_sub) WHERE google_sub IS NOT NULL');

const q = (sql) => db.prepare(sql);

/** A referral code: the first name and three characters that can't be misread (no 0/O, 1/I), e.g. FRANK7K2. */
function newReferralCode(name) {
  const base = (String(name).split(/\s+/)[0] || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8) || 'PALL';
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) {
    const code = base + Array.from({ length: 3 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    if (!db.prepare('SELECT 1 FROM users WHERE referral_code = ?').get(code)) return code;
  }
}
/** Codes match however they're typed: "frank-7k2" = FRANK7K2. */
export const referralKey = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// ---- users & sessions
export const createUser = (u) => q(`INSERT INTO users (role, name, email, phone, phone_e164, sms_ok, password_hash, home_name, area, bio, google_sub,
    referral_code, referred_by, referral_via)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(u.role, u.name, u.email, u.phone, toE164(u.phone), u.sms_ok ?? 1, u.password_hash,
  u.home_name || '', u.area || '', u.bio || '', u.google_sub ?? null, newReferralCode(u.name), u.referred_by ?? null, u.referral_via ?? null).lastInsertRowid;
export const userByReferral = (code) => { const k = referralKey(code); return k ? q('SELECT * FROM users WHERE referral_code = ?').get(k) : undefined; };
export const userByGoogle = (sub) => q('SELECT * FROM users WHERE google_sub = ?').get(sub);
export const linkGoogle = (id, sub) => q('UPDATE users SET google_sub = ? WHERE id = ?').run(sub, id);
export const userByEmail = (email) => q('SELECT * FROM users WHERE email = ?').get(email);
export const userById = (id) => q('SELECT * FROM users WHERE id = ?').get(id);
export const updateProfile = (id, p) => q(`UPDATE users SET name = ?, phone = ?, phone_e164 = ?, sms_ok = ?, email_ok = ?, home_name = ?, area = ?, bio = ?
  WHERE id = ?`).run(p.name, p.phone, toE164(p.phone), p.sms_ok, p.email_ok, p.home_name, p.area, p.bio, id);
export const setPassword = (id, hash) => {
  q('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
  q('DELETE FROM sessions WHERE user_id = ?').run(id);   // log out everywhere, in case someone else had the old password
};
/** Who sent a text: a cleaner if two accounts share the number, since only cleaners answer by text. */
export const userByPhone = (e164) => e164 ? q(`SELECT * FROM users WHERE phone_e164 = ? ORDER BY role = 'cleaner' DESC, id LIMIT 1`).get(e164) : undefined;
export const setSmsOk = (id, ok) => q('UPDATE users SET sms_ok = ? WHERE id = ?').run(ok ? 1 : 0, id);

export const createSession = (token, userId, csrf, expiresAt) =>
  q('INSERT INTO sessions (token, user_id, csrf, expires_at) VALUES (?, ?, ?, ?)').run(token, userId, csrf, expiresAt);
export const sessionUser = (token) => q(`SELECT u.*, s.csrf FROM sessions s JOIN users u ON u.id = s.user_id
  WHERE s.token = ? AND s.expires_at > ?`).get(token, Date.now());
export const deleteSession = (token) => q('DELETE FROM sessions WHERE token = ?').run(token);
export const pruneSessions = () => q('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());

// ---- availability
export const availableDays = (cleanerId, from, to) =>
  q('SELECT day FROM availability WHERE cleaner_id = ? AND day BETWEEN ? AND ?').all(cleanerId, from, to).map((r) => r.day);
export function setAvailability(cleanerId, from, to, days) {
  db.exec('BEGIN');
  try {
    q('DELETE FROM availability WHERE cleaner_id = ? AND day BETWEEN ? AND ?').run(cleanerId, from, to);
    const add = q('INSERT INTO availability (cleaner_id, day) VALUES (?, ?)');
    for (const d of days) if (d >= from && d <= to) add.run(cleanerId, d);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// ---- crew lists
/** The manager's own rating and note for each cleaner (u), joined in wherever cleaners are listed. */
const NOTES = 'LEFT JOIN cleaner_notes n ON n.cleaner_id = u.id AND n.manager_id = ?';
export const crewList = (managerId, tier) => q(`SELECT u.*, n.rating, n.note FROM crew c JOIN users u ON u.id = c.cleaner_id ${NOTES}
  WHERE c.manager_id = ? AND c.tier = ? ORDER BY u.name`).all(managerId, managerId, tier);
export const setCrew = (managerId, cleanerId, tier) => q(`INSERT INTO crew (manager_id, cleaner_id, tier) VALUES (?, ?, ?)
  ON CONFLICT (manager_id, cleaner_id) DO UPDATE SET tier = excluded.tier`).run(managerId, cleanerId, tier);
export const removeCrew = (managerId, cleanerId) => q('DELETE FROM crew WHERE manager_id = ? AND cleaner_id = ?').run(managerId, cleanerId);
/** Every cleaner, with the manager's tier for them (or null) and how many washes they've done in total. */
export const allCleaners = (managerId) => q(`SELECT u.*, c.tier, n.rating, n.note,
    (SELECT COUNT(*) FROM requests r JOIN services s ON s.id = r.service_id WHERE r.cleaner_id = u.id AND r.status = 'accepted' AND s.cancelled = 0) AS washes
  FROM users u LEFT JOIN crew c ON c.cleaner_id = u.id AND c.manager_id = ? ${NOTES}
  WHERE u.role = 'cleaner' ORDER BY u.name`).all(managerId, managerId);

// ---- what a manager keeps on each cleaner
export const saveNote = (managerId, cleanerId, rating, note) => q(`INSERT INTO cleaner_notes (manager_id, cleaner_id, rating, note) VALUES (?, ?, ?, ?)
  ON CONFLICT (manager_id, cleaner_id) DO UPDATE SET rating = excluded.rating, note = excluded.note, updated_at = datetime('now')`)
  .run(managerId, cleanerId, rating, note);
/** One cleaner as this manager sees them: their tier, and the manager's rating and note. Undefined if not a cleaner. */
export const cleanerProfile = (managerId, cleanerId) => q(`SELECT u.*, c.tier, n.rating, n.note FROM users u
  LEFT JOIN crew c ON c.cleaner_id = u.id AND c.manager_id = ? ${NOTES} WHERE u.id = ? AND u.role = 'cleaner'`).get(managerId, managerId, cleanerId);
/** A cleaner's washes with this home that went ahead (newest first), how many, the last one, and how many requests they declined. */
export function historyWithHome(managerId, cleanerId) {
  const services = q(`SELECT s.* FROM requests r JOIN services s ON s.id = r.service_id
    WHERE s.manager_id = ? AND r.cleaner_id = ? AND r.status = 'accepted' AND s.cancelled = 0 ORDER BY s.day DESC, s.time DESC`).all(managerId, cleanerId);
  const { declined } = q(`SELECT COUNT(*) AS declined FROM requests r JOIN services s ON s.id = r.service_id
    WHERE s.manager_id = ? AND r.cleaner_id = ? AND r.status = 'declined'`).get(managerId, cleanerId);
  return { services: services.slice(0, 20), washes: services.length, last_day: services[0]?.day ?? null, declined };
}

// ---- services
export const createService = (s) => q(`INSERT INTO services (manager_id, title, day, time, location, needed, pay, notes,
    boat_name, boat_details, owner_phone, duration_minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(s.manager_id, s.title, s.day, s.time,
  s.location, s.needed, s.pay, s.notes, s.boat_name || '', s.boat_details || '', s.owner_phone || '', s.duration_minutes ?? 120).lastInsertRowid;
export const serviceById = (id) => q(`SELECT s.*, u.home_name, u.name AS manager_name, u.phone AS manager_phone
  FROM services s JOIN users u ON u.id = s.manager_id WHERE s.id = ?`).get(id);
/** Cancels a service; returns the requests it called off ({ cleaner_id, status }), to let those cleaners know. */
export const cancelService = (id) => {
  const affected = q(`SELECT cleaner_id, status FROM requests WHERE service_id = ? AND status IN ('pending', 'accepted')`).all(id);
  q('UPDATE services SET cancelled = 1 WHERE id = ?').run(id);
  q(`UPDATE requests SET status = 'cancelled', responded_at = datetime('now')
    WHERE service_id = ? AND status IN ('pending', 'accepted')`).run(id);
  return affected;
};
/**
 * Saves an edited service. Moving the day or time puts confirmed cleaners back to waiting, to ask them again; otherwise,
 * needing only as many as are confirmed calls off the requests still waiting. Returns { ok: false, accepted } if it
 * would need fewer than are confirmed, else { ok: true, moved, filledOut: cleaner ids whose request was called off }.
 */
export function updateService(id, s) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const old = serviceById(id);
    const accepted = acceptedCount(id);
    if (s.needed < accepted) { db.exec('ROLLBACK'); return { ok: false, accepted }; }
    q(`UPDATE services SET title = ?, day = ?, time = ?, location = ?, needed = ?, pay = ?, notes = ?, boat_name = ?, boat_details = ?,
      owner_phone = ?, duration_minutes = ? WHERE id = ?`).run(s.title, s.day, s.time, s.location, s.needed, s.pay, s.notes, s.boat_name, s.boat_details,
      s.owner_phone, s.duration_minutes ?? 120, id);
    const moved = old.day !== s.day || old.time !== s.time || old.duration_minutes !== (s.duration_minutes ?? 120);
    let filledOut = [];
    if (moved) {
      q(`UPDATE requests SET status = 'pending', created_at = datetime('now'), responded_at = NULL, reminded_at = NULL, nudged_at = NULL
        WHERE service_id = ? AND status IN ('accepted', 'pending')`).run(id);
    } else if (accepted >= s.needed) {
      filledOut = q(`SELECT cleaner_id FROM requests WHERE service_id = ? AND status = 'pending'`).all(id).map((x) => x.cleaner_id);
      q(`UPDATE requests SET status = 'cancelled', responded_at = datetime('now') WHERE service_id = ? AND status = 'pending'`).run(id);
    }
    db.exec('COMMIT');
    return { ok: true, moved, filledOut };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
const SERVICE_COUNTS =`(SELECT COUNT(*) FROM requests r WHERE r.service_id = s.id AND r.status = 'accepted') AS accepted,
  (SELECT COUNT(*) FROM requests r WHERE r.service_id = s.id AND r.status = 'pending') AS pending`;
export const managerServices = (managerId, today) => q(`SELECT s.*, ${SERVICE_COUNTS} FROM services s
  WHERE s.manager_id = ? AND s.day >= ? ORDER BY s.day, s.time`).all(managerId, today);
export const pastServices = (managerId, today) => q(`SELECT s.*, ${SERVICE_COUNTS} FROM services s
  WHERE s.manager_id = ? AND s.day < ? ORDER BY s.day DESC, s.time DESC LIMIT 20`).all(managerId, today);
export const acceptedCount = (serviceId) =>
  q(`SELECT COUNT(*) AS n FROM requests WHERE service_id = ? AND status = 'accepted'`).get(serviceId).n;

/**
 * Every cleaner for one service's day: whether they're available, already cleaning elsewhere that day,
 * the manager's tier for them, and where this service's request to them stands.
 */
export const candidates = (serviceId) => q(`SELECT u.id, u.name, u.phone, u.area, u.bio, c.tier, n.rating, n.note,
    EXISTS (SELECT 1 FROM availability a WHERE a.cleaner_id = u.id AND a.day = s.day) AS available,
    (SELECT group_concat(o.time || ' ' || h.home_name, ', ') FROM requests r2 JOIN services o ON o.id = r2.service_id
       JOIN users h ON h.id = o.manager_id
     WHERE r2.cleaner_id = u.id AND r2.status = 'accepted' AND o.day = s.day AND o.id != s.id AND o.cancelled = 0 AND (CAST(substr(o.time, 1, 2) AS INTEGER) * 60 + CAST(substr(o.time, 4, 2) AS INTEGER)) < (CAST(substr(s.time, 1, 2) AS INTEGER) * 60 + CAST(substr(s.time, 4, 2) AS INTEGER)) + s.duration_minutes AND (CAST(substr(s.time, 1, 2) AS INTEGER) * 60 + CAST(substr(s.time, 4, 2) AS INTEGER)) < (CAST(substr(o.time, 1, 2) AS INTEGER) * 60 + CAST(substr(o.time, 4, 2) AS INTEGER)) + o.duration_minutes) AS booked_elsewhere,
    r.status AS request_status
  FROM services s JOIN users u ON u.role = 'cleaner'
  LEFT JOIN crew c ON c.manager_id = s.manager_id AND c.cleaner_id = u.id
  LEFT JOIN cleaner_notes n ON n.manager_id = s.manager_id AND n.cleaner_id = u.id
  LEFT JOIN requests r ON r.service_id = s.id AND r.cleaner_id = u.id
  WHERE s.id = ? ORDER BY u.name`).all(serviceId);

// ---- requests
/** Asks a cleaner; true if that's a new ask (not one already waiting or accepted). */
export const createRequest = (serviceId, cleanerId) => q(`INSERT INTO requests (service_id, cleaner_id) VALUES (?, ?)
  ON CONFLICT (service_id, cleaner_id) DO UPDATE SET status = 'pending', created_at = datetime('now'), responded_at = NULL,
    reminded_at = NULL, nudged_at = NULL
  WHERE status IN ('declined', 'cancelled')`).run(serviceId, cleanerId).changes === 1;
export const requestFor = (serviceId, cleanerId) => q('SELECT * FROM requests WHERE service_id = ? AND cleaner_id = ?').get(serviceId, cleanerId);
/** Calls off a cleaner's request; returns what it was ('pending' or 'accepted'), or null if there was nothing to call off. */
export function withdrawRequest(serviceId, cleanerId) {
  const r = requestFor(serviceId, cleanerId);
  if (!r || !['pending', 'accepted'].includes(r.status)) return null;
  q(`UPDATE requests SET status = 'cancelled', responded_at = datetime('now') WHERE id = ?`).run(r.id);
  return r.status;
}
export const requestById = (id) => q('SELECT * FROM requests WHERE id = ?').get(id);

/**
 * The cleaner answers: { result: accepted | declined | full | gone, filledOut: cleaner ids still waiting when the last spot filled }.
 * Accepting the last open spot cancels everyone else's pending request.
 */
export function answerRequest(id, accept) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = requestById(id);
    const s = serviceById(r.service_id);
    if (r.status !== 'pending' || s.cancelled) { db.exec('ROLLBACK'); return { result: 'gone', filledOut: [] }; }
    if (accept && q(`SELECT 1 FROM requests other JOIN services o ON o.id = other.service_id
      JOIN services s ON s.id = ? WHERE other.cleaner_id = ? AND other.status = 'accepted'
      AND o.id != s.id AND o.day = s.day AND o.cancelled = 0 AND (CAST(substr(o.time, 1, 2) AS INTEGER) * 60 + CAST(substr(o.time, 4, 2) AS INTEGER)) < (CAST(substr(s.time, 1, 2) AS INTEGER) * 60 + CAST(substr(s.time, 4, 2) AS INTEGER)) + s.duration_minutes AND (CAST(substr(s.time, 1, 2) AS INTEGER) * 60 + CAST(substr(s.time, 4, 2) AS INTEGER)) < (CAST(substr(o.time, 1, 2) AS INTEGER) * 60 + CAST(substr(o.time, 4, 2) AS INTEGER)) + o.duration_minutes LIMIT 1`).get(s.id, r.cleaner_id)) {
      db.exec('ROLLBACK'); return { result: 'conflict', filledOut: [] };
    }
    if (accept && acceptedCount(s.id) >= s.needed) { db.exec('ROLLBACK'); return { result: 'full', filledOut: [] }; }
    q(`UPDATE requests SET status = ?, responded_at = datetime('now') WHERE id = ?`).run(accept ? 'accepted' : 'declined', id);
    let filledOut = [];
    if (accept && acceptedCount(s.id) >= s.needed) {
      filledOut = q(`SELECT cleaner_id FROM requests WHERE service_id = ? AND status = 'pending'`).all(s.id).map((x) => x.cleaner_id);
      q(`UPDATE requests SET status = 'cancelled', responded_at = datetime('now') WHERE service_id = ? AND status = 'pending'`).run(s.id);
    }
    db.exec('COMMIT');
    return { result: accept ? 'accepted' : 'declined', filledOut };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// ---- reminders and nudges (src/reminders.js)
/** Confirmed cleaners on `day`'s services who haven't had their reminder. */
export const dueReminders = (day) => q(`SELECT r.id AS request_id, r.cleaner_id, r.service_id FROM requests r JOIN services s ON s.id = r.service_id
  WHERE s.day = ? AND s.cancelled = 0 AND r.status = 'accepted' AND r.reminded_at IS NULL`).all(day);
/** Requests left unanswered for `hours`, not nudged yet, on services from `today` on that still have open spots. */
export const dueNudges = (today, hours) => q(`SELECT r.id AS request_id, r.cleaner_id, r.service_id FROM requests r JOIN services s ON s.id = r.service_id
  WHERE r.status = 'pending' AND r.nudged_at IS NULL AND r.created_at <= datetime('now', ?) AND s.day >= ? AND s.cancelled = 0
    AND (SELECT COUNT(*) FROM requests x WHERE x.service_id = s.id AND x.status = 'accepted') < s.needed`).all(`-${hours} hours`, today);
/** Services on these days with open spots whose manager hasn't heard about them yet `today`. */
export const openServicesToNudge = (days, today) => q(`SELECT s.*, ${SERVICE_COUNTS} FROM services s
  WHERE s.day IN (SELECT value FROM json_each(?)) AND s.cancelled = 0 AND (s.manager_nudged_on IS NULL OR s.manager_nudged_on != ?)
    AND (SELECT COUNT(*) FROM requests r WHERE r.service_id = s.id AND r.status = 'accepted') < s.needed`).all(JSON.stringify(days), today);
export const markReminded = (requestId) => q(`UPDATE requests SET reminded_at = datetime('now') WHERE id = ?`).run(requestId);
export const markNudged = (requestId) => q(`UPDATE requests SET nudged_at = datetime('now') WHERE id = ?`).run(requestId);
export const markManagerNudged = (serviceId, today) => q('UPDATE services SET manager_nudged_on = ? WHERE id = ?').run(today, serviceId);

export const serviceCrew = (serviceId) => q(`SELECT u.id, u.name, u.phone, r.status FROM requests r JOIN users u ON u.id = r.cleaner_id
  WHERE r.service_id = ? AND r.status IN ('pending', 'accepted') ORDER BY r.status, u.name`).all(serviceId);

const CLEANER_JOBS = `SELECT r.id AS request_id, r.status, s.*, u.home_name, u.name AS manager_name, u.phone AS manager_phone,
    (SELECT COUNT(*) FROM requests x WHERE x.service_id = s.id AND x.status = 'accepted') AS accepted
  FROM requests r JOIN services s ON s.id = r.service_id JOIN users u ON u.id = s.manager_id`;
export const cleanerPending = (cleanerId, today) => q(`${CLEANER_JOBS}
  WHERE r.cleaner_id = ? AND r.status = 'pending' AND s.day >= ? AND s.cancelled = 0 ORDER BY s.day, s.time`).all(cleanerId, today);
export const cleanerUpcoming = (cleanerId, today) => q(`${CLEANER_JOBS}
  WHERE r.cleaner_id = ? AND r.status = 'accepted' AND s.day >= ? ORDER BY s.day, s.time`).all(cleanerId, today);
/** Recent changes the cleaner should hear about: cancelled washes and spots that filled before they answered. */
export const cleanerRecentCancelled = (cleanerId, today) => q(`${CLEANER_JOBS}
  WHERE r.cleaner_id = ? AND r.status = 'cancelled' AND s.day >= ? AND r.responded_at >= datetime('now', '-3 days')
  ORDER BY s.day, s.time`).all(cleanerId, today);
export const cleanerWashCount = (cleanerId) => q(`SELECT COUNT(*) AS n FROM requests r JOIN services s ON s.id = r.service_id
  WHERE r.cleaner_id = ? AND r.status = 'accepted' AND s.cancelled = 0`).get(cleanerId).n;

// ---- invites
export const createInvite = (i) => q(`INSERT INTO invites (token, inviter_id, role, tier, name, phone) VALUES (?, ?, ?, ?, ?, ?)`)
  .run(i.token, i.inviter_id, i.role, i.tier, i.name, i.phone);
/** An invite that hasn't been used yet, with who sent it. */
export const openInvite = (token) => q(`SELECT i.*, u.name AS inviter_name, u.home_name AS inviter_home FROM invites i
  JOIN users u ON u.id = i.inviter_id WHERE i.token = ? AND i.used_by IS NULL`).get(token);
export const inviteByToken = (token) => q('SELECT * FROM invites WHERE token = ?').get(token);
export const useInvite = (token, userId) => q('UPDATE invites SET used_by = ? WHERE token = ? AND used_by IS NULL').run(userId, token).changes === 1;
export const sentInvites = (inviterId) => q(`SELECT i.*, u.name AS joined_name FROM invites i LEFT JOIN users u ON u.id = i.used_by
  WHERE i.inviter_id = ? ORDER BY i.created_at DESC LIMIT 30`).all(inviterId);

// ---- texts
export const logMessage = (m) => q(`INSERT INTO messages (user_id, direction, phone, body, status, error) VALUES (?, ?, ?, ?, ?, ?)`)
  .run(m.user_id ?? null, m.direction, m.phone, m.body, m.status, m.error ?? null).lastInsertRowid;
export const setMessageStatus = (id, status, error = null) => q('UPDATE messages SET status = ?, error = ? WHERE id = ?').run(status, error, id);
export const userMessages = (userId) => q('SELECT * FROM messages WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(userId);

// ---- password resets
export const createReset = (tokenHash, userId, expiresAt) =>
  q('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash, userId, expiresAt);
export const openReset = (tokenHash) => q('SELECT * FROM password_resets WHERE token_hash = ? AND used = 0 AND expires_at > ?').get(tokenHash, Date.now());
export const useReset = (tokenHash) => q('UPDATE password_resets SET used = 1 WHERE token_hash = ? AND used = 0').run(tokenHash).changes === 1;
export const recentResets = (userId) => q('SELECT COUNT(*) AS n FROM password_resets WHERE user_id = ? AND expires_at > ?')
  .get(userId, Date.now()).n;   // links still open: at most a few per hour

// ---- referrals
/** Someone counts as active once they've used DockWash for real: a cleaner booked on a wash, a manager with a cleaner booked. */
const ACTIVE = `CASE WHEN u.role = 'cleaner'
    THEN EXISTS (SELECT 1 FROM requests r JOIN services s ON s.id = r.service_id WHERE r.cleaner_id = u.id AND r.status = 'accepted' AND s.cancelled = 0)
    ELSE EXISTS (SELECT 1 FROM services s JOIN requests r ON r.service_id = s.id WHERE s.manager_id = u.id AND r.status = 'accepted' AND s.cancelled = 0)
  END`;
export const referralsOf = (userId) => q(`SELECT u.id, u.name, u.role, u.home_name, u.created_at, u.referral_via, ${ACTIVE} AS active
  FROM users u WHERE u.referred_by = ? ORDER BY u.id DESC`).all(userId);
/** Everyone who has brought someone in, most first. */
export const referralLeaderboard = () => q(`SELECT p.id, p.name, p.role, p.email, p.home_name, p.referral_code,
    COUNT(*) AS brought, SUM(${ACTIVE}) AS active, MAX(u.created_at) AS last_at
  FROM users u JOIN users p ON p.id = u.referred_by GROUP BY p.id ORDER BY brought DESC, active DESC, last_at DESC`).all();
export const recentSignups = () => q(`SELECT u.id, u.name, u.role, u.email, u.home_name, u.created_at, u.referral_via, ${ACTIVE} AS active,
    p.name AS referrer_name FROM users u LEFT JOIN users p ON p.id = u.referred_by ORDER BY u.id DESC LIMIT 50`).all();
export const referralTotals = () => q(`SELECT COUNT(*) AS users, SUM(referred_by IS NOT NULL) AS referred,
    SUM(role = 'cleaner') AS cleaners, SUM(role = 'manager') AS managers FROM users`).get();
