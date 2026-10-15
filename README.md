# My Personal Logger 🗓️

A private life assistant for expats in the UAE: renewals, car, expenses, bank feed, loans, remittance, leave, gratuity, vacation savings. It runs as a small self-hosted server (Node 22, no dependencies) in Docker, with one passphrase and all data in a JSON file on your own machine.

## Where things are

| Path | What |
|---|---|
| `server/` | HTTP server: static app, `/api/state` sync, `/api/ingest` bank feed, sessions, daily backups |
| `public/` | The PWA (native ES modules, no build step): `js/core`, `js/domain`, `js/ui`, `js/views`, `js/reports` |
| `n8n/` | Bank-alert workflow (IMAP → parse → `/api/ingest`) and the tested email parser |
| `deploy/arm/` | Compose stack for the ARM server (logger + n8n + Caddy HTTPS on the tailnet) |
| `Dockerfile`, `docker-compose.yml` | Build and run the logger container |
| `DEPLOY.md` | Deploy, migrate data, wire n8n |

## Features

Dashboard, Expenses (salary-period tracking, budgets, recurring payments, reconcile), Bank Feed (n8n), Renewals and subscriptions, Car (service schedule, fuel, Salik), Vacation goals, Remittance and home commitments, Leave, Loans (EMIs, borrowed, receivables), Gratuity, PDF/Excel reports, JSON backup/restore, undo/redo.

## Run locally

```sh
APP_PASSPHRASE=dev INGEST_SECRET=dev DATA_DIR=./data PUBLIC_DIR=public PORT=3010 node server/server.js
npm test
```

## Legacy

The files at the repo root (`index.html`, `app.js`, `style.css`, `sw.js`, `firebase-messaging-sw.js`, `vendor/`) are the previous browser-only app served by GitHub Pages (localStorage plus Firebase sync). They are kept only until the old Firebase project is deleted; the Cloud Functions code has been removed.
