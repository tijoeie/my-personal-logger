// Telegram alerts worked out from the saved state: budget thresholds, unusually large charges and renewal
// reminders. computeAlerts() is pure; the endpoint marks what it returned in S.alertsSent so each alert goes out once.
import { periodOf } from '../public/js/domain/periods.js';
import { salaryPlan } from '../public/js/domain/plan.js';

const DAY = 86400000;
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const aed = n => 'AED ' + Math.round(Number(n || 0)).toLocaleString('en-US');
const QUIET = h => h >= 22 || h < 8;             // held until morning, not dropped
const NOT_SPENDING_HABIT = /^(Rent|Family \/ Remittance|Repayment|Loan EMI|Bank charges)$/;

export function computeAlerts(S, now = new Date(), extra = {}) {
  if (QUIET(now.getHours())) return [];
  const sent = S.alertsSent || {};
  const out = [];
  const add = (key, text) => { if (!sent[key]) out.push({ key, text }); };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = (S.settings || {}).salaryDay || 25;
  const p = periodOf(day, S.incomes, today), pk = iso(p.start);

  // ---- AED -> INR rate reached the target set in Settings (once a day) ----
  const target = Number((S.settings || {}).rateAlert);
  if (target > 0 && extra.rate >= target) add(`rate:${iso(today)}:${target}`, `💱 AED to INR is now ₹${extra.rate.toFixed(2)} (your target is ₹${target}). A good moment to send money home.`);

  // ---- salary plan: once, in the first 3 days after the salary lands ----
  if ((today - p.start) / DAY <= 3 && (S.incomes || []).some(i => /salary/i.test(i.note || '') && !/reconcil/i.test(i.note || '') && iso(parseISO(i.date)) === pk)) {
    const pl = salaryPlan(S, today);
    if (pl) add(`plan:${pk}`, [`💼 Salary plan for ${iso(p.start)}`, `Salary ${aed(pl.salary)}`,
      `Usually committed (rent, family, repayments, parking): ${aed(pl.committed)}`, `Everyday spending (3-cycle average): ${aed(pl.everyday)}`, `Cushion kept back: ${aed(pl.cushion)}`,
      pl.safe > 0 ? `✅ Safe to send home: about ${aed(pl.safe)}${pl.inr ? ` (~₹${pl.inr.toLocaleString('en-IN')} at ${pl.rate})` : ''}` : `⚠️ Nothing spare this cycle at your usual pace (${aed(Math.abs(Math.round(pl.left)))} short).`].join('\n'));
  }

  // ---- budgets: 80% and 100% of a category's limit this period ----
  const byCat = {};
  for (const e of S.expenses || []) {
    if (e.payMethod === 'cc_payment' || /^Reconciliation/i.test(e.note || '')) continue;
    const d = parseISO(e.date); if (d < p.start || d > p.end) continue;
    byCat[e.cat || 'Other'] = (byCat[e.cat || 'Other'] || 0) + Number(e.amount || 0);
  }
  for (const [cat, limit] of Object.entries(S.budgets || {})) {
    const b = Number(limit), used = byCat[cat] || 0;
    if (!(b > 0)) continue;
    if (used >= b) { add(`budget:${pk}:${cat}:100`, `🚨 ${cat} is over budget: ${aed(used)} of ${aed(b)} (${Math.round(used / b * 100)}%)`); sent[`budget:${pk}:${cat}:80`] ||= 'skipped'; }
    else if (used >= b * 0.8) add(`budget:${pk}:${cat}:80`, `⚠️ ${cat} has used ${Math.round(used / b * 100)}% of its budget: ${aed(used)} of ${aed(b)}, ${aed(b - used)} left`);
  }

  // ---- unusually large charge: at least AED 300 and 4x the usual payment, seen in the last 3 days ----
  const habit = (S.expenses || []).filter(e => e.payMethod !== 'cc_payment' && !NOT_SPENDING_HABIT.test(e.cat || '') && !/^Reconciliation/i.test(e.note || '') && now - parseISO(e.date) < 90 * DAY);
  for (const e of S.expenses || []) {
    if (e.source !== 'n8n' || e.payMethod === 'cc_payment' || NOT_SPENDING_HABIT.test(e.cat || '') || /^Reconciliation/i.test(e.note || '')) continue;
    if (now - (e.createdAt || 0) > 3 * DAY) continue;
    const others = habit.filter(x => x.id !== e.id).map(x => Number(x.amount)).sort((x, y) => x - y);
    const median = others.length ? others[Math.floor(others.length / 2)] : 0;
    if (Number(e.amount) < Math.max(300, median * 4)) continue;
    add(`large:${e.id}`, `💸 Large payment: ${aed(e.amount)} at ${e.note || e.cat || 'unknown'} (${e.date})`);
  }

  // ---- odd charges (bank-feed payments from the last 3 days): duplicates, price changes, first-time shops ----
  const shop = e => String(e.bankText || e.note || '').toLowerCase().replace(/[0-9]+/g, ' ').replace(/[^a-z]+/g, ' ').trim();
  const NOT_A_SHOP = /transfer|atm|charge|salary|reconcil/i;
  const feed = (S.expenses || []).filter(e => e.source === 'n8n' && e.payMethod !== 'cc_payment' && !e.linked && !NOT_SPENDING_HABIT.test(e.cat || '') && !NOT_A_SHOP.test(e.note || ''));
  const fresh = feed.filter(e => now - (e.createdAt || 0) < 3 * DAY);
  for (const e of fresh) {
    const key = shop(e), when = e.createdAt || 0;
    if (!key) continue;
    const earlier = feed.filter(x => x.id !== e.id && shop(x) === key && (x.createdAt || 0) < when);
    // same shop, amount and day, a short time apart: a card can be charged twice
    const twin = earlier.find(x => Math.abs(Number(x.amount) - Number(e.amount)) < 0.01 && x.date === e.date && when - (x.createdAt || 0) < 30 * 60000);
    if (twin) { add(`dup:${e.id}`, `👯 Possible duplicate charge: ${aed(e.amount)} at ${e.note} twice on ${e.date}. Worth checking with the bank if you only paid once.`); continue; }
    const last = earlier.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
    if (last && /Subscriptions|Telecom/.test(e.cat || '') && Math.abs(Number(e.amount) - Number(last.amount)) / Number(last.amount) > 0.02)
      add(`price:${e.id}`, `📈 Price change: ${e.note} was ${aed(last.amount)} last time and is ${aed(e.amount)} now (${e.amount > last.amount ? '+' : ''}${Math.round((e.amount - last.amount) / last.amount * 100)}%).`);
    else if (!last && feed.length >= 30 && Number(e.amount) >= 100)
      add(`new:${e.id}`, `🆕 First payment to a new place: ${aed(e.amount)} at ${e.note} (${e.date}).`);
  }

  // ---- renewals: 30, 7 and 1 day before, then once when overdue ----
  for (const r of S.renewals || []) {
    if (!r.expiry) continue;
    const days = Math.round((parseISO(r.expiry) - today) / DAY);
    const step = days < 0 ? 0 : days <= 1 ? 1 : days <= 7 ? 7 : days <= 30 ? 30 : null;
    if (step === null) continue;
    const key = `renew:${r.id || r.title}:${r.expiry}:${step}`;
    const label = `${r.title}${r.person ? ' (' + r.person + ')' : ''}`;
    const text = days < 0 ? `🔴 ${label} expired ${-days} day${days === -1 ? '' : 's'} ago (${r.expiry}). Renew it now.`
      : days === 0 ? `🔴 ${label} expires today.` : days === 1 ? `🟠 ${label} expires tomorrow (${r.expiry}).`
      : `${step === 7 ? '🟠' : '🟡'} ${label} expires in ${days} days (${r.expiry}).`;
    // reaching a closer step makes the farther ones moot
    for (const s of [30, 7, 1, 0]) if (s > step && !sent[`renew:${r.id || r.title}:${r.expiry}:${s}`]) sent[`renew:${r.id || r.title}:${r.expiry}:${s}`] = 'skipped';
    add(key, text);
  }
  return out;
}

// Mutates S: records the returned alerts (and any steps they made moot) as sent, and trims old marks.
export function markSent(S, alerts, now = new Date()) {
  const today = iso(now);
  S.alertsSent = S.alertsSent || {};
  for (const a of alerts) S.alertsSent[a.key] = today;
  const cutoff = iso(new Date(now - 400 * DAY));
  for (const [k, v] of Object.entries(S.alertsSent)) if (/^\d{4}-/.test(v) && v < cutoff) delete S.alertsSent[k];
}
