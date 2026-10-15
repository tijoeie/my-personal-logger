// Phone-only UI: bottom action sheet, compact rows (one ⋯ button instead of many),
// and the floating add button. Desktop keeps the inline buttons.
import { esc } from '../core/util.js';

export const isPhone = () => window.matchMedia('(max-width: 767px)').matches;

// items: [{ label, icon?, danger?, active?, onClick }]
export function openSheet(title, items) {
  closeSheet();
  const wrap = document.createElement('div');
  wrap.id = 'sheet';
  wrap.innerHTML = `<div class="sheet-backdrop"></div>
    <div class="sheet-panel" role="dialog" aria-label="${esc(title)}">
      <div class="sheet-grip"></div>
      ${title ? `<div class="sheet-title">${esc(title)}</div>` : ''}
      <div class="sheet-items">${items.map((it, i) => `<button class="sheet-item${it.danger ? ' danger' : ''}${it.active ? ' active' : ''}" data-i="${i}">${it.icon ? `<i class="ti ${it.icon}" aria-hidden="true"></i>` : ''}<span>${esc(it.label)}</span></button>`).join('')}</div>
      <button class="sheet-cancel">Cancel</button>
    </div>`;
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('open'));
  wrap.querySelector('.sheet-backdrop').onclick = closeSheet;
  wrap.querySelector('.sheet-cancel').onclick = closeSheet;
  wrap.querySelectorAll('.sheet-item').forEach(b => {
    b.onclick = () => { closeSheet(); items[Number(b.dataset.i)].onClick(); };
  });
}
export function closeSheet() { document.getElementById('sheet')?.remove(); }

// Readable label for an inline row button (some are icons or symbols on desktop)
function buttonLabel(b) {
  const text = b.textContent.trim();
  const map = { '✕': 'Delete', '||': 'Log payment', '⏸': 'Pause', '▶': 'Resume', '←': 'Back', '→': 'Forward' };
  if (map[text]) return map[text];
  if (text) return text;
  return b.getAttribute('title') || 'Action';
}

// On phones, rows with 2+ buttons get a single ⋯ that opens the same actions in a sheet.
// Tapping anywhere on the row does the same. The original buttons stay in the DOM (hidden)
// and are clicked for real, so every view keeps its own handlers.
export function compactRows(root) {
  if (!isPhone()) return;
  root.querySelectorAll('.row').forEach(row => {
    const buttons = [...row.children].filter(c => c.matches && c.matches('button.btn'));
    if (buttons.length < 2) return;
    row.classList.add('row-compact');
    const title = row.querySelector('.title')?.textContent.trim().split('\n')[0] || '';
    const open = () => openSheet(title, buttons.map(b => ({
      label: buttonLabel(b), danger: b.classList.contains('danger'), onClick: () => b.click(),
    })));
    const more = document.createElement('button');
    more.className = 'row-more';
    more.setAttribute('aria-label', 'Actions');
    more.innerHTML = '<i class="ti ti-dots" aria-hidden="true"></i>';
    more.onclick = (e) => { e.stopPropagation(); open(); };
    row.appendChild(more);
    row.addEventListener('click', (e) => { if (!e.target.closest('button, a, input, select, label')) open(); });
  });
}
