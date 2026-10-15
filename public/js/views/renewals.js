// Renewals tab: subscriptions on top, document renewals below.
import { UAE_QUICKADD, SUB_QUICKADD, SUB_CURRENCIES, PAY_METHODS, PERSON_OPTIONS, CYCLE_OPTIONS } from '../core/constants.js';
import { S, save } from '../core/state.js';
import { esc, uid, money, today, iso, daysUntil, fmtDate } from '../core/util.js';
import { payLabel, currSym, subMonthlyAED, toAED } from '../domain/finance.js';
import { groupCharges, paidThisCycle, nextChargeDate, guessName } from '../domain/subscriptions.js';
import { statusOf } from '../domain/schedule.js';
import { openForm, expose, confirmThen } from '../ui/form.js';
import { render } from '../ui/shell.js';

const fmtSubAmt = (amt, cur) => {
  const c = cur || 'AED';
  const [whole, dec] = Number(amt || 0).toFixed(2).split('.');
  return `${c === 'AED' ? 'AED' : currSym(c)} ${Number(whole).toLocaleString('en')}<span class="dec">.${dec}</span>`;
};
const ordSuffix = d => d == 1 ? 'st' : d == 2 ? 'nd' : d == 3 ? 'rd' : 'th';

function subRow(s, charges = []) {
  const cur = s.currency || 'AED';
  const aedMo = subMonthlyAED(s);
  const altCycle = s.cycle === 'annual'
    ? `${currSym(cur)} ${(Number(s.amount) / 12).toFixed(0)}/mo`
    : `${currSym(cur)} ${(Number(s.amount) * 12).toFixed(0)}/yr`;
  const aedNote = aedMo !== null && cur !== 'AED'
    ? ' · ≈ ' + money(s.cycle === 'annual' ? aedMo * 12 : aedMo) + (s.cycle === 'annual' ? '/yr' : '/mo') : '';
  const last = charges[0];
  const paid = s.status !== 'paused' && paidThisCycle(s, charges, iso(today()));
  const next = nextChargeDate(s, charges);
  const chargeLine = last
    ? `<div class="sub">Last charged ${fmtDate(last.date)} · ${money(last.amount)}${last.source === 'n8n' ? ' <span class="chip">🏦 bank</span>' : ''}${next ? ' · next ~' + fmtDate(next) : ''}</div>`
    : '<div class="sub">No charge seen yet</div>';
  return `
    <div class="row">
      <span style="font-size:20px;flex-shrink:0">${esc(s.icon || '📱')}</span>
      <div class="grow">
        <div class="title">${esc(s.name)} ${s.status === 'paused' ? '<span class="chip">Paused</span>' : ''}</div>
        <div class="sub">${s.cycle === 'annual' ? 'Annual' : 'Monthly'} · ${payLabel(s.payMethod)}${s.billingDay ? ' · ' + s.billingDay + ordSuffix(s.billingDay) : ''}${cur !== 'AED' ? ' · <b>' + esc(cur) + '</b>' : ''}${s.note ? ' · ' + esc(s.note) : ''}</div>
        ${chargeLine}
      </div>
      ${paid ? '<span class="badge ok">paid</span>' : ''}
      <div style="text-align:right;flex-shrink:0">
        <div class="amt">${fmtSubAmt(s.amount, cur)}</div>
        <div class="sub">${altCycle}${aedNote}</div>
      </div>
      ${paid ? '' : `<button class="btn small" onclick="logSubscriptionPayment('${s.id}')" title="Log this payment to expenses (for cards the bank feed can't see)">||</button>`}
      <button class="btn small" onclick="toggleSubStatus('${s.id}')" title="${s.status === 'paused' ? 'Resume' : 'Pause'}">${s.status === 'paused' ? '▶' : '⏸'}</button>
      <button class="btn small" onclick="editSubscription('${s.id}')">Edit</button>
      <button class="btn small danger" onclick="delSubscription('${s.id}')">✕</button>
    </div>`;
}

