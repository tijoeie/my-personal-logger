// Glance: one small screen with balance, today, this cycle and days to salary. It reads the saved sign-in from
// the main app (same origin) and shows the last snapshot instantly while it refreshes.
import { periodOf, nextSalaryDate } from './domain/periods.js';
import { bankBalance } from './domain/accounts.js';

const TOKEN_KEY = 'mpl_token', SNAP_KEY = 'mpl_glance';
const DAY = 86400000;
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const aed = n => 'AED ' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

export function snapshot(S, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = (S.settings || {}).salaryDay || 25;
  const p = periodOf(day, S.incomes, today);
  const spend = (S.expenses || []).filter(e => e.payMethod !== 'cc_payment' && !/^Reconciliation/i.test(e.note || ''));
  const sum = l => l.reduce((s, e) => s + Number(e.amount || 0), 0);
  const banks = Object.entries(S.accounts || {}).filter(([, a]) => a.type === 'bank' && !a.hidden).map(([id]) => bankBalance(S, id, parseISO)).filter(v => v !== null);
  const sal = nextSalaryDate(day, S.incomes, today);
  const due = (S.renewals || []).filter(r => r.expiry).map(r => ({ t: r.title, d: Math.round((parseISO(r.expiry) - today) / DAY) })).sort((a, b) => a.d - b.d)[0];
  const inr = (S.indiaAccounts || []).filter(a => !a.hidden && (a.currency || 'INR') === 'INR' && a.balance !== '' && a.balance != null).reduce((s, a) => s + Number(a.balance), 0);
  return {
    at: now.getTime(), balance: banks.length ? banks.reduce((a, b) => a + b, 0) : null,
    today: sum(spend.filter(e => e.date === iso(today))), cycle: sum(spend.filter(e => parseISO(e.date) >= p.start && parseISO(e.date) <= p.end)),
    income: sum((S.incomes || []).filter(i => parseISO(i.date) >= p.start && parseISO(i.date) <= p.end)),
    days: Math.max(0, Math.round((sal - today) / DAY)), due: due || null, inr,
    owed: (S.accounts ? Object.values(S.accounts).filter(a => a.type === 'credit').reduce((s, a) => s + Number(a.balance || 0), 0) : 0),
  };
}

function draw(s) {
  const left = s.income - s.cycle;
  document.getElementById('app').innerHTML = `
    <div class="top"><span>${new Date(s.at).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}</span><span>updated ${new Date(s.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span></div>
    <div class="hero"><div class="k">Bank balance</div><div class="v">${s.balance === null ? '—' : aed(s.balance)}</div><div class="s">${s.days === 0 ? 'Salary day' : s.days + ' days to salary'}${s.owed ? ' · cards owe ' + aed(s.owed) : ''}</div></div>
    <div class="grid">
      <div class="tile"><div class="k">Spent today</div><div class="v">${aed(s.today)}</div></div>
      <div class="tile"><div class="k">This cycle</div><div class="v">${aed(s.cycle)}</div><div class="s ${left >= 0 ? 'pos' : 'neg'}">${left >= 0 ? aed(left) + ' left of income' : aed(-left) + ' over income'}</div></div>
      ${s.due ? `<div class="tile wide"><div class="k">Next due</div><div class="v ${s.due.d < 0 ? 'neg' : s.due.d <= 14 ? 'warn' : ''}" style="font-size:19px">${esc(s.due.t)}</div><div class="s">${s.due.d < 0 ? 'expired ' + -s.due.d + ' days ago' : s.due.d === 0 ? 'today' : 'in ' + s.due.d + ' days'}</div></div>` : ''}
      ${s.inr ? `<div class="tile wide"><div class="k">India accounts</div><div class="v" style="font-size:21px">₹${s.inr.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div></div>` : ''}
    </div>
    <a class="open" href="./">Open the full app</a>`;
}

async function refresh() {
  const token = ls.get(TOKEN_KEY);
  if (!token) { document.getElementById('app').innerHTML = '<div class="msg">Open the full app once and sign in, then come back here.<br><br><a class="open" href="./">Open the app</a></div>'; return; }
  try {
    const r = await fetch('/api/state', { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' });
    if (r.status === 401) { document.getElementById('app').innerHTML = '<div class="msg">Signed out. <a class="open" href="./">Sign in</a></div>'; return; }
    const d = await r.json();
    const s = snapshot(d.state || d);
    ls.set(SNAP_KEY, JSON.stringify(s));
    draw(s);
  } catch { /* offline: keep the last snapshot on screen */ }
}

if (typeof document !== 'undefined') {
  try { const cached = JSON.parse(ls.get(SNAP_KEY) || 'null'); if (cached) draw(cached); } catch { /* ignore */ }
  refresh();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
