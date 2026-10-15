import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from './helpers.js';
import * as google from '../src/google.js';

writeFileSync(join(db.DATA_DIR, 'app.env'), 'GOOGLE_CLIENT_ID=test-client\nGOOGLE_CLIENT_SECRET=fake-secret\n');
const claims = () => ({ sub: 'google-user-123', aud: 'test-client', iss: 'https://accounts.google.com',
  exp: Math.floor(Date.now() / 1000) + 600, nonce: 'test-nonce', email: 'user@example.test', email_verified: true, name: 'Test User' });
function provider(t, identity) {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    assert.equal(options.body.get('redirect_uri'), 'http://localhost:3200/auth/google/callback');
    assert.equal(options.body.get('code'), 'test-code');
    return Response.json({ id_token: `header.${Buffer.from(JSON.stringify(identity)).toString('base64url')}.signature` });
  });
}

test('Google identity is accepted after token exchange with expected claims', async (t) => {
  provider(t, claims());
  assert.deepEqual(await google.finish('http://localhost:3200', 'test-code', 'test-nonce'), {
    sub: 'google-user-123', email: 'user@example.test', name: 'Test User',
  });
});
for (const [field, value, message] of [
  ['aud', 'another-client', /another app/], ['iss', 'https://attacker.example', /not from Google/],
  ['exp', 1, /expired/], ['nonce', 'other-browser', /didn’t match/],
  ['email_verified', false, /verified email/], ['email', '', /verified email/],
]) {
  test(`Google rejects invalid ${field}`, async (t) => {
    provider(t, { ...claims(), [field]: value });
    await assert.rejects(google.finish('http://localhost:3200', 'test-code', 'test-nonce'), message);
  });
}
