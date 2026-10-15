# DockWash
## Boats and Hos Step Brothers the movie attitude Prestige Worldwide vibes and clean boats.
Boat-washing bookings for marina managers and independent cleaners, adapted from the PallCall IntelliJ project at `/Users/chris/IdeaProjects/untitled2`.

Managers build a crew, schedule washes around their marina, and request available cleaners. Cleaners choose their working days and accept or decline jobs. No runtime npm dependencies; Node.js 22.13+ supplies HTTP, SQLite, and password hashing. Playwright is a development dependency for browser tests.

## Try it locally

```sh
npm run seed
npm run dev
```

Open http://localhost:3200. Demo password: `dockwash123`.

- Marina manager: `manager@demo.dockwash`
- Cleaner: `mike@demo.dockwash` (also `tony`, `dave`, `luis`, `sean`, `ray`, `pete`, `marcus`, `jimmy` at the same domain)

The demo contains Harbor Point Marina, nine cleaners, six weeks of availability, and a boat wash with two cleaners confirmed and one waiting. Demo accounts are local only unless you explicitly seed the NAS.

## Workflow

1. Sign up as a marina manager or a cleaner. Managers enter their marina; cleaners enter the areas they cover and their experience.
2. Cleaners mark available days on a six-week calendar, with weekday/weekend shortcuts.
3. Managers use **Find Cleaners** to build regular and backup crews. Ratings and notes stay private to the manager.
4. Create a wash with a title, date, start time, duration, marina/dock/slip, boat name and details, owner phone, cleaner count, pay, and instructions. Boat details can include length, make, material, and wash package.
5. Request individual cleaners or all available regulars. First to accept get the spots; unfilled requests close once the crew is complete.
6. Open a wash and select **Reschedule / edit** to move its date, start time, or duration. Everyone previously booked or asked must confirm the new schedule. Location, pay, or instruction changes notify the crew without dropping confirmations.
7. Release a cleaner, withdraw a request, or cancel a wash when plans change.

The marina dashboard groups upcoming washes by day and shows open spots and confirmed bookings. Durations run from 15 to 720 minutes in 15-minute steps and must end by midnight. Cleaners can accept several jobs in a day; overlapping confirmed jobs are refused, including when accepting by SMS. Adjacent appointments are allowed; managers should include travel/setup time in the duration. Availability is by day, not individual working-hour windows.

## Notifications and accounts

SMS and email start in **test mode**; no messages are sent externally without configuration. The **Texts** page displays simulated messages and accepts YES/NO replies. Optional Twilio SMS, Google Workspace SMTP, Google sign-in, password resets, invitations, referrals, and evening-before reminders are inherited from PallCall. New settings belong in DockWash's own `data/app.env`; do not copy PallCall's credentials or database.

Sessions, CSRF protection, password hashing, owner checks, and manager-private notes are retained. There is no payment processing, boat-owner booking role, or job-completion tracking yet. Pay is an agreed amount displayed with the job.

## NAS and Cloudflare

PallCall's source is deployed through `hermes:/volume1/docker/pallcall-git/pallcall.git` and published at `https://pallcall.cjmtech.net`. DockWash has separate deployment settings:

| Setting | DockWash |
| --- | --- |
| App folder | `/volume1/docker/dockwash/app` |
| Data folder | `/volume1/docker/dockwash/data` |
| Git repository | `/volume1/docker/dockwash-git/dockwash.git` |
| Container | `dockwash` |
| NAS host port / container port | `3210` / `3200` |
| SQLite file | `dockwash.db` |

The deployment helper is adapted from PallCall's existing Synology workflow. To deploy after committing this project on `main`:

```sh
./deploy.sh --setup
./deploy.sh
./deploy.sh --start
./deploy.sh --status
```

`--setup` creates the DockWash folders and repository on `hermes` and adds this project's `nas` remote. `--start` requires the NAS sudo password to start Docker Compose. DockWash was deployed to these NAS folders using a source archive and Docker Compose. Its current public preview is https://genre-spaces-ellen-walls.trycloudflare.com. The preview address can change when the tunnel restarts. No permanent DNS route has been configured. The Git repository setup above remains a separate step; this local project has no commits yet.

For a permanent address such as `dockwash.cjmtech.net`, configure a Cloudflare named tunnel's public hostname to `http://dockwash:3200`, then run `./deploy.sh --domain dockwash.cjmtech.net` with that tunnel's token. This is a proposed hostname, not an existing published URL. Use a separate DockWash tunnel token: a tunnel must have a connector that can reach the configured service. The helper sets `PUBLIC_URL` for invitation and account links. Alternatively, `./deploy.sh --public` creates a temporary Cloudflare address.

Additional commands: `--backup`, `--logs`, `--stop`, `--invite CODE`, `--admin EMAIL`, `--email`, `--twilio`, `--google`, and `--seed`. See `deploy.sh` for usage. Configure DockWash's own OAuth callback (`/auth/google/callback`) and messaging provider registration before enabling those integrations publicly.

## Verification

```sh
npm test
```

38 server tests and 10 browser tests cover booking, signup, availability, boat details, owner-only edits, private cleaner notes, rescheduling, reminders, scheduling conflicts, cancellation, referrals, sharing, and Google sign-in boundaries. Tests use temporary databases and local HTTP servers.

Run `npm run test:all` for the full suite or `npm run test:ui:watch` for the interactive browser test explorer. See [Testing DockWash](docs/testing.md) for browser installation, reports, new-feature guidelines, and Google login setup.

Data and backups are ignored by Git. Run `npm run seed` only for a demo; its published passwords are unsuitable for real accounts.

## Sharing and referral tracking

The Invite page offers separate cleaner and marina-manager links, both carrying your personal referral code. Share buttons open the native phone share menu (for apps such as Messages or WhatsApp), or copy the message and link when native sharing is unavailable. Text and explicit Copy buttons also work. DockWash tracks attributed signups and activation after a booking; it does not yet count link clicks. The admin leaderboard is restricted to addresses configured in `ADMIN_EMAILS`.

Use a permanent hostname before a broad launch so links people share keep working. The public NAS database starts empty; create your own account rather than using the local demo credentials. SMS and email remain in test mode.
