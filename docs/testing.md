# Testing DockWash

*Robert, test lead:* “A clean dashboard is nice. Show me the whole booking actually works.”

The suite has two layers: fast Node tests for rules and server behavior, and Playwright browser tests for complete user journeys. Browser tests use the actual HTML, JavaScript, forms, sessions, and SQLite database. Each test gets its own temporary database and server on an automatically assigned port. They never use the NAS database or a running local demo. Notification credentials are absent, so no real emails or texts are sent.

## Run the suite

```sh
npm ci
npx playwright install chromium
npm test                 # Server, scheduling, referral and Google token checks
npm run test:ui          # Browser journeys on desktop and phone-sized Chromium
npm run test:all         # Both layers
npm run test:ui:watch     # Interactive test explorer
npm run test:ui:headed   # Watch the browser run
npm run test:ui:report   # Open the latest HTML report
```

Playwright saves screenshots, videos, traces, and server logs for failures. The HTML report links to these artifacts. To run one journey while implementing a feature:

```sh
npx playwright test --grep 'reschedules' --project desktop-chromium --headed
```

The GitHub Actions workflow runs both layers on pushes and pull requests and uploads reports. It takes effect when this repository is pushed to GitHub. Mobile tests emulate a phone viewport and touch behavior in Chromium; they do not run actual iOS Safari.

## Journey coverage

| Journey | Browser assertions |
| --- | --- |
| Manager onboarding | Signup, marina dashboard, logout, invalid password, successful login |
| Cleaner availability | Signup, select days, save, reload and verify persistence |
| Booking lifecycle | Find a cleaner, add a regular, post wash, request, accept, confirm manager view |
| Schedule changes | Reschedule wash, cleaner sees changed time, cleaner confirms again |
| Cancellation | Accept confirmation dialog, manager sees cancelled wash, cleaner sees cancellation |
| Growth loop | Share menu receives referral URL, new cleaner signs up, Joined becomes Active after booking |
| Google entry | Hidden when unconfigured; configured button issues correct Google URL, callback and signup role |
| Google failure | Cancellation and expired/wrong state return useful login messages |

Server tests additionally cover overlapping and adjacent appointments, duration validation, owner-only edits, private ratings and notes, reminders, referral attribution, and Google claim validation.

## Adding a new UI feature

1. Write the acceptance criteria as an observable user outcome: who acts, what they do, what they should see, and what survives a reload.
2. Add a focused test in `test/ui/`, importing `test` and `expect` from `fixtures.js`. Reuse `signup` and `createWash` when useful. Prefer visible role/label locators so tests exercise the UI as users and assistive technologies do.
3. Use separate browser contexts for different people. Start each test with fresh users rather than depending on another test's output.
4. Cover the successful action and one important failure or permission boundary. Add Node tests for complex rules rather than repeating every rule through a browser.
5. Run the focused test, then `npm run test:all`. Keep traces/screenshots as diagnostic output rather than updating baselines to hide a failure.

Do not point this suite at production, add a password bypass to the app, commit OAuth tokens, or automate sending invitations to real people.

## Google login setup and verification

Google login is already implemented. Configure a Google OAuth **Web application** client with the exact redirect URI:

```text
https://YOUR-PERMANENT-HOSTNAME/auth/google/callback
```

Use a permanent hostname before configuring a public OAuth client. For local manual verification, Google also permits an HTTP localhost redirect such as `http://localhost:3200/auth/google/callback`; use the same host in your browser. Add the intended account as an OAuth test user if your Google consent screen is in testing mode.

Run `./deploy.sh --google` to enter the client ID and secret privately on the NAS, or put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the appropriate app's ignored `data/app.env`. The command prints setup guidance. Never put the secret in a test file or chat. The browser suite uses dummy credentials only in its temporary settings.

Automated tests stop at the Google provider boundary and simulate token responses in Node tests. They verify audience, issuer, expiry, nonce, and verified-email rejection. They do not claim to verify real Google consent, MFA, or successful Google account linking through the UI.

After configuring Google, manually verify with your designated test account:

- Existing password account: Continue with Google links the matching email and opens the existing dashboard; logging in again keeps the same account.
- New cleaner: choose cleaner signup, continue with Google, finish phone/area/Terms, and reach Availability without entering a password.
- New manager: start from manager signup and reach the marina dashboard after completing details.
- Referral: open a referral link before Google signup, complete it, and confirm the inviter sees the new signup credited.
- Cancel Google consent and verify the app shows its cancellation message.
- Sign out, then verify both Google login and the original password still work for an existing password account.

Use disposable test accounts for these checks. Successful real Google login is a separate release check once credentials are configured.
