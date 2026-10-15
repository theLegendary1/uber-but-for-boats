// Shared test setup: a fresh database in a temp folder, the real server on its own port, and logged-in clients.
// Each test file runs in its own process (node --test), so each gets its own database.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { after } from 'node:test';

const ROOT = join(import.meta.dirname, '..');
const dir = mkdtempSync(join(tmpdir(), 'dockwash-test-'));
process.env.DATA_DIR = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

/** src/db.js on this file's own database. Import it through here, so DATA_DIR is set first. */
export const db = await import('../src/db.js');
const { hashPassword } = await import('../src/passwords.js');
const hash = await hashPassword('dockwash123');

let n = 0;
/** A manager or cleaner with a working phone and texts on. */
export function makeUser(role, fields = {}) {
  n += 1;
  const name = fields.name || `${role === 'manager' ? 'Frank' : 'Cleaner'} Test${n}`;
  const id = db.createUser({ role, name, email: `${role}${n}@test.dockwash`, phone: `(347) 555-${String(1000 + n)}`, sms_ok: 1,
    password_hash: hash, home_name: role === 'manager' ? `Home ${n}` : '', area: 'Queens', ...fields });
  db.db.prepare('UPDATE users SET email_ok = 0 WHERE id = ?').run(id);   // no emails in the test log
  return db.userById(id);
}

/** A service `offset` days from today, straight into the database. */
export async function makeService(manager, fields = {}) {
  const { localDay } = await import('../src/dates.js');
  const id = db.createService({ manager_id: manager.id, title: 'Harbor wash', day: localDay(fields.offset ?? 3), time: '10:30',
    location: 'Harbor Marina', needed: 2, pay: '$75', notes: '', ...fields });
  return db.serviceById(id);
}

/** Every text DockWash sent this person, oldest first. */
export const textsTo = (userId) => db.db.prepare(`SELECT body FROM messages WHERE user_id = ? AND direction = 'out' ORDER BY id`)
  .all(userId).map((m) => m.body);
export const lastText = (userId) => textsTo(userId).at(-1);

/** The real server on a free port with this file's database. Stopped after the tests. */
export async function startServer() {
  const port = 41000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.js'],
    { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, PORT: String(port) }, stdio: ['ignore', 'ignore', 'inherit'] });
  after(() => child.kill());
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/health`)).ok) return base; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('server did not start');
}

/** A logged-in browser: get(path) and post(path, fields), with the session's csrf token added to every form. */
export async function login(base, user) {
  const res = await fetch(`${base}/login`, { method: 'POST', redirect: 'manual',
    body: new URLSearchParams({ email: user.email, password: 'dockwash123' }) });
  const sid = (res.headers.getSetCookie().find((c) => c.startsWith('dw_sid=')) || '').split(';')[0];
  if (!sid) throw new Error(`login failed for ${user.email}`);
  const csrf = db.sessionUser(sid.slice('dw_sid='.length)).csrf;
  const flashOf = (r) => decodeURIComponent((r.headers.getSetCookie().find((c) => c.startsWith('dw_flash=')) || '=').split(';')[0].split('=')[1]);
  return {
    async get(path) {
      const r = await fetch(`${base}${path}`, { headers: { cookie: sid }, redirect: 'manual' });
      return { status: r.status, html: await r.text() };
    },
    async post(path, fields = {}) {
      const r = await fetch(`${base}${path}`, { method: 'POST', headers: { cookie: sid }, redirect: 'manual',
        body: new URLSearchParams({ csrf, ...fields }) });
      return { status: r.status, location: r.headers.get('location'), flash: flashOf(r), html: await r.text() };
    },
  };
}
