// Indian bank accounts (NRE / NRO / FCNR / resident savings). Pure functions over plain data.
//
// S.indiaAccounts = [{ id, bank, type, last4?, branch?, ifsc?, currency ('INR' | 'USD' ...),
//                      balance, balanceDate, interestRate?, dashboard?, hidden?, note? }]
// S.indiaTxns     = [{ id, accountId, date, amount, kind: 'in' | 'out', note }]   amounts in account currency
// S.remittances[].toIndia = account id credited by a transfer from the UAE (amount = .foreign)

export const INDIAN_BANKS = [
  'State Bank of India', 'HDFC Bank', 'ICICI Bank', 'Axis Bank', 'Kotak Mahindra Bank',
  'Federal Bank', 'South Indian Bank', 'CSB Bank', 'Dhanlaxmi Bank', 'Canara Bank',
  'Bank of Baroda', 'Punjab National Bank', 'Union Bank of India', 'Indian Bank',
  'Indian Overseas Bank', 'Bank of India', 'IDFC FIRST Bank', 'IndusInd Bank', 'Yes Bank',
  'Kerala Gramin Bank', 'Other',
];

export const INDIA_TYPES = {
  NRE: {
    label: 'NRE savings', currency: 'INR',
    tip: 'Funded from abroad. Interest is tax-free in India and the full balance can be sent back abroad.',
  },
  NRO: {
    label: 'NRO savings', currency: 'INR',
    tip: 'For income earned in India (rent, dividends, pension). Interest is taxable, with TDS of about 30% plus cess; sending money abroad is capped at USD 1 million a year and needs Form 15CA/15CB.',
  },
  FCNR: {
    label: 'FCNR(B) deposit', currency: 'USD',
    tip: 'Fixed deposit kept in a foreign currency, so no rupee exchange risk. Interest is tax-free and fully repatriable; 1–5 year terms.',
  },
  SAVINGS: {
    label: 'Resident savings', currency: 'INR',
    tip: 'Ordinary resident account. Once you are an NRI it should be converted to NRO.',
  },
};

// Balance = anchor + money in (remittances credited + deposits) - money out, after the anchor date
export function indiaBalance(acc, remittances, txns, parse) {
  if (acc.balance == null || acc.balance === '' || !acc.balanceDate) return null;
  const since = parse(acc.balanceDate);
  const after = x => parse(x.date) >= since;
  const amt = list => list.reduce((s, x) => s + Number(x || 0), 0);
  const remitIn = amt((remittances || []).filter(r => r.toIndia === acc.id && after(r)).map(r => r.foreign));
  const ins = amt((txns || []).filter(t => t.accountId === acc.id && t.kind === 'in' && after(t)).map(t => t.amount));
  const outs = amt((txns || []).filter(t => t.accountId === acc.id && t.kind === 'out' && after(t)).map(t => t.amount));
  return Number(acc.balance) + remitIn + ins - outs;
}

// AED value using the most recent remittance rate for that currency (1 AED = rate foreign).
// Falls back to a typical rate so totals still make sense before any transfer is logged.
const FALLBACK_RATE = { INR: 23, USD: 0.2723, EUR: 0.25, GBP: 0.21 };
export function rateFor(currency, remittances) {
  const r = (remittances || []).filter(x => x.currency === currency && x.rate).sort((a, b) => b.date.localeCompare(a.date))[0];
  return r ? { rate: Number(r.rate), estimated: false } : { rate: FALLBACK_RATE[currency] || null, estimated: true };
}
export function toAED(amount, currency, remittances) {
  if (currency === 'AED') return Number(amount);
  const { rate } = rateFor(currency, remittances);
  return rate ? Number(amount) / rate : null;
}

// Totals per account type, in INR where possible, plus the AED value of everything
export function indiaTotals(accounts, remittances, txns, parse) {
  const out = { byType: {}, aed: 0, estimated: false, missing: 0 };
  for (const a of (accounts || []).filter(x => !x.hidden)) {
    const bal = indiaBalance(a, remittances, txns, parse);
    if (bal === null) { out.missing++; continue; }
    const cur = a.currency || 'INR';
    const t = out.byType[a.type] = out.byType[a.type] || { amount: 0, currency: cur, count: 0 };
    if (t.currency === cur) t.amount += bal;
    t.count++;
    const aed = toAED(bal, cur, remittances);
    if (aed !== null) out.aed += aed;
    if (rateFor(cur, remittances).estimated && cur !== 'AED') out.estimated = true;
  }
  return out;
}

export function maskIfsc(ifsc) {
  return String(ifsc || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11);
}
export const isValidIfsc = v => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(maskIfsc(v));

export function indiaLabel(a) {
  return `${a.bank} ${a.type === 'SAVINGS' ? 'Savings' : a.type}${a.last4 ? ' ••' + a.last4 : ''}`;
}

// ---- Indian debit / credit cards (reference records: bank, kind, last 4, linked account) ----
// S.indiaCards = [{ id, bank, kind: 'debit' | 'credit', last4?, network?, linkedTo? (india account id), limit?, note? }]
export const CARD_NETWORKS = ['RuPay', 'Visa', 'Mastercard', 'Amex', 'Other'];
export const cardLabel = c => `${c.bank} ${c.kind === 'credit' ? 'credit' : 'debit'} card${c.last4 ? ' ••' + c.last4 : ''}${c.network ? ' · ' + c.network : ''}`;
// cards that draw from this account (debit), newest first
export const cardsOf = (cards, accountId) => (cards || []).filter(c => c.kind === 'debit' && c.linkedTo === accountId);
