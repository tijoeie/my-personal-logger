// Modal form in the shared <dialog>. onSubmit mutates S; saving and redraw follow.
import { save } from '../core/state.js';
import { esc } from '../core/util.js';
import { render } from './shell.js';

export function openForm(title, fields, onSubmit, submitLabel) {
  const dlg = document.getElementById('dlg');
  dlg.innerHTML = `<h3>${esc(title)}</h3><form id="dlgForm">
    ${fields.map(f => {
      if (f.type === 'select') {
        return `<div class="field"><label>${esc(f.label)}</label><select name="${f.name}">${f.options.map(o => `<option value="${esc(o.v)}"${o.v === f.value ? ' selected' : ''}>${esc(o.t)}</option>`).join('')}</select></div>`;
      }
      return `<div class="field"><label>${esc(f.label)}</label><input name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" ${f.required ? 'required' : ''} ${f.step ? `step="${f.step}"` : ''} placeholder="${esc(f.placeholder || '')}"></div>`;
    }).join('')}
    <div class="dlg-actions">
      <button type="button" class="btn" id="dlgCancel">Cancel</button>
      <button type="submit" class="btn primary">${esc(submitLabel || 'Save')}</button>
    </div></form>`;
  dlg.showModal();
  dlg.querySelector('#dlgCancel').onclick = () => dlg.close();
  dlg.querySelector('#dlgForm').onsubmit = (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
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
