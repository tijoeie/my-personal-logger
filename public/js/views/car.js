// Car tab: Salik tag, fuel log, service schedule and history.
import { S } from '../core/state.js';
import { esc, uid, money, moneyH, today, iso, daysUntil, fmtDate, sum } from '../core/util.js';
import { serviceNextDue, statusOf } from '../domain/schedule.js';
import { openForm, expose, confirmThen } from '../ui/form.js';

const km = n => Number(n).toLocaleString() + ' km';
const perL = f => (Number(f.amount) / Number(f.litres)).toFixed(2);

export function vCar() {
  const logs = [...S.serviceLog].sort((a, b) => b.date.localeCompare(a.date));
  const fuel = [...(S.fuelLog || [])].sort((a, b) => b.date.localeCompare(a.date));
  const salik = S.salik || { balance: 0, date: '', threshold: 50 };
  const low = salik.balance < salik.threshold;

  const monthKey = iso(today()).slice(0, 7);
  const fuelThisMonth = fuel.filter(f => f.date.startsWith(monthKey));
  const fuelMonthAED = sum(fuelThisMonth);
  const fuelMonthL = sum(fuelThisMonth, f => f.litres);
  const lastFuel = fuel[0];
  const withLitres = fuel.filter(f => f.litres);
  const avgPricePerL = withLitres.length ? sum(withLitres, f => Number(f.amount) / Number(f.litres)) / withLitres.length : 0;

  return `
  <div class="toolbar">
    <button class="btn primary" onclick="logService()">+ Log a service</button>
    <button class="btn" onclick="logFuel()">⛽ Log fuel</button>
    <button class="btn" onclick="addServiceType()">+ New service type</button>
  </div>

  <div class="panel">
    <h2>Salik / Toll tag</h2>
    <div class="row">
      <div class="grow">
        <div class="title">Tag balance <span class="chip ${low ? 'danger' : ''}">${low ? 'LOW' : 'OK'}</span></div>
        <div class="sub">${salik.date ? 'Updated ' + fmtDate(salik.date) : 'Not set'} · alert below AED ${salik.threshold}</div>
      </div>
      <span class="amt ${low ? 'neg' : ''}">AED ${salik.balance}</span>
      <button class="btn small" onclick="updateSalik()">Update</button>
      <button class="btn small" onclick="topUpSalik()">Top up</button>
    </div>
  </div>

  <div class="panel">
    <h2>Fuel log <small>— this month: ${money(fuelMonthAED)}${fuelMonthL ? ', ' + fuelMonthL.toFixed(0) + ' L' : ''}</small></h2>
    <div class="toolbar" style="margin-bottom:8px">
      ${lastFuel ? `<span class="hint">Last fill-up: ${fmtDate(lastFuel.date)} · ${money(lastFuel.amount)}${lastFuel.litres ? ' · ' + Number(lastFuel.litres).toFixed(1) + ' L · AED ' + perL(lastFuel) + '/L' : ''}</span>` : '<span class="hint">No fill-ups logged yet.</span>'}
      ${fuel.length >= 3 ? `<span class="hint">· avg price AED ${avgPricePerL.toFixed(2)}/L</span>` : ''}
    </div>
    ${fuel.slice(0, 10).map(f => `<div class="row">
      <div class="grow">
        <div class="title">${money(f.amount)}${f.litres ? ' · ' + Number(f.litres).toFixed(1) + ' L <span class="chip">AED ' + perL(f) + '/L</span>' : ''}</div>
        <div class="sub">${fmtDate(f.date)}${f.odo ? ' · ' + km(f.odo) : ''}${f.note ? ' · ' + esc(f.note) : ''}</div>
      </div>
      <button class="btn small danger" onclick="delFuel('${f.id}')">✕</button>
    </div>`).join('')}
    ${fuel.length > 10 ? `<div class="hint" style="padding:8px 0">Showing last 10 of ${fuel.length} entries.</div>` : ''}
  </div>
  <div class="panel">
    <h2>Service schedule</h2>
    ${S.serviceTypes.map(t => {
      const { last, due } = serviceNextDue(t);
      const st = due ? statusOf(daysUntil(due), 60) : null;
      return `<div class="row">
        <div class="grow">
          <div class="title">${esc(t.name)}</div>
          <div class="sub">every ${t.months} months${t.km ? ` or ${km(t.km)}` : ''}
            · ${last ? `last: ${fmtDate(last.date)}${last.odo ? ' @ ' + km(last.odo) : ''}` : 'never logged'}
            ${due ? ` · next: ${fmtDate(due)}` : ''}</div>
        </div>
        ${st ? `<span class="badge ${st.cls}">${st.label}</span>` : '<span class="badge ok">log first</span>'}
        <button class="btn small" onclick="logService('${t.id}')">Done today</button>
        <button class="btn small" onclick="editServiceType('${t.id}')">Edit</button>
      </div>`;
    }).join('')}
  </div>
  <div class="panel">
    <h2>Service history</h2>
    ${logs.length ? logs.map(l => {
      const t = S.serviceTypes.find(x => x.id === l.type);
      return `<div class="row">
        <div class="grow"><div class="title">${esc(t ? t.name : l.type)}</div>
        <div class="sub">${fmtDate(l.date)}${l.odo ? ' · ' + km(l.odo) : ''}${l.notes ? ' · ' + esc(l.notes) : ''}</div></div>
        ${l.cost ? `<span class="amt">${moneyH(l.cost)}</span>` : ''}
        <button class="btn small danger" onclick="delService('${l.id}')">✕</button>
      </div>`;
    }).join('') : '<div class="empty">No services logged yet.</div>'}
  </div>`;
}

