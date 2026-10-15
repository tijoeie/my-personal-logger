// Static reference data shared by views and domain logic.

export const DAY = 86400000;
export const LS_KEY = 'mpl_v1';

export const DEFAULT_SERVICE_TYPES = [
  { id: 'oil',      name: 'Oil change',                  months: 6,  km: 10000 },
  { id: 'service',  name: 'Annual service',              months: 12, km: 15000 },
  { id: 'coolant',  name: 'Coolant change',              months: 24, km: 40000 },
  { id: 'inspect',  name: 'Car inspection (Tasjeel)',    months: 12, km: 0 },
  { id: 'tyres',    name: 'Tyre rotation / check',       months: 6,  km: 10000 },
  { id: 'battery',  name: 'Battery replacement',         months: 24, km: 0 },
  { id: 'brakes',   name: 'Brake pads check',            months: 12, km: 20000 },
  { id: 'ac',       name: 'AC service',                  months: 12, km: 0 },
];

export const EXPENSE_CATS = ['Rent', 'Groceries', 'DEWA / Utilities', 'Telecom / Internet', 'Fuel', 'Salik / Parking', 'Car', 'Dining out', 'Health', 'Shopping', 'Family / Remittance', 'Travel', 'Loan EMI', 'Subscriptions', 'Other'];
export const CAT_OPTIONS = EXPENSE_CATS.map(c => ({ v: c, t: c }));

export const UAE_QUICKADD = [
  { title: 'My residence visa',        cat: 'Visa',        person: 'Me' },
  { title: "Wife's residence visa",    cat: 'Visa',        person: 'Wife' },
  { title: 'My Emirates ID',           cat: 'Emirates ID', person: 'Me' },
  { title: "Wife's Emirates ID",       cat: 'Emirates ID', person: 'Wife' },
  { title: 'My passport',              cat: 'Passport',    person: 'Me' },
  { title: "Wife's passport",          cat: 'Passport',    person: 'Wife' },
  { title: 'Driving license',          cat: 'License',     person: 'Me' },
  { title: 'Car registration (Mulkiya)', cat: 'Car',       person: 'Shared' },
  { title: 'Car insurance',            cat: 'Car',         person: 'Shared' },
  { title: 'Health insurance',         cat: 'Insurance',   person: 'Shared' },
  { title: 'Tenancy contract (Ejari)', cat: 'Home',        person: 'Shared' },
];

export const SUB_QUICKADD = [
  { name: 'Netflix',          cycle: 'monthly',  payMethod: 'enbd_cc', icon: '🎬' },
  { name: 'Amazon Prime',     cycle: 'annual',   payMethod: 'enbd_cc', icon: '📦' },
  { name: 'YouTube Premium',  cycle: 'monthly',  payMethod: 'enbd_cc', icon: '▶️' },
  { name: 'Claude Pro',       cycle: 'monthly',  payMethod: 'enbd_cc', icon: '🤖' },
  { name: 'PlayStation Plus', cycle: 'annual',   payMethod: 'enbd_cc', icon: '🎮' },
  { name: 'Spotify',          cycle: 'monthly',  payMethod: 'enbd_cc', icon: '🎵' },
  { name: 'Apple Music',      cycle: 'monthly',  payMethod: 'enbd_cc', icon: '🎵' },
  { name: 'iCloud+',          cycle: 'monthly',  payMethod: 'enbd_cc', icon: '☁️' },
  { name: 'Disney+',          cycle: 'monthly',  payMethod: 'enbd_cc', icon: '🎬' },
  { name: 'OSN+',             cycle: 'monthly',  payMethod: 'enbd_cc', icon: '📺' },
];

// Payment methods come from the user's accounts: see domain/accounts.js payMethodOptions()

export const SUB_CURRENCIES = [
  { v: 'AED', t: 'AED – UAE Dirham' },
  { v: 'INR', t: 'INR – Indian Rupee (₹)' },
  { v: 'USD', t: 'USD – US Dollar ($)' },
  { v: 'EUR', t: 'EUR – Euro (€)' },
  { v: 'GBP', t: 'GBP – British Pound (£)' },
  { v: 'PKR', t: 'PKR – Pakistani Rupee' },
  { v: 'PHP', t: 'PHP – Philippine Peso' },
  { v: 'LKR', t: 'LKR – Sri Lankan Rupee' },
];

export const CURR_SYM = { AED: 'AED', INR: '₹', USD: '$', EUR: '€', GBP: '£', PKR: '₨', PHP: '₱', LKR: 'Rs', BDT: '৳', NPR: 'Rs', EGP: 'E£' };

export const REMIT_CURRENCIES = ['INR', 'PKR', 'PHP', 'LKR', 'BDT', 'NPR', 'EGP', 'USD', 'EUR', 'GBP', 'Other'];

export const PERSON_OPTIONS = [{ v: 'Me', t: 'Me' }, { v: 'Wife', t: 'Wife' }, { v: 'Shared', t: 'Shared' }];
export const FREQ_OPTIONS = [{ v: 'monthly', t: 'Monthly' }, { v: 'annual', t: 'Annual' }, { v: 'quarterly', t: 'Quarterly' }, { v: 'as needed', t: 'As needed' }];
export const CYCLE_OPTIONS = [{ v: 'monthly', t: 'Monthly' }, { v: 'annual', t: 'Annual' }];

export const TABS = [
  ['dashboard',  'Dashboard',  'ti-layout-dashboard'],
  ['expenses',   'Expenses',   'ti-receipt'],
  ['bankfeed',   'Bank Feed',  'ti-building-bank'],
  ['renewals',   'Renewals',   'ti-rotate-clockwise'],
  ['car',        'Car',        'ti-car'],
  ['vacation',   'Vacation',   'ti-plane'],
  ['remittance', 'Remittance', 'ti-send'],
  ['leave',      'Leave',      'ti-calendar-event'],
  ['loans',      'Loans',      'ti-credit-card'],
  ['gratuity',   'Gratuity',   'ti-award'],
  ['settings',   'Settings',   'ti-settings'],
];