// Separate section: every subscription charge, grouped by service, plus charges not tracked yet
function paymentsPanel(subs, groups) {
  const tracked = subs.filter(s => (groups.bySub[s.id] || []).length);
  if (!tracked.length && !groups.untracked.length) return '';
  const year = String(today().getFullYear());
  const block = s => {
    const list = groups.bySub[s.id];
    const yearTotal = list.filter(e => e.date.startsWith(year)).reduce((a, e) => a + Number(e.amount), 0);
    return `<div class="sub-pay">
      <div class="title">${esc(s.icon || '📱')} ${esc(s.name)} <small class="hint">— ${list.length} charge${list.length !== 1 ? 's' : ''} · ${money(yearTotal)} in ${year}</small></div>
      ${list.slice(0, 6).map(e => `<div class="row"><div class="grow sub">${fmtDate(e.date)} · ${payLabel(e.payMethod)}${e.source === 'n8n' ? ' · 🏦 bank' : ''}${e.note && e.note !== s.name ? ' · ' + esc(e.note) : ''}</div><span class="amt">${money(e.amount)}</span></div>`).join('')}
    </div>`;
  };
  return `
  <div class="panel" style="margin-bottom:16px">
    <h2>Subscription payments <small>— picked up automatically from the bank feed</small></h2>
    ${tracked.map(block).join('')}
    ${groups.untracked.length ? `<div class="sub-pay">
      <div class="title">Not tracked yet <small class="hint">— subscription charges with no matching service</small></div>
      ${groups.untracked.slice(0, 10).map(e => `<div class="row"><div class="grow"><div class="title" style="font-size:13px">${esc(e.note || 'Subscription')}</div><div class="sub">${fmtDate(e.date)} · ${payLabel(e.payMethod)}</div></div><span class="amt">${money(e.amount)}</span><button class="btn small" onclick="trackCharge('${e.id}')">Track</button></div>`).join('')}
    </div>` : ''}
  </div>`;
}

const subQuickButtons = list => list.map(q => `<button onclick="addSubscriptionPreset(${SUB_QUICKADD.indexOf(q)})">${esc(q.icon)} ${esc(q.name)}</button>`).join('');

export function vRenewals() {
  const rows = [...S.renewals].sort((a, b) => (a.expiry || '9999').localeCompare(b.expiry || '9999'));
  const subs = S.subscriptions || [];
  const activeSubs = subs.filter(s => s.status !== 'cancelled');
  const groups = groupCharges(S.expenses, subs, toAED);

  let monthlyAED = 0, unknownRate = false;
  for (const s of activeSubs) {
    const m = subMonthlyAED(s);
    if (m === null) unknownRate = true; else monthlyAED += m;
  }
  const totalStr = activeSubs.length
    ? `~AED ${monthlyAED.toFixed(0)}/mo · ~AED ${(monthlyAED * 12).toFixed(0)}/yr${unknownRate ? ' (some rates unknown)' : ''}` : '';

  return `
  <div class="section-lbl">Subscriptions</div>
  <div class="toolbar" style="margin-bottom:8px">
    <button class="btn primary" onclick="addSubscription()">+ Add subscription</button>
    ${activeSubs.length ? `<span class="hint" style="margin-left:4px">${totalStr}</span>` : ''}
  </div>
  ${activeSubs.length || subs.some(s => s.status === 'cancelled') ? `
  <div class="panel" style="margin-bottom:16px">
    ${subs.length ? subs.map(x => subRow(x, groups.bySub[x.id])).join('') : '<div class="empty">No subscriptions yet.</div>'}
  </div>` : `
  <div class="panel" style="margin-bottom:16px">
    <div class="sub" style="margin-bottom:10px">Quick add common services:</div>
    <div class="quickadd">${subQuickButtons(SUB_QUICKADD)}</div>
  </div>`}
  ${paymentsPanel(subs, groups)}
  ${activeSubs.length ? `
  <div class="panel" style="margin-bottom:16px">
    <h2>Quick add more</h2>
    <div class="quickadd">${subQuickButtons(SUB_QUICKADD.filter(q => !subs.some(s => s.name === q.name))) || '<span class="hint">All common services added.</span>'}</div>
  </div>` : ''}

  <div class="section-lbl" style="margin-top:20px">Document renewals</div>
  <div class="toolbar">
    <button class="btn primary" onclick="addRenewal()">+ Add renewal</button>
  </div>
  <div class="panel">
    <h2>Quick add <small>— common UAE documents</small></h2>
    <div class="quickadd">${UAE_QUICKADD.map((q, i) => ({ q, i })).filter(({ q }) => !S.renewals.some(r => r.title === q.title))
      .map(({ q, i }) => `<button onclick="addRenewalPreset(${i})">+ ${esc(q.title)}</button>`).join('') || '<span class="hint">All common items added.</span>'}</div>
  </div>
  <div class="panel">
    ${rows.length ? rows.map(r => {
      const st = r.expiry ? statusOf(daysUntil(r.expiry), r.remindDays) : { cls: 'ok', label: 'no date' };
      const hist = (r.history || []).map(h => `<div class="sub">↻ renewed ${fmtDate(h.date)}${h.cost ? ' · ' + money(h.cost) : ''}</div>`).join('');
      const notifyOn = r.notify !== false;
      return `<div class="row">
        <div class="grow">
          <div class="title">${esc(r.title)} <span class="chip">${esc(r.person)}</span> <span class="chip">${esc(r.cat)}</span></div>
          <div class="sub">expires ${fmtDate(r.expiry)} · remind ${r.remindDays}d before</div>${hist}
        </div>
        <span class="badge ${st.cls}">${st.label}</span>
        <button class="btn small ${notifyOn ? 'notify-on' : 'notify-off'}" title="${notifyOn ? 'Reminders ON — click to turn off' : 'Reminders OFF — click to turn on'}" onclick="toggleRenewalNotify('${r.id}')"><i class="ti ti-bell${notifyOn ? '' : '-off'}" aria-hidden="true"></i></button>
        <button class="btn small" onclick="renewItem('${r.id}')">Renewed</button>
        <button class="btn small" onclick="editRenewal('${r.id}')">Edit</button>
        <button class="btn small danger" onclick="delRenewal('${r.id}')">✕</button>
      </div>`;
    }).join('') : '<div class="empty">No renewals tracked yet — use quick add above.</div>'}
  </div>`;
}

