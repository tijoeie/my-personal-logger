# My Personal Logger: self-hosted build (v1)

New build that replaces the GitHub Pages + Firebase app. Same features, same data format (`S` object), now served by a zero-dependency Node 22 server in Docker on the Oracle monitor VM.

## Layout
```
server/            server.js (HTTP + API), store.js (state.json, sessions, backups), ingest.js (bank feed)
server/test/       node --test: ingest rules, HTTP API, client merge
public/            the PWA (no build step, native ES modules)
  js/core/         constants, state (S + undo), util, sync (login/push/poll), merge (3-way)
  js/domain/       finance (balances, periods, recurring), schedule (renewals, services, leave, gratuity)
  js/ui/           shell (nav, sync bar, login, tabs), form (modal dialog)
  js/views/        one module per tab
  js/reports/      pdf (print overlay), excel (SpreadsheetML)
Dockerfile, docker-compose.yml, .env.example
```
Run tests: `npm test`. Run locally: `APP_PASSPHRASE=x INGEST_SECRET=y DATA_DIR=./data PORT=3010 node server/server.js`.

## Deploy on the ARM server (oracle-arm-instance)
Moved off the monitor VM on 2026-10-15 (the 1 GB E2.1.Micro could not run n8n).
Folder `~/Claude projects/personal-logger` holds the logger, n8n and a Caddy proxy (`deploy/arm/docker-compose.yml`), all tailnet-only:
- Logger: `https://arm-server.tailcadf24.ts.net:9100`
- n8n: `https://arm-server.tailcadf24.ts.net:9200`

The TLS cert comes from `tailscale cert`, renewed monthly by `renew-cert.sh` (crontab: 03:40 on the 1st).

```bash
# from this repo on the Mac
COPYFILE_DISABLE=1 tar czf - --no-xattrs server/server.js server/store.js server/ingest.js public Dockerfile .dockerignore .env.example \
  -C deploy/arm docker-compose.yml Caddyfile renew-cert.sh | ssh oracle-arm-instance 'tar xzf - -C "$HOME/Claude projects/personal-logger"'
ssh oracle-arm-instance 'cd "$HOME/Claude projects/personal-logger" && docker compose up -d --build'
```
First-time setup (already done): `.env` from `.env.example` with generated secrets (chmod 600), `mkdir data && sudo chown 1000:1000 data`, `./renew-cert.sh`.
View the passphrase: `ssh oracle-arm-instance 'grep APP_PASSPHRASE "$HOME/Claude projects/personal-logger/.env"'`. Never paste it in chat.
Bump `public/version.json` on each update so open apps reload.

## Data migration (keeps all history)
1. Old app (tijoeie.github.io/my-personal-logger): Settings > **Export backup (JSON)**. This file is the full Firestore copy.
2. New app: sign in with the passphrase > Settings > **Import backup** > confirm. All tabs, bank-feed entries, balances and history come across unchanged, because the format is identical.
3. Check balances and counts match on both apps, then on the phone: open the new URL in Safari > Share > Add to Home Screen (needs Tailscale on).
4. Point n8n at the new endpoint (below). Keep the old app read-only for a week, then delete the Firebase project.

## n8n (same compose stack)
HTTP Request node: `POST http://personal-logger:3000/api/ingest` (internal Docker network), header `X-Ingest-Secret: <INGEST_SECRET>`, body `{ amount, date, description, type, balance }`. `uid` and `secret` fields are no longer needed.

## Server data
`~/Claude projects/personal-logger/data/state.json` (current), `backups/state-YYYYMMDD.json` (one per day, last 14), `sessions.json` (login tokens, 90 days).

## Changes from the old app
- Google sign-in replaced by one passphrase; Firebase push (FCM) dropped. On-open reminders still work.
- Edits from two devices or a bank-feed ingest during an edit are merged per item, not last-write-wins.
- Fixed: full-snapshot PDF always showed 0 leave taken; Excel car sheet had empty mileage/notes; receivable rows showed "AED AED".
