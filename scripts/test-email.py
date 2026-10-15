"""Sends a test email with the settings in data/app.env, to check them. Run by `deploy.sh --email` on the NAS."""
import smtplib, sys
from email.message import EmailMessage

env = dict(l.strip().split("=", 1) for l in open(sys.argv[1]) if "=" in l and not l.startswith("#"))
msg = EmailMessage()
msg["From"] = f"DockWash <{env.get('MAIL_FROM') or env['SMTP_USER']}>"
msg["To"] = sys.argv[2]
msg["Subject"] = "DockWash email works"
msg.set_content("This is a test from DockWash on your NAS. Password resets and notices will come from this address.")
try:
    with smtplib.SMTP_SSL(env.get("SMTP_HOST", "smtp.gmail.com"), int(env.get("SMTP_PORT", 465)), timeout=20) as s:
        s.ehlo()
        s.user, s.password = env["SMTP_USER"], env["SMTP_PASS"].replace(" ", "")
        # AUTH PLAIN only: smtplib.login() falls back to AUTH LOGIN after a refusal, Google hangs up,
        # and the real "535 Username and Password not accepted" is lost behind "Connection unexpectedly closed".
        s.auth("PLAIN", s.auth_plain)
        s.send_message(msg, from_addr=env["SMTP_USER"])
    print(f"Sent a test email to {sys.argv[2]}.")
except smtplib.SMTPAuthenticationError:
    sys.exit("Google refused the login. Check the account and that it's an app password (16 letters), not your normal password.")
except Exception as e:
    sys.exit(f"Couldn't send: {e}")
