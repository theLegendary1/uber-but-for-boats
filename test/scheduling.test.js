import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, makeUser, makeService, startServer, login } from './helpers.js';

const base = await startServer();
const manager = makeUser('manager');
const managerClient = await login(base, manager);

async function ask(cleaner, fields = {}) {
  const s = await makeService(manager, { time: '09:00', duration_minutes: 120, needed: 1, ...fields });
  db.createRequest(s.id, cleaner.id);
  return { s, r: db.requestFor(s.id, cleaner.id) };
}

test('overlapping washes cannot be accepted through the site or SMS; adjacent jobs can', async () => {
  const cleaner = makeUser('cleaner');
  const client = await login(base, cleaner);
  const first = await ask(cleaner);
  assert.equal((await client.post(`/requests/${first.r.id}/accept`)).status, 303);
  const overlap = await ask(cleaner, { time: '10:00' });
  assert.match((await client.post(`/requests/${overlap.r.id}/accept`)).flash, /already have a wash booked/);
  assert.equal(db.requestFor(overlap.s.id, cleaner.id).status, 'pending');
  const { incoming } = await import('../src/notify.js');
  assert.match(incoming(cleaner.phone_e164, 'YES'), /already have a wash booked/);
  const adjacent = await ask(cleaner, { time: '11:00' });
  assert.equal(db.answerRequest(adjacent.r.id, true).result, 'accepted');
  assert.ok(db.candidates(overlap.s.id).find((p) => p.id === cleaner.id).booked_elsewhere);
});

test('cancelling a wash frees the slot, and different days do not conflict', async () => {
  const cleaner = makeUser('cleaner');
  const first = await ask(cleaner);
  db.answerRequest(first.r.id, true);
  const tomorrow = await ask(cleaner, { offset: 4 });
  assert.equal(db.answerRequest(tomorrow.r.id, true).result, 'accepted');
  const overlap = await ask(cleaner);
  db.cancelService(first.s.id);
  assert.equal(db.answerRequest(overlap.r.id, true).result, 'accepted');
});

test('extending a wash asks confirmed cleaners to reconfirm and checks conflicts on their new answer', async () => {
  const cleaner = makeUser('cleaner');
  const first = await ask(cleaner);
  const second = await ask(cleaner, { time: '11:00' });
  db.answerRequest(first.r.id, true);
  db.answerRequest(second.r.id, true);
  const s = first.s;
  await managerClient.post(`/services/${s.id}/edit`, { ...s, duration_minutes: '180' });
  assert.equal(db.requestFor(s.id, cleaner.id).status, 'pending');
  assert.equal(db.answerRequest(first.r.id, true).result, 'conflict');
});

test('invalid durations and washes that cross midnight are refused without saving a job', async () => {
  const s = { title: 'Evening wash', day: (await ask(makeUser('cleaner'))).s.day, time: '10:00', location: 'Dock A', needed: '1' };
  for (const duration_minutes of ['0', '-15', '16', 'abc', '735']) {
    const res = await managerClient.post('/services', { ...s, duration_minutes });
    assert.equal(res.location, '/');
    assert.match(res.flash, /duration/);
  }
  const late = await managerClient.post('/services', { ...s, time: '23:00', duration_minutes: '120' });
  assert.match(late.flash, /midnight/);
});

test('the marina schedule groups washes by day and shows duration and boat details', async () => {
  const { s } = await ask(makeUser('cleaner'), { title: 'Ocean Star wash', boat_name: 'Ocean Star', duration_minutes: 90 });
  const page = await managerClient.get('/');
  assert.match(page.html, /Wash schedule/);
  assert.match(page.html, /Ocean Star wash/);
  assert.match(page.html, /90 min/);
  assert.match(page.html, new RegExp(`href="/services/${s.id}"`));
  assert.match((await managerClient.get(`/services/${s.id}/edit`)).html, /name="duration_minutes"[^>]*value="90"/);
});
