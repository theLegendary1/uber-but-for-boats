// A manager edits a service after posting it. Moving the date or time asks confirmed cleaners again;
// other changes just let everyone booked or asked know.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDay } from '../src/dates.js';
import { db, makeUser, makeService, startServer, login, lastText, textsTo } from './helpers.js';

const base = await startServer();
const manager = makeUser('manager');
const frank = await login(base, manager);
const { incoming } = await import('../src/notify.js');

/** A service with `confirmed` cleaners who said yes and `waiting` who haven't answered. */
async function booked({ confirmed = 1, waiting = 0, ...fields } = {}) {
  const s = await makeService(manager, { needed: 3, ...fields });
  const people = (n) => Array.from({ length: n }, () => makeUser('cleaner'));
  const yes = people(confirmed);
  const maybe = people(waiting);
  for (const b of [...yes, ...maybe]) db.createRequest(s.id, b.id);
  for (const b of yes) db.answerRequest(db.requestFor(s.id, b.id).id, true);
  return { s, yes, maybe };
}
const formOf = (s, changes = {}) => ({ title: s.title, day: s.day, time: s.time, needed: String(s.needed), location: s.location,
  pay: s.pay, notes: s.notes, boat_name: s.boat_name, boat_details: s.boat_details, owner_phone: s.owner_phone, ...changes });

test('the edit form is filled in with the service', async () => {
  const { s } = await booked({ boat_name: 'Sea Breeze' });
  const page = await frank.get(`/services/${s.id}/edit`);
  assert.equal(page.status, 200);
  assert.match(page.html, /value="Harbor wash"/);
  assert.match(page.html, /value="Sea Breeze"/);
  assert.match((await frank.get(`/services/${s.id}`)).html, new RegExp(`href="/services/${s.id}/edit"`));
});

test('moving the time puts confirmed cleaners back to waiting, and a YES confirms them again', async () => {
  const { s, yes: [mike], maybe: [tony] } = await booked({ confirmed: 1, waiting: 1 });
  const r = await frank.post(`/services/${s.id}/edit`, formOf(s, { time: '13:00' }));
  assert.equal(r.status, 303);
  assert.equal(db.serviceById(s.id).time, '13:00');
  assert.equal(db.requestFor(s.id, mike.id).status, 'pending');
  assert.match(lastText(mike.id), /moved Harbor wash to .*1:00 PM\. Reply YES to keep it or NO to drop out/);
  assert.match(lastText(tony.id), /moved Harbor wash to .*1:00 PM\. Reply YES to keep it or NO to drop out/);
  assert.match(r.flash, /asked again/);

  assert.match(incoming(mike.phone_e164, 'YES'), /confirmed for Harbor wash/);
  assert.equal(db.requestFor(s.id, mike.id).status, 'accepted');
});

test('changing the place tells everyone booked or asked, and nobody has to answer again', async () => {
  const { s, yes: [mike], maybe: [tony] } = await booked({ confirmed: 1, waiting: 1 });
  await frank.post(`/services/${s.id}/edit`, formOf(s, { location: 'Dock C', pay: '$100' }));
  assert.equal(db.requestFor(s.id, mike.id).status, 'accepted');
  assert.equal(db.requestFor(s.id, tony.id).status, 'pending');
  assert.match(lastText(mike.id), /Harbor wash .* changed: now at Dock C; pay \$100\./);
  assert.doesNotMatch(lastText(mike.id), /Reply YES/);
  assert.match(lastText(tony.id), /changed: now at Dock C/);
});

test('a new title alone, or no change at all, sends no texts', async () => {
  const { s, yes: [mike] } = await booked();
  const before = textsTo(mike.id).length;
  await frank.post(`/services/${s.id}/edit`, formOf(s, { title: 'Harbor detail' }));
  await frank.post(`/services/${s.id}/edit`, formOf(db.serviceById(s.id)));
  assert.equal(db.serviceById(s.id).title, 'Harbor detail');
  assert.equal(textsTo(mike.id).length, before);
});

test('needing fewer cleaners than are confirmed is refused', async () => {
  const { s } = await booked({ confirmed: 2 });
  const r = await frank.post(`/services/${s.id}/edit`, formOf(s, { needed: '1' }));
  assert.match(r.flash, /2 are confirmed\. Release someone first/);
  assert.equal(db.serviceById(s.id).needed, 3);
});

test('needing exactly as many as are confirmed calls off the requests still waiting', async () => {
  const { s, maybe: [tony] } = await booked({ confirmed: 2, waiting: 1 });
  await frank.post(`/services/${s.id}/edit`, formOf(s, { needed: '2' }));
  assert.equal(db.requestFor(s.id, tony.id).status, 'cancelled');
  assert.match(lastText(tony.id), /is filled\. No need to reply/);
});

test('past and cancelled services can’t be edited, and other managers can’t see the form', async () => {
  const past = await makeService(manager, { offset: -1 });
  assert.match((await frank.post(`/services/${past.id}/edit`, formOf(past, { day: localDay(5) }))).flash, /already happened/);
  assert.equal(db.serviceById(past.id).day, past.day);

  const { s } = await booked();
  db.cancelService(s.id);
  assert.match((await frank.post(`/services/${s.id}/edit`, formOf(s, { time: '09:00' }))).flash, /cancelled/);

  const other = await login(base, makeUser('manager'));
  assert.equal((await other.get(`/services/${s.id}/edit`)).status, 404);
  assert.equal((await other.post(`/services/${s.id}/edit`, formOf(s))).status, 404);
});

test('a bad form is refused without changing anything', async () => {
  const { s } = await booked();
  const r = await frank.post(`/services/${s.id}/edit`, formOf(s, { location: '', pay: '$90' }));
  assert.equal(r.status, 400);
  assert.match(r.html, /Please fill in/);
  assert.match(r.html, /value="\$90"/);   // what they typed is still there
  assert.equal(db.serviceById(s.id).location, 'Harbor Marina');
});
