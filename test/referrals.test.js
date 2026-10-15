import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, makeUser, makeService, startServer, login } from './helpers.js';

const base = await startServer();
const referrer = makeUser('manager');

test('sharing offers separate cleaner and manager links with the same referral code', async () => {
  const page = await (await login(base, referrer)).get('/invite');
  assert.match(page.html, /Share with cleaners/);
  assert.match(page.html, /Share with marina managers/);
  assert.ok(page.html.includes(`/signup?ref=${referrer.referral_code}`));
  assert.ok(page.html.includes(`/signup?role=manager&amp;ref=${referrer.referral_code}`));
});

test('a shared link credits signup and tracks activation after a booking', async () => {
  const signup = await fetch(`${base}/signup?ref=${referrer.referral_code}`);
  const html = await signup.text();
  assert.ok(html.includes(`value="${referrer.referral_code}"`));
  const response = await fetch(`${base}/signup`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({
    role: 'cleaner', name: 'Referral Cleaner', email: 'referral@example.test', phone: '(347) 555-9876',
    password: 'dockwash123', terms: 'on', code: referrer.referral_code, via: 'link',
  }) });
  assert.equal(response.status, 303);
  const cleaner = db.userByEmail('referral@example.test');
  assert.equal(cleaner.referred_by, referrer.id);
  assert.equal(cleaner.referral_via, 'link');
  assert.equal(db.referralsOf(referrer.id).find((p) => p.id === cleaner.id).active, 0);
  const s = await makeService(referrer);
  db.createRequest(s.id, cleaner.id);
  db.answerRequest(db.requestFor(s.id, cleaner.id).id, true);
  assert.equal(db.referralsOf(referrer.id).find((p) => p.id === cleaner.id).active, 1);
  const leader = db.referralLeaderboard().find((p) => p.id === referrer.id);
  assert.equal(leader.brought, 1);
  assert.equal(leader.active, 1);
});
