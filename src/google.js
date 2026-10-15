// "Continue with Google": OpenID Connect's authorization-code flow, with only fetch.
// Settings in data/app.env (`./deploy.sh --google`): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET. The OAuth client's
// authorized redirect URI must be PUBLIC_URL + /auth/google/callback.
import { randomBytes } from 'node:crypto';
import { settings } from './settings.js';

const config = () => {
  const s = settings();
  return s.GOOGLE_CLIENT_ID && s.GOOGLE_CLIENT_SECRET ? { id: s.GOOGLE_CLIENT_ID, secret: s.GOOGLE_CLIENT_SECRET } : null;
};
export const enabled = () => !!config();
export const callbackUrl = (base) => `${base}/auth/google/callback`;

/** Where to send the browser, plus the state and nonce to remember (in a cookie) and check when Google sends it back. */
export function start(base) {
  const state = randomBytes(16).toString('base64url');
  const nonce = randomBytes(16).toString('base64url');
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: config().id, redirect_uri: callbackUrl(base), response_type: 'code',
    scope: 'openid email profile', state, nonce, prompt: 'select_account' });
  return { url: url.href, state, nonce };
}

/**
 * Trades the code from Google's redirect for the person's identity: { sub, email, name }.
 * The ID token comes straight from Google over TLS, so its signature needn't be checked (Google's guidance),
 * but its audience, issuer, expiry, nonce and verified email are.
 */
export async function finish(base, code, nonce) {
  const c = config();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: c.id, client_secret: c.secret, redirect_uri: callbackUrl(base), grant_type: 'authorization_code' }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id_token) throw new Error(`Google said: ${data.error_description || data.error || res.status}`);
  const claims = JSON.parse(Buffer.from(data.id_token.split('.')[1], 'base64url').toString());
  if (claims.aud !== c.id) throw new Error('token is for another app');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) throw new Error('token not from Google');
  if (claims.exp * 1000 < Date.now()) throw new Error('token expired');
  if (claims.nonce !== nonce) throw new Error('sign-in didn’t match this browser');
  if (!claims.email || !claims.email_verified) throw new Error('Google account has no verified email');
  return { sub: claims.sub, email: claims.email, name: claims.name || '' };
}
