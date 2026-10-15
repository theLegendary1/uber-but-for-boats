// The booking flow as it stands: a manager books a service, requests a cleaner, the cleaner says yes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDay } from '../src/dates.js';
import { db, makeUser, startServer, login, lastText } from './helpers.js';

const base = await startServer();
const manager = makeUser('manager');
const cleaner = makeUser('cleaner');
db.setCrew(manager.id, cleaner.id, 'regular');

test('a manager books a service, requests a cleaner, and the cleaner accepts by text', async () => {
  const frank = await login(base, manager);
  const made = await frank.post('/services', { title: 'Sea Breeze wash', day: localDay(4), time: '11:00', needed: '1', location: 'Harbor Marina', pay: '$75', notes: '' });
  assert.equal(made.status, 303);
  const id = Number(made.location.match(/^\/services\/(\d+)$/)[1]);

  await frank.post(`/services/${id}/request`, { cleaner: String(cleaner.id) });
  assert.match(lastText(cleaner.id), /needs a cleaner.*Sea Breeze wash at Harbor Marina.*Reply YES/);

  const { incoming } = await import('../src/notify.js');
  assert.match(incoming(cleaner.phone_e164, 'yes'), /confirmed for Sea Breeze wash/);
  assert.equal(db.requestFor(id, cleaner.id).status, 'accepted');
  assert.match(lastText(manager.id), /is in for Sea Breeze wash.*1 of 1 confirmed/);

  const page = await frank.get(`/services/${id}`);
  assert.match(page.html, /<b>1 of 1<\/b> cleaners confirmed/);
});
