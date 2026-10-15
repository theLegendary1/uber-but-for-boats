import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './db.js';

/**
 * Settings in data/app.env (KEY=value lines), re-read each time so a change needs no restart.
 *   SIGNUP_CODE          when set, signing up without an invite link takes this code
 *   PUBLIC_URL           the internet address (written by `deploy.sh --public`); invite links and Twilio use it
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM   real texts through Twilio (`deploy.sh --twilio`); without them, test mode
 */
export function settings() {
  try {
    return Object.fromEntries(readFileSync(join(DATA_DIR, 'app.env'), 'utf8').split('\n')
      .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]));
  } catch { return {}; }
}
