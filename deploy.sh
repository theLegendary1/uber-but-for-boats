#!/usr/bin/env bash
# Deploy DockWash to the Synology NAS.
#
#   ./deploy.sh --setup    once: make the folders and the bare git repo on the NAS, install the hook, add the "nas" remote
#   ./deploy.sh --start    once (and after editing docker-compose.yml): create/refresh the container. Asks for your sudo password
#   ./deploy.sh            every deploy: commit first, then this pushes main to the NAS, which checks it out and restarts the app
#                          (run on the NAS itself, it starts/refreshes the container instead, same as --start)
#   ./deploy.sh --seed     add the demo marina and cleaners (sudo)
#   ./deploy.sh --status   is it up, and which commit is live
#   ./deploy.sh --logs     the app's recent output (sudo)
#   ./deploy.sh --stop     stop the container (sudo)
#   ./deploy.sh --backup   copy the database down to ./backups/
#   ./deploy.sh --admin EMAIL  give that account the Admin page (referral leaderboard); --admin off removes all admins
#   ./deploy.sh --invite CODE   require CODE to sign up (do this before going public); --invite off to drop it
#   ./deploy.sh --twilio       turn on real texts: asks for your Twilio account SID, auth token and number; --twilio off for test mode
#   ./deploy.sh --email        send email through Google Workspace: asks for the account, an app password and the From address
#   ./deploy.sh --google       "Continue with Google": asks for the OAuth client ID and secret; --google off to remove it
#   ./deploy.sh --domain HOST  the permanent address (e.g. dockwash.cjmtech.net) through a named Cloudflare tunnel (sudo);
#                              asks for the tunnel token and a support email. --domain-stop takes it down
#   ./deploy.sh --public       put DockWash on the internet at a https://….trycloudflare.com address (sudo)
#   ./deploy.sh --public-url   show that address
#   ./deploy.sh --public-stop  take it off the internet (sudo)
#
# Settings (environment variables): NAS_HOST (default hermes, from ~/.ssh/config), NAS_IP for the URL, PORT.
set -euo pipefail

NAS_HOST=${NAS_HOST:-hermes}
NAS_IP=${NAS_IP:-192.168.86.10}
PORT=${PORT:-3210}
BASE=/volume1/docker/dockwash
REPO=/volume1/docker/dockwash-git/dockwash.git
URL="http://$NAS_IP:$PORT"
DOCKER="export PATH=\$PATH:/usr/local/bin; sudo docker"
# Waits until the tunnel is connected (its address doesn't exist before that, and a browser that looks too early
# remembers "no such site" for a while), then saves the address as PUBLIC_URL, which invite links use.
# One remote command, so sudo asks only once.
SHOW_URL="for i in \$(seq 1 30); do l=\$($DOCKER logs dockwash-tunnel 2>&1); a=\$(echo \"\$l\" | grep -oE 'https://[a-z0-9-]+[.]trycloudflare[.]com' | tail -1); [ -n \"\$a\" ] && echo \"\$l\" | grep -q 'Registered tunnel connection' && { touch $BASE/data/app.env; sed -i '/^PUBLIC_URL=/d' $BASE/data/app.env; echo PUBLIC_URL=\$a >> $BASE/data/app.env; echo \"==> DockWash is public at \$a\"; exit 0; }; sleep 2; done; echo 'No address yet. Try again: ./deploy.sh --public-url'; exit 1"

cd "$(dirname "$0")"
say() { printf '\033[1m==> %s\033[0m\n' "$*"; }
# Run on the NAS itself (e.g. from /volume1/docker/dockwash/app), the NAS commands run right here instead of over ssh.
if [ -d "$REPO" ]; then
  ON_NAS=1
  nas() { bash -c "$*"; }
  nas_tty() { bash -c "$*"; }
else
  ON_NAS=
  nas() { ssh -o LogLevel=ERROR "$NAS_HOST" "$@"; }
  nas_tty() { ssh -t -o LogLevel=ERROR "$NAS_HOST" "$@"; }   # for sudo's password prompt
fi

wait_healthy() {
  for _ in $(seq 1 20); do
    if curl -fsS -m 3 "$URL/health" >/dev/null 2>&1; then say "DockWash is up at $URL"; return 0; fi
    sleep 1
  done
  echo "No answer from $URL/health yet. Try ./deploy.sh --logs" >&2
  return 1
}