const renewalFields = (r = {}) => [
  { name: 'title', label: 'What is it?', value: r.title, required: true, placeholder: 'e.g. My residence visa' },
  { name: 'person', label: 'Whose?', type: 'select', value: r.person || 'Me', options: PERSON_OPTIONS },
  { name: 'cat', label: 'Category', value: r.cat || 'Other' },
  { name: 'expiry', label: 'Expiry date', type: 'date', value: r.expiry, required: true },
  { name: 'remindDays', label: 'Remind me (days before)', type: 'number', value: r.remindDays ?? 60 },
];
const subFields = (s = {}) => [
  { name: 'name',       label: 'Service name',     value: s.name || '', required: true, placeholder: 'e.g. Netflix' },
  { name: 'icon',       label: 'Icon (emoji)',     value: s.icon || '📱' },
  { name: 'currency',   label: 'Currency',         type: 'select', value: s.currency || 'AED', options: SUB_CURRENCIES },
  { name: 'amount',     label: 'Amount',           type: 'number', step: '0.01', value: s.amount, required: true },
  { name: 'cycle',      label: 'Billing cycle',    type: 'select', value: s.cycle || 'monthly', options: CYCLE_OPTIONS },
  { name: 'billingDay', label: 'Billing day (1–31)', type: 'number', value: s.billingDay || '', placeholder: 'e.g. 15' },
  { name: 'payMethod',  label: 'Charged to',       type: 'select', value: s.payMethod || 'enbd_cc', options: PAY_METHODS },
  { name: 'note',       label: 'Note (optional)',  value: s.note, placeholder: 'e.g. Family plan / Indian account' },
  { name: 'matchText',  label: 'Bank text contains (optional)', value: s.matchText, placeholder: 'e.g. netflix — only if auto-matching misses it' },
];
const subFromForm = d => ({
  name: d.name, icon: d.icon || '📱', currency: d.currency || 'AED',
  amount: Number(d.amount), cycle: d.cycle,
  billingDay: d.billingDay ? Number(d.billingDay) : null,
  payMethod: d.payMethod, note: d.note || '', matchText: (d.matchText || '').trim(),
});

