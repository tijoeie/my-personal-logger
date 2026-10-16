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
Already imported on the server: workflow **Mashreq bank feed → Logger** (`n8n/workflow-mashreq-bank-feed.json`) and the credential **Logger ingest secret** (Header Auth `X-Ingest-Secret`, read from `.env` on the server).
Flow: Email Trigger (IMAP) → Parse Transaction (`n8n/parse-transaction.js`) → Parsed OK? → Send to Logger (`POST http://personal-logger:3000/api/ingest`) + Telegram (disabled until set up).
The trigger copies the one that already works on the old n8n: mailbox `INBOX`, action *Mark as Read*, format *Simple*, rule `["UNSEEN", ["FROM", "MashreqAlerts@mashreq.com"]]`. No Google Cloud OAuth is needed.

Live since 2026-10-16: published on the ARM n8n with the IMAP credential and Telegram credential attached. The 11-15 Oct alerts were replayed once (10 transactions). Parser notes: the IMAP trigger returns `textPlain` (card alerts) or only `textHtml` (account alerts), and account debits say "for" not "as"; `n8n/parse-transaction.js` handles all of these and dates account alerts from the email's own sent time.

To finish in the n8n UI (https://arm-server.tailcadf24.ts.net:9200):
1. Open the workflow, double-click **Email Trigger (IMAP)** > Credential > create *IMAP*: host `imap.gmail.com`, port `993`, SSL on, user = your Gmail address, password = a Gmail **app password** (Google Account > Security > 2-Step Verification > App passwords). The old n8n already has one saved as "IMAP account"; reuse that same app password.
2. Optional **Telegram**: add your bot credential, set the Chat ID, enable the node.
3. Click **Publish**. Saving or executing a step alone does not activate it.
4. Turn the old workflow off on the old server first, so each alert is processed only once (the IMAP rule uses UNSEEN, so whichever n8n reads first wins).
5. Check: the next Mashreq alert should appear in the logger's Bank Feed tab within about a minute.

## Federal Bank monthly statement -> Indian balances (n8n)
Workflow `n8n/workflow-federal-statement.json` ("Federal Bank statement → Logger (monthly)", imported but **not published**):
IMAP trigger (unread mail from fedmail@federal.bank.in with subject CONSOLIDATED STATEMENT) → Open PDF → Read statement (`n8n/parse-federal-statement.js`) → Read OK? → `POST /api/ingest-balance` → Telegram summary. Any failure (wrong password, layout change, balances not adding up to the statement's Savings total) sends a Telegram alert and changes nothing.
To switch on (the PDF password is typed by you, never by Claude):
1. Settings > Indian bank accounts: enter the last 4 digits of each account (until then accounts are matched by Federal Bank + branch name).
2. n8n > the workflow > **Open PDF** > Options > Password: the bank's rule is the first 4 letters of your name in capitals + date of birth as DDMM, no spaces.
3. Publish. It only reads *unread* mails, so the already-read 30-Sep-2026 statement is not re-processed; next month's is.
Server side: `server/india-ingest.js` (matches by last 4 or branch; never moves a balance to an older date; "already up to date" when nothing changed). Tests: `npm test` (server/test/india-ingest.test.js, n8n/test-federal-statement.js). The parser was also checked against n8n's own PDF reader on a password-protected test PDF.

## Safeguards and maintenance
- `/api/ingest` skips alerts dated more than 14 days ago (`INGEST_MAX_AGE_DAYS`, 0 disables). This stops a trigger that suddenly sees hundreds of old unread emails from flooding the logger (happened once on 2026-10-15; cleaned up).
- New bank debits get a category from the shop name (`server/categorize.js`); unmatched ones stay "Other".
- `server/tools/fix-feed.js` re-applies categories to existing "Other" feed entries (run with the logger stopped; see the file header).
- Telegram messages are plain text: Markdown broke on some shop names and stopped the run.

## Server data
`~/Claude projects/personal-logger/data/state.json` (current), `backups/state-YYYYMMDD.json` (one per day, last 14), `sessions.json` (login tokens, 90 days).

## Changes from the old app
- Google sign-in replaced by one passphrase; Firebase push (FCM) dropped. On-open reminders still work.
- Edits from two devices or a bank-feed ingest during an edit are merged per item, not last-write-wins.
- Fixed: full-snapshot PDF always showed 0 leave taken; Excel car sheet had empty mileage/notes; receivable rows showed "AED AED".
