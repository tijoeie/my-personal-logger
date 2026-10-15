// Link expenses (bank-feed charges or manual logs) to tracked subscriptions.
// Pure functions: callers pass the subscription list, expenses and an AED converter.

// Bank descriptors rarely contain the product name, so map known services to the
// text that appears on Mashreq alerts. Keys are matched against the subscription name.
export const BANK_ALIASES = [
  [/netflix/i, ['netflix']],
  [/youtube/i, ['youtube']],
  [/claude|anthropic/i, ['anthropic', 'claude']],
  [/amazon prime|prime video/i, ['amazon prime', 'prime video']],
  [/spotify/i, ['spotify']],
  [/disney/i, ['disney']],
  [/osn/i, ['osn']],
  [/playstation|ps plus/i, ['playstation', 'sony']],
  [/apple|icloud/i, ['apple.com/bill', 'apple.com']],
  [/chatgpt|openai/i, ['openai', 'chatgpt']],
];

// Lower-case fragments that identify this subscription's charges
export function matchKeys(sub) {
  const custom = String(sub.matchText || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (custom.length) return custom;
  const name = String(sub.name || '');
  const alias = BANK_ALIASES.find(([re]) => re.test(name));
  return [name.toLowerCase(), ...(alias ? alias[1] : [])].filter(Boolean);
}

// Best subscription for one expense, or null. An explicit subscriptionId wins; otherwise
// text must match, and among several matches (e.g. two Apple services) the closest amount wins.
export function matchCharge(e, subs, toAED = (a) => Number(a)) {
  if (e.subscriptionId) return subs.find(s => s.id === e.subscriptionId) || null;
  const text = String(e.note || '').toLowerCase();
  if (!text) return null;
  const hits = subs.filter(s => matchKeys(s).some(k => text.includes(k)));
  if (hits.length <= 1) return hits[0] || null;
  const amt = Number(e.amount);
  const diff = s => { const a = toAED(s.amount, s.currency); return a == null ? Infinity : Math.abs(a - amt); };
  return hits.sort((a, b) => diff(a) - diff(b))[0];
}

// Group subscription-looking expenses: { bySub: {id: [expenses newest first]}, untracked: [...] }.
// "Untracked" = categorised Subscriptions but not matching any tracked service.
export function groupCharges(expenses, subs, toAED) {
  const bySub = {}, untracked = [];
  for (const e of expenses) {
    const sub = matchCharge(e, subs, toAED);
    if (sub) (bySub[sub.id] = bySub[sub.id] || []).push(e);
    else if (e.cat === 'Subscriptions') untracked.push(e);
  }
  const newest = (a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0);
  for (const list of Object.values(bySub)) list.sort(newest);
  untracked.sort(newest);
  return { bySub, untracked };
}

// Has the current billing cycle been paid? Monthly: a charge in the last 25 days; annual: last 330.
export function paidThisCycle(sub, charges, todayISO) {
  const last = charges && charges[0];
  if (!last) return false;
  const days = (Date.parse(todayISO) - Date.parse(last.date)) / 86400000;
  return days <= (sub.cycle === 'annual' ? 330 : 25);
}

// Expected next charge date (ISO) from the last charge, or null
export function nextChargeDate(sub, charges) {
  const last = charges && charges[0];
  if (!last) return null;
  const d = new Date(last.date + 'T00:00:00');
  if (sub.cycle === 'annual') d.setFullYear(d.getFullYear() + 1); else d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Friendly name for an untracked charge, used to pre-fill "Track it"
export function guessName(note) {
  const t = String(note || '');
  const known = [[/netflix/i, 'Netflix'], [/youtube/i, 'YouTube Premium'], [/anthropic|claude/i, 'Claude Pro'],
    [/amazon prime/i, 'Amazon Prime'], [/spotify/i, 'Spotify'], [/disney/i, 'Disney+'], [/osn/i, 'OSN+'],
    [/playstation|sony/i, 'PlayStation Plus'], [/apple/i, 'Apple'], [/openai|chatgpt/i, 'ChatGPT']];
  const k = known.find(([re]) => re.test(t));
  if (k) return k[1];
  const word = t.replace(/[^A-Za-z0-9 .]/g, ' ').trim().split(/\s+/)[0] || 'Subscription';
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}