function addRenewal(preset = {}) {
  openForm('Add renewal', renewalFields({ title: preset.title, person: preset.person, cat: preset.cat }),
    d => S.renewals.push({ id: uid(), ...d, remindDays: Number(d.remindDays) || 60, history: [] }));
}
function addSubscription(preset = {}) {
  openForm('Add subscription', subFields({ name: preset.name, icon: preset.icon, cycle: preset.cycle, payMethod: preset.payMethod, amount: preset.amount, billingDay: preset.billingDay, matchText: preset.matchText }), d => {
    (S.subscriptions = S.subscriptions || []).push({ id: uid(), ...subFromForm(d), status: 'active', cat: 'Subscriptions' });
  });
}

expose({
  addRenewal: () => addRenewal(),
  addRenewalPreset: i => addRenewal(UAE_QUICKADD[i]),
  editRenewal(id) {
    const r = S.renewals.find(x => x.id === id);
    openForm('Edit renewal', renewalFields(r), d => Object.assign(r, d, { remindDays: Number(d.remindDays) || 60 }));
  },
  renewItem(id) {
    const r = S.renewals.find(x => x.id === id);
    openForm(`Renewed: ${r.title}`, [
      { name: 'date', label: 'Renewed on', type: 'date', value: iso(today()), required: true },
      { name: 'expiry', label: 'New expiry date', type: 'date', required: true },
      { name: 'cost', label: 'Cost (optional)', type: 'number', step: '0.01' },
    ], d => {
      (r.history = r.history || []).push({ date: d.date, cost: d.cost });
      r.expiry = d.expiry;
      if (d.cost) S.expenses.push({ id: uid(), date: d.date, cat: 'Other', amount: Number(d.cost), note: `Renewal: ${r.title}` });
    }, 'Log renewal');
  },
  delRenewal: id => confirmThen('Delete this renewal?', () => { S.renewals = S.renewals.filter(r => r.id !== id); }),
  toggleRenewalNotify(id) {
    const r = S.renewals.find(x => x.id === id);
    if (r) { r.notify = r.notify === false; save(); render(); }
  },

  addSubscription: () => addSubscription(),
  addSubscriptionPreset: i => addSubscription(SUB_QUICKADD[i]),
  // Create a subscription from an untracked bank charge, pre-filled from the charge
  trackCharge(id) {
    const e = S.expenses.find(x => x.id === id);
    if (!e) return;
    const name = guessName(e.note);
    const word = String(e.note || '').toLowerCase().replace(/[^a-z0-9 .*/]/g, ' ').trim().split(/\s+/)[0] || '';
    addSubscription({ name, amount: e.amount, payMethod: e.payMethod || 'bank', cycle: 'monthly',
      billingDay: Number(e.date.slice(8, 10)), matchText: name.toLowerCase() === word ? '' : word, icon: '📱' });
  },
  editSubscription(id) {
    const s = (S.subscriptions || []).find(x => x.id === id);
    if (s) openForm('Edit subscription', subFields(s), d => Object.assign(s, subFromForm(d)));
  },
  toggleSubStatus(id) {
    const s = (S.subscriptions || []).find(x => x.id === id);
    if (!s) return;
    s.status = s.status === 'paused' ? 'active' : 'paused';
    save(); render();
  },
  delSubscription: id => confirmThen('Remove this subscription?', () => {
    S.subscriptions = (S.subscriptions || []).filter(x => x.id !== id);
  }),
  logSubscriptionPayment(id) {
    const s = (S.subscriptions || []).find(x => x.id === id);
    if (!s) return;
    if ((s.currency || 'AED') !== 'AED') {
      alert('Cannot log: INR/foreign currency subscription requires remittance rate. Add a rate in Remittance tab first.');
      return;
    }
    if (!confirm(`Log ${s.name} payment of ${money(s.amount)} to expenses?`)) return;
    S.expenses.push({ id: uid(), date: iso(today()), cat: s.cat || 'Other', amount: Number(s.amount), note: `${s.name}${s.cycle === 'annual' ? ' (annual)' : ''}`, payMethod: s.payMethod || 'bank', createdAt: Date.now() });
    save(); render();
  },
});
