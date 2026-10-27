# Musk2028

Independent grassroots draft-movement site with a real, working petition to Congress.
Plain Node (no framework) + SQLite. Not affiliated with Elon Musk, the America Party, or any of his companies.

## Run locally
Requires Node >= 22.13 (uses built-in `node:sqlite`; falls back to `better-sqlite3` if installed).

    npm install
    cp .env.example .env   # then fill in values
    npm start              # http://127.0.0.1:4980

Pages: `/` (home + petition), `/manifesto`, `/privacy`, `/remove` (email removal link).
Data: `data/musk2028.db` (override with `DB_PATH`). The live counter is the real row count; nothing is seeded.

## What works without any keys
- Signing (name required; ZIP, state, email optional; updates opt-in; consent required)
- Validation, honeypot field, per-IP rate limit (3/min burst + `RATE_LIMIT_PER_HOUR`, default 5) using a salted IP hash (raw IPs never stored)
- Email dedupe, X-account dedupe
- Public recent-signers list (first name + last initial + state only; emails/ZIPs/handles never exposed)
- Self-service removal (token stored in the signer's browser; also in the confirmation email when SMTP is on)
- Admin CSV export: `curl -H "Authorization: Bearer $ADMIN_TOKEN" https://SITE/admin/export.csv`

## Email confirmation (needs SMTP)
Set `SMTP_URL` (e.g. `smtps://user:pass@smtp.resend.com:465`, Postmark, SES SMTP, etc.) and `FROM_EMAIL`.
Then signers who give an email get a confirm link (`/verify-email?token=…`) and their row is marked `email_verified=1`.
**Without these vars no email is sent and emails remain unverified** — the UI says so; nothing is faked.

## Verify with X (needs an X developer app)
1. Go to https://developer.x.com → Developer Portal → Projects & Apps → create a Project and App.
2. In the App's **User authentication settings**: enable **OAuth 2.0**, type **Web App (confidential client)**, permissions **Read**.
3. Callback URI / Redirect URL: `https://YOUR-DOMAIN/auth/x/callback` (and `http://127.0.0.1:4980/auth/x/callback` for local testing). Website URL: your domain.
4. Copy the OAuth 2.0 **Client ID** and **Client Secret** into `X_CLIENT_ID`, `X_CLIENT_SECRET`; set `X_REDIRECT_URI` to exactly the callback you registered.
5. Restart. The button switches from "coming soon" to live.

Flow: Authorization Code + PKCE (S256), scopes `users.read tweet.read`, against `https://x.com/i/oauth2/authorize` → `https://api.x.com/2/oauth2/token` → `GET https://api.x.com/2/users/me`.
We store only the X user id + username and a verified flag, then revoke the token. One X account can verify one signature.

## Storage
- `DATABASE_URL` set → **Postgres** (via `pg`; tables and indexes are auto-created at startup; SSL on for non-local hosts).
- Not set → **SQLite** at `DB_PATH` (default `data/musk2028.db`), for local use.

## Contract address chip
Edit `public/site-config.js` → `CA: ''`. While empty, every chip shows **CA: awaiting**; once set, chips show the shortened address and copy it on click.

## Deploy (Render web service, no render.yaml)
- Runtime: Node · Build command: `npm install` · Start command: `node server.js` · Health check path: `/healthz`
- Node >= 22.13 (set env `NODE_VERSION=22.13.0` or newer). `PORT` is provided by Render.
- Create a Render Postgres instance and set `DATABASE_URL` to its **Internal Database URL**.
- On Render, `PUBLIC_URL` defaults to `https://musk2028.vote` and proxy headers are trusted automatically.

Env vars:
| Name | Required? | Notes |
|---|---|---|
| `DATABASE_URL` | required | Render Postgres internal URL |
| `ADMIN_TOKEN` | required (for CSV export) | long random string |
| `IP_SALT` | recommended | random string for IP hashing |
| `NODE_VERSION` | recommended | `22.13.0`+ |
| `PUBLIC_URL` | optional | defaults to `https://musk2028.vote` on Render |
| `CONTACT_EMAIL` | optional | shown on the privacy page for deletion requests |
| `SMTP_URL`, `FROM_EMAIL` | optional | enables email confirmation |
| `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REDIRECT_URI` | optional | `X_REDIRECT_URI=https://musk2028.vote/auth/x/callback`; enables Verify with X |
