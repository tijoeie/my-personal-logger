// Modal form in the shared <dialog>. onSubmit mutates S; saving and redraw follow.
import { save } from '../core/state.js';
import { esc, dmy, parseDmy } from '../core/util.js';
export { parseDmy };
import { render } from './shell.js';

// ---- dates are typed and shown as DD/MM/YYYY (the browser's own date box follows the phone's language) ----
// Text box that formats itself as you type, plus a calendar button that fills it from the native picker.
export function dateInput(name, isoValue, { required = false, id = '' } = {}) {
  return `<div class="date-wrap"><input ${id ? `id="${id}"` : ''} name="${name}" data-date="1" type="text" inputmode="numeric" autocomplete="off" maxlength="10" placeholder="DD/MM/YYYY" value="${esc(dmy(isoValue))}" ${required ? 'required' : ''}>
    <label class="date-pick" aria-label="Pick from calendar"><i class="ti ti-calendar" aria-hidden="true"></i><input type="date" tabindex="-1" data-date-native="1" value="${esc(isoValue || '')}"></label></div>`;
}
// One delegated listener serves every date box, in dialogs and on pages alike
if (typeof document !== 'undefined') {
  document.addEventListener('input', e => {
    const inp = e.target;
    if (!inp.matches || !inp.matches('input[data-date]')) return;
    const digits = inp.value.replace(/\D/g, '').slice(0, 8);
    inp.value = digits.length > 4 ? `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}` : digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
    inp.setCustomValidity('');
  });
  document.addEventListener('change', e => {
    const nat = e.target;
    if (!nat.matches || !nat.matches('input[data-date-native]')) return;
    const text = nat.parentElement.parentElement.querySelector('input[data-date]');
    if (text) { text.value = dmy(nat.value); text.setCustomValidity(''); }
  });
}
// Flags a typed date that is not a real DD/MM/YYYY; returns true when all are fine
export function checkDates(root) {
  let ok = true;
  root.querySelectorAll('input[data-date]').forEach(inp => {
    if (parseDmy(inp.value) === null) { inp.setCustomValidity('Enter a real date as DD/MM/YYYY'); inp.reportValidity(); ok = false; }
    else inp.setCustomValidity('');
  });
  return ok;
}

export function openForm(title, fields, onSubmit, submitLabel) {
  const dlg = document.getElementById('dlg');
  dlg.innerHTML = `<h3>${esc(title)}</h3><form id="dlgForm">
    ${fields.map(f => {
      if (f.type === 'select') {
        return `<div class="field"><label>${esc(f.label)}</label><select name="${f.name}">${f.options.map(o => `<option value="${esc(o.v)}"${o.v === f.value ? ' selected' : ''}>${esc(o.t)}</option>`).join('')}</select></div>`;
      }
      if (f.type === 'date') {
        return `<div class="field"><label>${esc(f.label)}</label>${dateInput(f.name, f.value, { required: f.required })}</div>`;
      }
      return `<div class="field"><label>${esc(f.label)}</label><input name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" ${f.required ? 'required' : ''} ${f.step ? `step="${f.step}"` : ''} ${f.type === 'number' ? `inputmode="decimal"` : ''} placeholder="${esc(f.placeholder || '')}"></div>`;
    }).join('')}
    <div class="dlg-actions">
      <button type="button" class="btn" id="dlgCancel">Cancel</button>
      <button type="submit" class="btn primary">${esc(submitLabel || 'Save')}</button>
    </div></form>`;
  dlg.showModal();
  dlg.querySelector('#dlgCancel').onclick = () => dlg.close();
  dlg.querySelector('#dlgForm').onsubmit = (e) => {
    e.preventDefault();
    if (!checkDates(e.target)) return;
    const data = Object.fromEntries(new FormData(e.target).entries());
    e.target.querySelectorAll('input[data-date]').forEach(inp => { data[inp.name] = parseDmy(inp.value); });
    dlg.close();
    onSubmit(data);
    save();
    render();
  };
}

// Inline onclick handlers in view templates call these globals
export function expose(handlers) { Object.assign(window, handlers); }

// Common "confirm, mutate, save, redraw" pattern for delete buttons
export function confirmThen(message, fn) {
  if (!confirm(message)) return;
  fn();
  save();
  render();
}
