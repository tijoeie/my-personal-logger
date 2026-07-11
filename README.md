# My Personal Logger 🗓️

A private, no-account life assistant for expats in the UAE. Runs entirely in your browser — **your data never leaves your device** (stored in localStorage, with JSON export/import for backup).

**Live app:** https://tijoeie.github.io/my-personal-logger/

## Features

- **Renewals** — track expiry dates for residence visas, Emirates IDs, passports, driving license, car registration (Mulkiya), car & health insurance, tenancy contract (Ejari). One-tap quick-add for common UAE documents, color-coded reminders, renewal history with costs.
- **Car** — service schedule (oil change, coolant, annual service, inspection, tyres, battery, brakes, AC) with month/km intervals. Log a service and the next due date is computed automatically; costs flow into the expense tracker.
- **Expenses** — monthly tracker anchored to salary day (default the 25th), per-category budgets with progress bars, income logging, category and 6-period trend charts.
- **Vacation** — plan trips with a savings goal, log contributions, see the required monthly saving to hit the goal by the travel date.
- **Backup** — export/import all data as JSON from Settings.

## Running locally

No build step. Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8641
```

## Notes

- Data is per-browser/per-device. Export a backup before clearing browser data, and import it on a new device to migrate.
- Light and dark mode follow your system preference.
