// The single app state object `S`, its local cache, and undo/redo.
// Other modules read the live binding `S`; only this module reassigns it.
import { DEFAULT_SERVICE_TYPES, LS_KEY } from './constants.js';

export function emptyState() {
  return {
    settings: { currency: 'AED', salaryDay: 25, salaryAmount: 0, joinDate: '2020-02-12', basicSalary: 2490, notifyEnabled: false, remitCurrency: 'INR', emergencyMonths: 3 },
    accounts: {
      mashreq:  { name: 'Mashreq',   type: 'bank',   balance: 0,    balanceDate: '' },   // primary bank (bank feed)
      enbd_cc:  { name: 'ENBD CC',   type: 'credit', balance: 0,    balanceDate: '', limit: 15000 },
      noon_cc:  { name: 'NOON CC',   type: 'credit', balance: 0,    balanceDate: '', limit: 14999 },
    },
    recurring: [
      { id: 'rent',      name: 'House rent',            amount: 2300, cat: 'Rent',              day: 1,  active: true },
      { id: 'parking',   name: 'Car parking',           amount: 220,  cat: 'Salik / Parking',   day: 1,  active: true },
      { id: 'carwash',   name: 'Car washing',           amount: 70,   cat: 'Car',               day: 1,  active: true },
      { id: 'wife_allow',name: "Wife's household",      amount: 1000, cat: 'Family / Remittance', day: 25, active: true },
    ],
    renewals: [],
    serviceTypes: DEFAULT_SERVICE_TYPES.map(t => ({ ...t })),
    serviceLog: [],
    expenses: [],
    incomes: [],
    budgets: {},
    vacations: [],
    remittances: [],
    fuelLog: [],
    salik: { balance: 0, date: '', threshold: 50 },
    leaveSettings: { entitlementDays: 23, carryForward: 0 },
    leaveLog: [],
    loans: [],
    loanPayments: [],
    loansGiven: [],
    loansGivenPayments: [],
    borrowedFromFriends: [],
    borrowedPayments: [],
    homeObligations: [],
    subscriptions: [],
    transfers: [],
    indiaAccounts: [],
    indiaTxns: [],
    merchantRules: [],
  };
}

// Merge over defaults so older or partial backups can't leave keys missing
export function normalize(data) { return Object.assign(emptyState(), data || {}); }

function loadLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) { console.error('load failed', e); }
  return emptyState();
}

export let S = loadLocal();
export const hadLocalCache = (() => { try { return !!localStorage.getItem(LS_KEY); } catch { return false; } })();

// Listeners notified after every local change (sync pushes, sync bar redraws)
const listeners = [];
export function onSave(fn) { listeners.push(fn); }

function persistLocal() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) { console.error('cache write failed', e); }
}

// Replace S wholesale (server load, import, wipe). Does not push or record history.
export function replaceState(data) {
  S = normalize(data);
  persistLocal();
}

const UNDO_LIMIT = 30;
export const undoStack = [];
export const redoStack = [];

export function save(pushHistory = true) {
  if (pushHistory) {
    undoStack.push(JSON.stringify(S));
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack.length = 0;
  }
  persistLocal();
  for (const fn of listeners) fn();
}

export function undo() {
  if (!undoStack.length) return false;
  redoStack.push(JSON.stringify(S));
  S = normalize(JSON.parse(undoStack.pop()));
  save(false);
  return true;
}
export function redo() {
  if (!redoStack.length) return false;
  undoStack.push(JSON.stringify(S));
  S = normalize(JSON.parse(redoStack.pop()));
  save(false);
  return true;
}
