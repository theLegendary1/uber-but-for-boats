// Demo data: one marina, nine cleaners with availability, and a service half-booked.
// Run: node src/seed.js   (on the NAS: ./deploy.sh --seed). Does nothing if the demo manager already exists.
import * as db from './db.js';
import { hashPassword } from './passwords.js';
import { localDay } from './dates.js';

const PASSWORD = 'dockwash123';
if (db.userByEmail('manager@demo.dockwash')) {
  console.log('Demo data is already there.');
  process.exit(0);
}

const day = localDay;
const hash = await hashPassword(PASSWORD);

const manager = db.createUser({ role: 'manager', name: 'Alex Morgan', email: 'manager@demo.dockwash', phone: '(718) 555-0100',
  password_hash: hash, home_name: 'Harbor Point Marina' });

const cleaners = [
  ['Mike Brennan', 'Queens, Brooklyn', 'Five years of boat detailing. Own wash equipment.', 'regular', 'weekdays'],
  ['Tony Esposito', 'Queens, Nassau', 'Exterior wash and wax. Own transport.', 'regular', 'all'],
  ['Dave Kowalski', 'Brooklyn', 'Teak care and fiberglass polishing.', 'regular', 'weekdays'],
  ['Luis Ortega', 'Bronx, Manhattan', '', 'regular', 'odd'],
  ['Sean Murphy', 'Queens', 'Can bring a second cleaner for larger boats.', 'regular', 'weekends'],
  ['Ray Jackson', 'Nassau, Suffolk', 'Interior detailing and salt removal.', 'outside', 'all'],
  ['Pete Novak', 'Staten Island', '', 'outside', 'even'],
  ['Marcus Bell', 'Brooklyn, Queens', 'Weekends only.', null, 'weekends'],
  ['Jimmy Walsh', 'Queens', 'New to boat cleaning, reliable and on time.', null, 'all'],
].map(([name, area, bio, tier, pattern], i) => {
  const id = db.createUser({ role: 'cleaner', name, email: `${name.split(' ')[0].toLowerCase()}@demo.dockwash`,
    phone: `(347) 555-01${String(10 + i)}`, password_hash: hash, area, bio });
  if (tier) db.setCrew(manager, id, tier);
  const days = Array.from({ length: 42 }, (_, n) => day(n)).filter((d, n) => {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    return { all: true, weekdays: dow > 0 && dow < 6, weekends: dow === 0 || dow === 6, odd: n % 2 === 1, even: n % 2 === 0 }[pattern];
  });
  db.setAvailability(id, day(0), day(41), days);
  return id;
});

// The demo addresses don't exist, so no emails (they'd bounce back to the support inbox once email is live).
db.db.prepare(`UPDATE users SET email_ok = 0 WHERE email LIKE '%@demo.dockwash'`).run();

// A service two days out: two regulars confirmed, one waiting to answer.
const service = db.createService({ manager_id: manager, title: 'Sea Breeze · exterior wash', day: day(2), time: '10:30',
  location: 'Harbor Point Marina · Dock B · Slip 12', boat_name: 'Sea Breeze',
  boat_details: '32 ft Sea Ray · fiberglass · exterior wash', owner_phone: '(718) 786-8000', needed: 3, pay: '$90 per cleaner', notes: 'Fresh water at slip. Bring marine-safe soap. Rinse deck and hull; avoid teak with pressure washer.' });
for (const b of cleaners.slice(0, 3)) db.createRequest(service, b);
const asked = db.candidates(service);
for (const p of asked.filter((p) => p.request_status === 'pending').slice(0, 2)) {
  db.answerRequest(db.db.prepare('SELECT id FROM requests WHERE service_id = ? AND cleaner_id = ?').get(service, p.id).id, true);
}

console.log(`Demo data added. Log in with password "${PASSWORD}" as:
  manager@demo.dockwash   (Alex, the marina manager)
  mike@demo.dockwash       (a regular cleaner; also tony@, dave@, luis@, sean@, ray@, pete@, marcus@, jimmy@)`);
