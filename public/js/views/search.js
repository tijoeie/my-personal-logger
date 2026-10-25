// Search tab: type in the box, results appear under it grouped by where they live.
import { S } from '../core/state.js';
import { esc, money, fmtDate } from '../core/util.js';
import { searchAll } from '../domain/search.js';
import { expose } from '../ui/form.js';

let last = '';

function results(q) {
  const r = searchAll(S, q);
  if (!q.trim()) return '<div class="panel"><div class="empty">Search anything: a shop, a category, an amount, a month, a person.<br><span class="hint">Try: noon · fuel oct · 500 · visa</span></div></div>';
  if (!r.total) return '<div class="panel"><div class="empty">Nothing found.</div></div>';
  return `<div class="hint" style="margin:6px 2px">${r.total} match${r.total > 1 ? 'es' : ''}</div>` + r.groups.map(g => `
    <div class="panel"><h2>${esc(g.label)} <small>— ${g.count}</small></h2>
    ${g.items.map(x => `<div class="row" onclick="switchTab('${g.tab}')" style="cursor:pointer">
      <div class="grow"><div class="title">${esc(x.title)}</div><div class="sub">${[x.date ? fmtDate(x.date) : '', esc(x.sub)].filter(Boolean).join(' · ')}</div></div>
      ${x.amount != null && !Number.isNaN(x.amount) ? `<span class="amt ${x.amount < 0 ? 'neg' : 'pos'}">${x.amount < 0 ? '−' : '+'}${money(Math.abs(x.amount))}</span>` : ''}</div>`).join('')}
    ${g.count > g.items.length ? `<div class="hint">and ${g.count - g.items.length} more in ${esc(g.label)}</div>` : ''}</div>`).join('');
}

export function vSearch() {
  setTimeout(() => { const i = document.getElementById('searchBox'); if (i && document.activeElement !== i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 30);
  return `<div class="panel"><div class="field" style="margin:0"><input id="searchBox" type="search" placeholder="Search expenses, income, renewals, loans…" value="${esc(last)}" oninput="runSearch(this.value)" autocomplete="off"></div></div>
  <div id="searchResults">${results(last)}</div>`;
}

expose({ runSearch(v) { last = v; const el = document.getElementById('searchResults'); if (el) el.innerHTML = results(v); } });
