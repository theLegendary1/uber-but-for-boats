// Reminders and nudges, run every few minutes: a day-before reminder to confirmed cleaners, one nudge to a cleaner who
// hasn't answered, and a heads-up to the manager while a service in the next two days still has open spots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDay } from '../src/dates.js';
import { db, makeUser, makeService, textsTo, lastText } from './helpers.js';

const { run } = await import('../src/reminders.js');
const today = localDay(0);
const manager = makeUser('manager', { name: 'Frank Russo', home_name: 'Harbor Marina', phone: '(718) 555-0100' });

async function withCleaners(fields, { confirmed = 0, waiting = 0 } = {}) {
  const s = await makeService(manager, { needed: 3, ...fields });
  const yes = Array.from({ length: confirmed }, () => makeUser('cleaner'));
  const maybe = Array.from({ length: waiting }, () => makeUser('cleaner'));
  for (const b of [...yes, ...maybe]) db.createRequest(s.id, b.id);
  for (const b of yes) db.answerRequest(db.requestFor(s.id, b.id).id, true);
  return { s, yes, maybe };
}
const ageRequests = (serviceId, hours) =>
  db.db.prepare(`UPDATE requests SET created_at = datetime('now', ?) WHERE service_id = ?`).run(`-${hours} hours`, serviceId);
const count = (userId, pattern) => textsTo(userId).filter((t) => pattern.test(t)).length;

test('confirmed cleaners get one reminder the evening before, from 5 PM', async () => {
  const { yes: [mike], maybe: [tony] } = await withCleaners({ offset: 1, boat_name: 'Sea Breeze' }, { confirmed: 1, waiting: 1 });
  run({ today, hour: 16 });
  assert.equal(count(mike.id, /reminder/), 0);
  run({ today, hour: 18 });
  run({ today, hour: 19 });
  assert.equal(count(mike.id, /reminder/), 1);
  assert.match(lastText(mike.id), /DockWash reminder: Harbor wash tomorrow 10:30 AM at Harbor Marina · Sea Breeze\. Harbor Marina: Frank \(718\) 555-0100/);
  assert.equal(count(tony.id, /DockWash reminder/), 0);   // still waiting: that's a nudge, not a reminder

  const called = await withCleaners({ offset: 1 }, { confirmed: 1 });
  db.cancelService(called.s.id);
  const dave = called.yes[0];
  run({ today, hour: 18 });
  assert.equal(count(dave.id, /reminder/), 0);
});

test('nothing goes out in quiet hours (before 8 AM, from 9 PM)', async () => {
  const { s, yes: [mike], maybe: [tony] } = await withCleaners({ offset: 1 }, { confirmed: 1, waiting: 1 });
  ageRequests(s.id, 6);
  const before = textsTo(manager.id).length;
  for (const hour of [0, 7, 21, 23]) run({ today, hour });
  assert.deepEqual([textsTo(mike.id).length, textsTo(tony.id).length, textsTo(manager.id).length], [0, 0, before]);
});

test('moving a service sends its reminder again for the new day', async () => {
  const { s, yes: [mike] } = await withCleaners({ offset: 1 }, { confirmed: 1 });
  run({ today, hour: 18 });
  db.updateService(s.id, { ...s, time: '14:00' });
  db.answerRequest(db.requestFor(s.id, mike.id).id, true);
  run({ today, hour: 18 });
  assert.equal(count(mike.id, /DockWash reminder/), 2);
});

test('a cleaner who hasn’t answered in 4 hours gets one nudge', async () => {
  const { s, maybe: [tony] } = await withCleaners({ offset: 4 }, { waiting: 1 });
  run({ today, hour: 12 });
  assert.equal(count(tony.id, /still waiting/), 0);
  ageRequests(s.id, 5);
  run({ today, hour: 12 });
  run({ today, hour: 13 });
  assert.equal(count(tony.id, /still waiting/), 1);
  assert.match(lastText(tony.id), /Harbor Marina is still waiting to hear about Harbor wash \(.*10:30 AM\)\. Reply YES to take it or NO to pass\./);

  // Asked again later: a new nudge is allowed.
  db.answerRequest(db.requestFor(s.id, tony.id).id, false);
  db.createRequest(s.id, tony.id);
  ageRequests(s.id, 5);
  run({ today, hour: 14 });
  assert.equal(count(tony.id, /still waiting/), 2);
});

test('no nudge once the service is filled or cancelled', async () => {
  const filled = await withCleaners({ offset: 4, needed: 1 }, { confirmed: 1 });
  const late = makeUser('cleaner');
  db.db.prepare(`INSERT INTO requests (service_id, cleaner_id) VALUES (?, ?)`).run(filled.s.id, late.id);   // left waiting on a full service
  const gone = await withCleaners({ offset: 4 }, { waiting: 1 });
  db.cancelService(gone.s.id);
  ageRequests(filled.s.id, 5);
  ageRequests(gone.s.id, 5);
  run({ today, hour: 12 });
  assert.equal(count(late.id, /still waiting/), 0);
  assert.equal(count(gone.maybe[0].id, /still waiting/), 0);
});

test('the manager hears once a day, two days and one day out, while spots are open', async () => {
  const { s } = await withCleaners({ offset: 2, title: 'Open service' }, { confirmed: 1, waiting: 1 });
  await withCleaners({ offset: 2, title: 'Full service', needed: 1 }, { confirmed: 1 });
  await withCleaners({ offset: 5, title: 'Far service' }, {});
  const heard = () => textsTo(manager.id).filter((t) => /still has/.test(t) && !/Harbor wash/.test(t));   // ignore the other tests' services

  run({ today, hour: 8 });
  assert.equal(heard().length, 0);   // from 9 AM
  run({ today, hour: 10 });
  run({ today, hour: 15 });
  assert.equal(heard().length, 1);
  assert.match(heard()[0], /Open service \(.*10:30 AM\) still has 2 of 3 spots open, 1 waiting\./);

  run({ today: localDay(1), hour: 10 });   // the next day, one day out
  assert.equal(heard().length, 2);

  db.cancelService(s.id);
  run({ today: localDay(2), hour: 10 });   // the day itself: not nudged, and it's cancelled anyway
  assert.equal(heard().length, 2);
});
