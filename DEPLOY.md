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

## Deploy on the monitor VM
Target: `~/personal-logger`, container `personal-logger`, bound to `127.0.0.1:3010`, published on the tailnet with HTTPS by Tailscale at
`https://oracle-monitor.tailcadf24.ts.net:8500`. Memory cap 160 MB (normal use about 40 MB).

```bash
# from this repo on the Mac
tar czf - server/server.js server/store.js server/ingest.js public Dockerfile docker-compose.yml .dockerignore .env.example \
  | ssh oracle-monitor 'mkdir -p ~/personal-logger && tar xzf - -C ~/personal-logger'

# on the VM (ssh oracle-monitor). Check `uptime` first: don't build while load is high.
cd ~/personal-logger
[ -f .env ] || { cp .env.example .env; chmod 600 .env
  sed -i "s/^APP_PASSPHRASE=.*/APP_PASSPHRASE=$(openssl rand -base64 18 | tr -d '/+=')/" .env
  sed -i "s/^INGEST_SECRET=.*/INGEST_SECRET=$(openssl rand -hex 24)/" .env; }
mkdir -p data && sudo chown 1000:1000 data       # container runs as node (uid 1000)
docker compose up -d --build
curl -s http://127.0.0.1:3010/healthz              # -> ok
sudo tailscale serve --bg --https=8500 http://127.0.0.1:3010
```
Read the passphrase with `ssh oracle-monitor cat ~/personal-logger/.env`. Never paste it in chat.

Update: re-run the tar line, then `docker compose up -d --build` and bump `public/version.json` so open apps reload.

## Data migration (keeps all history)
1. Old app (tijoeie.github.io/my-personal-logger): Settings > **Export backup (JSON)**. This file is the full Firestore copy.
2. New app: sign in with the passphrase > Settings > **Import backup** > confirm. All tabs, bank-feed entries, balances and history come across unchanged, because the format is identical.
3. Check balances and counts match on both apps, then on the phone: open the new URL in Safari > Share > Add to Home Screen (needs Tailscale on).
4. Point n8n at the new endpoint (below). Keep the old app read-only for a week, then delete the Firebase project.

## n8n (runs on the same VM)
HTTP Request node: `POST http://<docker-host>:3010/api/ingest` (the logger port is loopback-only, so put both containers on one Docker network and use `http://personal-logger:3000/api/ingest`), header `X-Ingest-Secret: <INGEST_SECRET>`, body `{ amount, date, description, type, balance }`. `uid` and `secret` fields are no longer needed.

## Server data
`~/personal-logger/data/state.json` (current), `backups/state-YYYYMMDD.json` (one per day, last 14), `sessions.json` (login tokens, 90 days).

## Changes from the old app
- Google sign-in replaced by one passphrase; Firebase push (FCM) dropped. On-open reminders still work.
- Edits from two devices or a bank-feed ingest during an edit are merged per item, not last-write-wins.
- Fixed: full-snapshot PDF always showed 0 leave taken; Excel car sheet had empty mileage/notes; receivable rows showed "AED AED".