# On the NAS the code is already checked out (pushes put it there), so a plain ./deploy.sh starts/refreshes the container.
ACTION=${1:-}
[ -n "$ACTION" ] || [ -z "$ON_NAS" ] || ACTION=--nas-default

case "$ACTION" in
  --setup)
    [ -z "$ON_NAS" ] || { echo "--setup runs from your Mac (it adds the 'nas' git remote there). It's already done." >&2; exit 1; }
    say "Creating $BASE and $REPO on $NAS_HOST"
    nas "mkdir -p $BASE/app $BASE/data && { [ -d $REPO ] || git init -q --bare -b main $REPO; }"
    scp -q -O scripts/post-receive "$NAS_HOST:$REPO/hooks/post-receive" 2>/dev/null \
      || nas "cat > $REPO/hooks/post-receive" < scripts/post-receive     # DSM's scp is sometimes off
    nas "chmod +x $REPO/hooks/post-receive"
    if git remote get-url nas >/dev/null 2>&1; then git remote set-url nas "$NAS_HOST:$REPO"; else git remote add nas "$NAS_HOST:$REPO"; fi
    say "Remote 'nas' -> $NAS_HOST:$REPO. Next: ./deploy.sh (push the code), then ./deploy.sh --start"
    ;;
  --start|--nas-default)
    say "Starting the container (your NAS sudo password)"
    nas_tty "$DOCKER compose -p dockwash -f $BASE/app/docker-compose.yml up -d --remove-orphans"
    wait_healthy
    ;;
  --stop) nas_tty "$DOCKER compose -p dockwash -f $BASE/app/docker-compose.yml stop" ;;
  --logs) nas_tty "$DOCKER logs --tail 100 dockwash" ;;
  --seed) nas_tty "$DOCKER exec dockwash node --disable-warning=ExperimentalWarning src/seed.js" ;;
  --status)
    echo "Live commit: $(nas "git --git-dir=$REPO log -1 --format='%h %s (%cr)' main" 2>/dev/null || echo 'nothing pushed yet')"
    curl -fsS -m 3 "$URL/health" >/dev/null && echo "App: up at $URL" || echo "App: not answering at $URL"
    ;;
  --backup)
    mkdir -p backups
    out="backups/dockwash-$(date +%Y%m%d-%H%M%S).db"
    # DSM has no sqlite3 to make a proper backup, so copy the database with its WAL files (fine for an app this quiet)
    for f in dockwash.db dockwash.db-wal dockwash.db-shm; do nas "[ -f $BASE/data/$f ] && cat $BASE/data/$f" > "$out${f#dockwash.db}" || rm -f "$out${f#dockwash.db}"; done
    say "Saved $out"
    ;;
  --admin)
    who=${2:?usage: ./deploy.sh --admin you@example.com   (or --admin off)}
    env=$BASE/data/app.env
    if [ "$who" = off ]; then nas "sed -i '/^ADMIN_EMAILS=/d' $env"; say "No admins now"; exit 0; fi
    [[ "$who" =~ ^[^[:space:]@,]+@[^[:space:]@,]+$ ]] || { echo "Give one email address." >&2; exit 1; }
    current=$(nas "sed -n 's/^ADMIN_EMAILS=//p' $env" || true)
    list=$(printf '%s\n' ${current//,/ } "$who" | awk 'NF && !seen[tolower($0)]++' | paste -sd, -)
    nas "touch $env && sed -i '/^ADMIN_EMAILS=/d' $env && echo 'ADMIN_EMAILS=$list' >> $env"
    say "Admins: $list (they'll see Admin in the menu; no restart needed)"
    ;;
  --invite)
    code=${2:?usage: ./deploy.sh --invite CODE   (or --invite off)}
    env=$BASE/data/app.env
    if [ "$code" = off ]; then
      nas "touch $env && sed -i '/^SIGNUP_CODE=/d' $env"; say "Anyone can sign up now"
    else
      [[ "$code" =~ ^[A-Za-z0-9_-]+$ ]] || { echo "Use letters, numbers, - and _ only." >&2; exit 1; }
      nas "touch $env && sed -i '/^SIGNUP_CODE=/d' $env && echo SIGNUP_CODE=$code >> $env"
      say "Sign-up now asks for the invite code: $code"
    fi
    ;;
  --twilio)
    env=$BASE/data/app.env
    if [ "${2:-}" = off ]; then
      nas "touch $env && sed -i '/^TWILIO_/d' $env"; say "Texts are in test mode (shown on each person's Texts page)"; exit 0
    fi
    echo "From console.twilio.com: the Account SID and Auth Token on the dashboard, and your Twilio phone number."
    read -rp "Account SID (AC...): " sid
    read -rsp "Auth Token (hidden): " token; echo
    read -rp "Twilio number (+1XXXXXXXXXX): " from
    [[ "$sid" =~ ^AC[0-9a-f]{32}$ && "$token" =~ ^[0-9a-f]{32}$ && "$from" =~ ^\+[0-9]{10,15}$ ]] \
      || { echo "Those don't look right: the SID is AC + 32 characters, the token 32, the number like +15165550123." >&2; exit 1; }
    # Through stdin, so the token never shows up in a command line
    printf 'TWILIO_ACCOUNT_SID=%s\nTWILIO_AUTH_TOKEN=%s\nTWILIO_FROM=%s\n' "$sid" "$token" "$from" \
      | nas "touch $env && sed -i '/^TWILIO_/d' $env && cat >> $env && chmod 600 $env"
    say "Texts are live from $from (no restart needed)."
    nas "grep -qs '^PUBLIC_URL=' $env" && echo "Replies (YES/NO/STOP) are pointed at DockWash within a minute." \
      || echo "Replies need DockWash on the internet: run ./deploy.sh --public. Until then texts go out but replies can't come in."
    ;;
  --email)
    env=$BASE/data/app.env
    if [ "${2:-}" = off ]; then nas "sed -i '/^SMTP_/d; /^MAIL_FROM=/d' $env"; say "Email is in test mode (printed to --logs)"; exit 0; fi
    echo "Google Workspace: the account DockWash sends as, and an app password for it"
    echo "(myaccount.google.com -> Security -> 2-Step Verification on -> App passwords)."
    read -rp "Account (e.g. chris@cjmtech.net): " user
    read -rsp "App password (16 letters, hidden): " pass; echo
    read -rp "From address [support@${user#*@}]: " from
    from=${from:-support@${user#*@}}
    pass=${pass// /}
    [[ "$user" =~ ^[^@[:space:]]+@[^@[:space:]]+$ && "$from" =~ ^[^@[:space:]]+@[^@[:space:]]+$ && "$pass" =~ ^[a-z]{16}$ ]] \
      || { echo "Check those: two email addresses, and the app password is 16 letters." >&2; exit 1; }
    # Through stdin, so the password never shows up in a command line
    printf 'SMTP_USER=%s\nSMTP_PASS=%s\nMAIL_FROM=%s\n' "$user" "$pass" "$from" \
      | nas "touch $env && sed -i '/^SMTP_/d; /^MAIL_FROM=/d' $env && cat >> $env && chmod 600 $env"
    nas "grep -qs '^SUPPORT_EMAIL=' $env || echo SUPPORT_EMAIL=$from >> $env"
    say "Sending a test email to $user"
    nas "python3 - $env $user" < scripts/test-email.py
    say "Email is live from $from (no restart needed)"
    ;;
  --google)
    env=$BASE/data/app.env
    if [ "${2:-}" = off ]; then nas "sed -i '/^GOOGLE_CLIENT_/d' $env"; say "Google sign-in is off"; exit 0; fi
    url=$(nas "sed -n 's/^PUBLIC_URL=//p' $env")
    echo "Google Cloud console -> APIs & Services -> Credentials -> your OAuth client (Web application)."
    echo "Its Authorized redirect URI must be exactly: ${url:-https://dockwash.cjmtech.net}/auth/google/callback"
    read -rp "Client ID (….apps.googleusercontent.com): " cid
    read -rsp "Client secret (hidden): " secret; echo
    [[ "$cid" =~ ^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$ && "$secret" =~ ^[A-Za-z0-9_-]{20,}$ ]] \
      || { echo "Those don't look right: the ID ends in .apps.googleusercontent.com, the secret usually starts GOCSPX-." >&2; exit 1; }
    printf 'GOOGLE_CLIENT_ID=%s\nGOOGLE_CLIENT_SECRET=%s\n' "$cid" "$secret" \
      | nas "touch $env && sed -i '/^GOOGLE_CLIENT_/d' $env && cat >> $env && chmod 600 $env"
    say "\"Continue with Google\" is on (no restart needed)"
    ;;
  --domain)
    host=${2:?usage: ./deploy.sh --domain dockwash.cjmtech.net}
    [[ "$host" =~ ^[a-z0-9.-]+\.[a-z]+$ ]] || { echo "That doesn't look like a hostname." >&2; exit 1; }
    env=$BASE/data/app.env
    if nas "[ -s $BASE/data/cloudflared/token ]"; then
      read -rp "A tunnel token is already saved. Replace it? [y/N] " again
    else again=y; fi
    if [[ "$again" =~ ^[Yy] ]]; then
      echo "Cloudflare dashboard -> Zero Trust -> Networks -> Tunnels -> your tunnel -> the long token in its install command (starts eyJ)."
      read -rsp "Tunnel token (hidden): " token; echo
      [[ "$token" =~ ^eyJ[A-Za-z0-9_=-]+$ ]] || { echo "That isn't a tunnel token (they start with eyJ)." >&2; exit 1; }
      printf '%s' "$token" | nas "mkdir -p $BASE/data/cloudflared && cat > $BASE/data/cloudflared/token && chmod 600 $BASE/data/cloudflared/token"
    fi
    current=$(nas "sed -n 's/^SUPPORT_EMAIL=//p' $env 2>/dev/null" || true)
    read -rp "Support email for the Privacy/Terms pages and HELP texts${current:+ [$current]}: " email
    email=${email:-$current}
    [[ "$email" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[a-z]+$ ]] || { echo "Please give an email address." >&2; exit 1; }
    nas "touch $env && sed -i '/^PUBLIC_URL=/d; /^SUPPORT_EMAIL=/d' $env && printf 'PUBLIC_URL=https://%s\nSUPPORT_EMAIL=%s\n' '$host' '$email' >> $env"
    say "Starting the tunnel for $host and stopping the temporary one (your NAS sudo password)"
    nas_tty "$DOCKER compose -p dockwash -f $BASE/app/docker-compose.yml --profile domain up -d; $DOCKER rm -f dockwash-tunnel >/dev/null 2>&1; true"
    URL="https://$host"
    say "Waiting for $URL (needs the Public Hostname route in Cloudflare: $host -> http://dockwash:3200)"
    wait_healthy
    ;;
  --domain-stop)
    nas_tty "$DOCKER compose -p dockwash -f $BASE/app/docker-compose.yml --profile domain stop domain-tunnel && $DOCKER compose -p dockwash -f $BASE/app/docker-compose.yml --profile domain rm -f domain-tunnel"
    nas "sed -i '/^PUBLIC_URL=/d' $BASE/data/app.env"
    say "The permanent address is down (DockWash is still on $URL)"
    ;;
  --public)
    nas "[ ! -s $BASE/data/cloudflared/token ]" || echo "Note: you have a permanent address set up (--domain). This temporary one will replace it in invite links until you run --domain again."
    nas "grep -qs '^SIGNUP_CODE=' $BASE/data/app.env" || echo "Warning: no invite code, so anyone who finds the address can sign up. Set one with ./deploy.sh --invite CODE"
    say "Starting the Cloudflare tunnel (your NAS sudo password)"
    nas_tty "$DOCKER compose -p dockwash -f $BASE/app/docker-compose.yml --profile public up -d && $SHOW_URL"
    ;;
  --public-url) nas_tty "$SHOW_URL" ;;
  --public-stop)
    nas_tty "$DOCKER compose -p dockwash -f $BASE/app/docker-compose.yml --profile public stop tunnel && $DOCKER compose -p dockwash -f $BASE/app/docker-compose.yml --profile public rm -f tunnel; sed -i '/^PUBLIC_URL=/d' $BASE/data/app.env 2>/dev/null; true"
    say "DockWash is off the internet (still on $URL)"
    ;;
  "")
    git rev-parse --verify -q HEAD >/dev/null || { echo "Nothing committed yet: git add -A && git commit first." >&2; exit 1; }
    git remote get-url nas >/dev/null 2>&1 || { echo "No 'nas' remote. Run ./deploy.sh --setup first." >&2; exit 1; }
    [ -z "$(git status --porcelain)" ] || echo "Note: you have uncommitted changes; only committed code is deployed."
    say "Pushing main to $NAS_HOST"
    git push nas HEAD:main
    if curl -fsS -m 3 "$URL/health" >/dev/null 2>&1; then
      sleep 2   # node --watch restarts on the new code
      wait_healthy
    else
      say "Code is on the NAS. Start the container with ./deploy.sh --start"
    fi
    ;;
  *) sed -n '2,26p' "$0"; exit 1 ;;
esac
