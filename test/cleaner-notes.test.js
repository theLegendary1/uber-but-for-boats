// A manager keeps a private note and a 1-5 star rating on each cleaner, and sees their history with the home.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, makeUser, makeService, startServer, login } from './helpers.js';

const base = await startServer();
const manager = makeUser('manager');
const rival = makeUser('manager');
const mike = makeUser('cleaner', { name: 'Mike Brennan' });
db.setCrew(manager.id, mike.id, 'regular');
const frank = await login(base, manager);

async function carried(d, b, fields = {}) {
  const s = await makeService(d, fields);
  db.createRequest(s.id, b.id);
  db.answerRequest(db.requestFor(s.id, b.id).id, true);
  return s;
}

test('a manager saves a note and stars, and sees them on the cleaner page, My Crew, Find Cleaners and the service page', async () => {
  const r = await frank.post(`/cleaners/${mike.id}/note`, { rating: '4', note: 'Always early. Bad knee, keep him off stairs.' });
  assert.equal(r.status, 303);
  assert.equal(r.location, `/cleaners/${mike.id}`);

  const page = (await frank.get(`/cleaners/${mike.id}`)).html;
  assert.match(page, /Mike Brennan/);
  assert.match(page, /Always early\. Bad knee/);
  assert.match(page, /<option value="4" selected>/);

  const s = await makeService(manager);
  for (const path of ['/crew', '/cleaners', `/services/${s.id}`]) {
    const html = (await frank.get(path)).html;
    assert.match(html, /★★★★☆/, path);
    assert.match(html, /Always early/, path);
    assert.match(html, new RegExp(`href="/cleaners/${mike.id}"`), path);
  }
});

test('clearing the stars keeps the note', async () => {
  await frank.post(`/cleaners/${mike.id}/note`, { rating: '', note: 'Just the note' });
  const page = (await frank.get(`/cleaners/${mike.id}`)).html;
  assert.match(page, /Just the note/);
  assert.doesNotMatch((await frank.get('/crew')).html, /★/);
});

test('a rating outside 1-5 is refused', async () => {
  await frank.post(`/cleaners/${mike.id}/note`, { rating: '4', note: 'Good' });
  const r = await frank.post(`/cleaners/${mike.id}/note`, { rating: '9', note: 'Changed' });
  assert.match(r.flash, /1 to 5 stars/);
  assert.match((await frank.get(`/cleaners/${mike.id}`)).html, /<option value="4" selected>/);
});

test('notes are private: other managers and the cleaner never see them', async () => {
  await frank.post(`/cleaners/${mike.id}/note`, { rating: '2', note: 'SECRET-NOTE' });
  const other = await login(base, rival);
  const theirs = await makeService(rival);
  for (const path of ['/cleaners', `/cleaners/${mike.id}`, `/services/${theirs.id}`]) {
    assert.doesNotMatch((await other.get(path)).html, /SECRET-NOTE|class="stars"/, path);
  }
  const asMike = await login(base, mike);
  for (const path of ['/', '/profile', `/cleaners/${mike.id}`]) assert.doesNotMatch((await asMike.get(path)).html, /SECRET-NOTE/, path);
});

test('history counts only this home’s washes that went ahead', async () => {
  const dave = makeUser('cleaner');
  await carried(manager, dave, { offset: -10 });
  const last = await carried(manager, dave, { offset: -3, title: 'Last one' });
  const called = await carried(manager, dave, { offset: 5 });
  db.cancelService(called.id);
  await carried(rival, dave, { offset: -1 });
  const declined = await makeService(manager);
  db.createRequest(declined.id, dave.id);
  db.answerRequest(db.requestFor(declined.id, dave.id).id, false);

  const h = db.historyWithHome(manager.id, dave.id);
  assert.equal(h.washes, 2);
  assert.equal(h.declined, 1);
  assert.equal(h.last_day, last.day);
  assert.deepEqual(h.services.map((x) => x.title), ['Last one', 'Harbor wash']);

  const page = (await frank.get(`/cleaners/${dave.id}`)).html;
  assert.match(page, /2 washes with you/);
  assert.match(page, /1 declined/);
});

test('the cleaner page is only for cleaners that exist', async () => {
  assert.equal((await frank.get(`/cleaners/${rival.id}`)).status, 404);
  assert.equal((await frank.get('/cleaners/99999')).status, 404);
  assert.equal((await frank.post('/cleaners/99999/note', { rating: '3', note: '' })).status, 404);
});

test('the tier buttons on the cleaner page come back to it', async () => {
  const r = await frank.post('/crew', { cleaner: String(mike.id), tier: 'outside', back: `/cleaners/${mike.id}` });
  assert.equal(r.location, `/cleaners/${mike.id}`);
  assert.equal(db.crewList(manager.id, 'outside')[0].id, mike.id);
});
