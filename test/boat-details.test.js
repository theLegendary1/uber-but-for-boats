// A service has a church (location) and, optionally, a boat_name with its address and phone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDay } from '../src/dates.js';
import { db, makeUser, startServer, login, lastText } from './helpers.js';

const base = await startServer();
const manager = makeUser('manager');
const cleaner = makeUser('cleaner');

const service = { title: 'Sea Breeze wash', day: localDay(4), time: '11:00', needed: '2', location: 'Harbor Marina', pay: '', notes: '',
  boat_name: 'Sea Breeze', boat_details: '32 ft Sea Ray, fiberglass', owner_phone: '(718) 786-8000' };

test('the boat_name is saved and shown to the manager, the cleaner, and in the request text', async () => {
  const frank = await login(base, manager);
  const id = Number((await frank.post('/services', service)).location.split('/').pop());
  const s = db.serviceById(id);
  assert.equal(s.boat_name, 'Sea Breeze');
  assert.equal(s.boat_details, '32 ft Sea Ray, fiberglass');
  assert.equal(s.owner_phone, '(718) 786-8000');

  const page = (await frank.get(`/services/${id}`)).html;
  assert.match(page, /Sea Breeze/);
  assert.match(page, /32 ft Sea Ray/);
  assert.match(page, /href="tel:7187868000"/);

  await frank.post(`/services/${id}/request`, { cleaner: String(cleaner.id) });
  assert.match(lastText(cleaner.id), /at Harbor Marina · Sea Breeze/);

  const card = (await (await login(base, cleaner)).get('/')).html;
  assert.match(card, /Sea Breeze/);
  assert.match(card, /32 ft Sea Ray/);
});

test('without a boat_name the texts and pages read as before', async () => {
  const frank = await login(base, manager);
  const id = Number((await frank.post('/services', { ...service, boat_name: '', boat_details: '', owner_phone: '' })).location.split('/').pop());
  await frank.post(`/services/${id}/request`, { cleaner: String(cleaner.id) });
  assert.match(lastText(cleaner.id), /Sea Breeze wash at Harbor Marina\. Reply YES/);
  assert.doesNotMatch((await frank.get(`/services/${id}`)).html, /⛵/);
});