expose({
  logFuel() {
    openForm('Log fuel fill-up ⛽', [
      { name: 'date', label: 'Date', type: 'date', value: iso(today()), required: true },
      { name: 'amount', label: 'Amount paid (AED)', type: 'number', step: '0.01', required: true },
      { name: 'litres', label: 'Litres (optional)', type: 'number', step: '0.01', placeholder: 'e.g. 40' },
      { name: 'odo', label: 'Odometer km (optional)', type: 'number' },
      { name: 'note', label: 'Note', placeholder: 'e.g. ENOC, ADNOC, full tank' },
    ], d => {
      S.fuelLog = S.fuelLog || [];
      S.fuelLog.push({ id: uid(), date: d.date, amount: Number(d.amount), litres: d.litres ? Number(d.litres) : 0, odo: d.odo ? Number(d.odo) : 0, note: d.note });
      S.expenses.push({ id: uid(), date: d.date, cat: 'Fuel', amount: Number(d.amount), note: d.note || 'Fuel fill-up', payMethod: 'bank' });
    }, 'Log it');
  },
  delFuel: id => confirmThen('Delete this fuel entry?', () => { S.fuelLog = S.fuelLog.filter(f => f.id !== id); }),

  updateSalik() {
    const s = S.salik || {};
    openForm('Update Salik balance', [
      { name: 'balance', label: 'Current Salik balance (AED)', type: 'number', step: '0.01', value: s.balance || '', required: true },
      { name: 'threshold', label: 'Warn me when below (AED)', type: 'number', value: s.threshold || 50 },
    ], d => { S.salik = { balance: Number(d.balance), date: iso(today()), threshold: Number(d.threshold) || 50 }; }, 'Save');
  },
  topUpSalik() {
    const s = S.salik || {};
    openForm('Top up Salik ⛽', [
      { name: 'amount', label: 'Top-up amount (AED)', type: 'number', step: '0.01', required: true },
      { name: 'date', label: 'Date', type: 'date', value: iso(today()), required: true },
    ], d => {
      S.salik = { ...s, balance: Number(s.balance || 0) + Number(d.amount), date: d.date };
      S.expenses.push({ id: uid(), date: d.date, cat: 'Salik / Parking', amount: Number(d.amount), note: 'Salik top-up', payMethod: 'bank' });
    }, 'Top up');
  },

  logService(typeId) {
    openForm('Log a service', [
      { name: 'type', label: 'Service', type: 'select', value: typeId, options: S.serviceTypes.map(t => ({ v: t.id, t: t.name })) },
      { name: 'date', label: 'Date', type: 'date', value: iso(today()), required: true },
      { name: 'odo', label: 'Odometer (km, optional)', type: 'number' },
      { name: 'cost', label: 'Cost (optional)', type: 'number', step: '0.01' },
      { name: 'notes', label: 'Notes (garage, parts…)', placeholder: 'optional' },
    ], d => {
      S.serviceLog.push({ id: uid(), ...d });
      if (d.cost) S.expenses.push({ id: uid(), date: d.date, cat: 'Car', amount: Number(d.cost), note: (S.serviceTypes.find(t => t.id === d.type) || {}).name || 'Car service' });
    }, 'Log it');
  },
  addServiceType() {
    openForm('New service type', [
      { name: 'name', label: 'Name', required: true, placeholder: 'e.g. Transmission fluid' },
      { name: 'months', label: 'Interval (months)', type: 'number', value: 12, required: true },
      { name: 'km', label: 'Interval (km, optional)', type: 'number' },
    ], d => S.serviceTypes.push({ id: uid(), name: d.name, months: Number(d.months), km: Number(d.km) || 0 }));
  },
  editServiceType(id) {
    const t = S.serviceTypes.find(x => x.id === id);
    openForm('Edit service type', [
      { name: 'name', label: 'Name', value: t.name, required: true },
      { name: 'months', label: 'Interval (months)', type: 'number', value: t.months, required: true },
      { name: 'km', label: 'Interval (km, optional)', type: 'number', value: t.km || '' },
    ], d => Object.assign(t, { name: d.name, months: Number(d.months), km: Number(d.km) || 0 }));
  },
  delService: id => confirmThen('Delete this log entry?', () => { S.serviceLog = S.serviceLog.filter(l => l.id !== id); }),
});
