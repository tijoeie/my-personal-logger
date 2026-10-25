// Jarvis: answers short questions sent to the personal Telegram bot ("balance?", "spent today?", "due?").
// answer() is pure over the saved state; startJarvis() long-polls Telegram from the server itself, because
// n8n sits behind the tailnet and Telegram cannot call it. Only the owner's chat id is ever answered.
import { periodOf, nextSalaryDate } from '../public/js/domain/periods.js';
import { bankBalance, isCredit } from '../public/js/domain/accounts.js';
import { buildSummary } from './summary.mjs';

const DAY = 86400000;
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const aed = n => 'AED ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const spendOnly = e => e.payMethod !== 'cc_payment' && !/^Reconciliation/i.test(e.note || '');

const HELP = `Hi, I'm Jarvis. Ask me:
• balance - bank, cards, India
• spent today / spent this week / spent this month
• due - renewals coming up
• salary - days to next salary
• budget - how your budgets stand
• owe - what you still owe friends
• rate - today's AED to INR
• summary - the weekly summary now`;

export async function answer(S, text, now = new Date(), getRate = null) {
  const q = String(text || '').toLowerCase().replace(/[?!.]/g, ' ').replace(/\s+/g, ' ').trim();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = (S.settings || {}).salaryDay || 25;
  const p = periodOf(day, S.incomes, today);
  const exps = (S.expenses || []).filter(spendOnly);
  const sum = l => l.reduce((s, e) => s + Number(e.amount || 0), 0);
  const has = (...w) => w.some(x => q.includes(x));

  if (!q || has('/start', 'help', 'hello', 'hi jarvis') || q === 'hi') return HELP;

  if (has('summary', 'report')) return buildSummary(S, now);

  if (has('balance', 'how much do i have', 'money left', 'bank')) {
    const banks = Object.entries(S.accounts || {}).filter(([, a]) => a.type === 'bank' && !a.hidden).map(([id, a]) => [a.name || id, bankBalance(S, id, parseISO)]).filter(([, v]) => v !== null);
    const cards = Object.entries(S.accounts || {}).filter(([id, a]) => isCredit(S.accounts, id) && !a.hidden).map(([id, a]) => `${a.name || id}: owes ${aed(a.balance)}`);
    const inr = (S.indiaAccounts || []).filter(a => !a.hidden && (a.currency || 'INR') === 'INR' && a.balance !== '' && a.balance != null);
    return ['💰 Balances', ...banks.map(([n, v]) => `${n}: ${aed(v)}`), ...cards,
      ...inr.map(a => `${a.bank} ${a.type}${a.last4 ? ' ••' + a.last4 : ''}: ₹${Number(a.balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })} (as of ${fmt(parseISO(a.balanceDate))})`)].join('\n');
  }

  if (has('today', 'yesterday')) {
    const d = has('yesterday') ? new Date(today - DAY) : today;
    const list = exps.filter(e => e.date === iso(d));
    if (!list.length) return `Nothing spent ${has('yesterday') ? 'yesterday' : 'today'} so far.`;
    return [`🧾 ${has('yesterday') ? 'Yesterday' : 'Today'}: ${aed(sum(list))} in ${list.length} payment${list.length > 1 ? 's' : ''}`, ...list.slice(0, 8).map(e => `• ${aed(e.amount)}  ${e.note || e.cat}`)].join('\n');
  }
  if (has('week')) {
    const from = iso(new Date(today - 6 * DAY)), list = exps.filter(e => e.date >= from && e.date <= iso(today));
    return `🗓️ Last 7 days: ${aed(sum(list))} in ${list.length} payments (${aed(sum(list) / 7)}/day)`;
  }
  if (has('month', 'cycle', 'period', 'spent', 'spending', 'so far')) {
    const list = exps.filter(e => parseISO(e.date) >= p.start && parseISO(e.date) <= p.end);
    const income = sum((S.incomes || []).filter(i => parseISO(i.date) >= p.start && parseISO(i.date) <= p.end));
    const byCat = {}; for (const e of list) byCat[e.cat || 'Other'] = (byCat[e.cat || 'Other'] || 0) + Number(e.amount);
    const top = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, v]) => `${c} ${aed(v)}`).join(', ');
    return `📊 This cycle (${fmt(p.start)} - ${fmt(p.end)}): spent ${aed(sum(list))}, income ${aed(income)}\nTop: ${top || 'nothing yet'}`;
  }

  if (has('due', 'renew', 'expir')) {
    const items = (S.renewals || []).filter(r => r.expiry).map(r => ({ t: r.title, d: Math.round((parseISO(r.expiry) - today) / DAY), x: r.expiry })).filter(r => r.d <= 60).sort((a, b) => a.d - b.d);
    return items.length ? ['📌 Coming up', ...items.map(r => `• ${r.t}: ${r.d < 0 ? 'expired ' + -r.d + ' days ago' : r.d === 0 ? 'today' : 'in ' + r.d + ' days'} (${r.x})`)].join('\n') : 'Nothing due in the next 60 days.';
  }

  if (has('salary', 'payday')) {
    const n = nextSalaryDate(day, S.incomes, today);
    return `💼 Next salary around ${fmt(n)} (${Math.max(0, Math.round((n - today) / DAY))} days). Your cycle started ${fmt(p.start)}.`;
  }

  if (has('budget')) {
    const byCat = {};
    for (const e of exps.filter(e => parseISO(e.date) >= p.start && parseISO(e.date) <= p.end)) byCat[e.cat || 'Other'] = (byCat[e.cat || 'Other'] || 0) + Number(e.amount);
    const rows = Object.entries(S.budgets || {}).filter(([, b]) => Number(b) > 0).map(([c, b]) => `• ${c}: ${aed(byCat[c] || 0)} of ${aed(b)} (${Math.round((byCat[c] || 0) / b * 100)}%)`);
    return rows.length ? ['🎯 Budgets this cycle', ...rows].join('\n') : 'No budgets set yet. Add them on the Expenses tab.';
  }

  if (has('owe', 'borrow', 'repay', 'loan')) {
    const rows = (S.borrowedFromFriends || []).map(b => ({ n: b.name, left: Number(b.total) - (S.borrowedPayments || []).filter(x => x.bId === b.id).reduce((a, x) => a + Number(x.amount), 0) })).filter(r => r.left > 0);
    return rows.length ? ['🤝 You still owe', ...rows.map(r => `• ${r.n}: ${aed(r.left)}`)].join('\n') : 'You owe nobody right now.';
  }

  if (has('rate', 'inr', 'rupee')) {
    try { const r = getRate ? await getRate() : null; return r ? `💱 1 AED = ₹${r.rate.toFixed(2)}` : 'Rate lookup is not available.'; }
    catch { return 'The rate feed is not answering right now.'; }
  }
  return `I did not get that.\n\n${HELP}`;
}

// Long-polls Telegram; only the owner's chat id gets an answer. Returns a stop function.
export function startJarvis({ token, chatId, getState, getRate, fetchImpl = fetch, log = console }) {
  let stopped = false, offset = 0;
  const api = (method, body, ms = 40000) => fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) }).then(r => r.json());
  (async () => {
    log.log('jarvis: listening for messages');
    while (!stopped) {
      try {
        const r = await api('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] });
        if (!r.ok) throw new Error(r.description || 'getUpdates failed');
        for (const u of r.result) {
          offset = u.update_id + 1;
          const m = u.message;
          if (!m || String(m.chat && m.chat.id) !== String(chatId) || !m.text) continue;
          const S = getState();
          const reply = S ? await answer(S, m.text, new Date(), getRate) : 'No data yet.';
          await api('sendMessage', { chat_id: chatId, text: reply });
        }
      } catch (e) {
        log.error('jarvis:', e.message);
        await new Promise(r => setTimeout(r, 8000));
      }
    }
  })();
  return () => { stopped = true; };
}
