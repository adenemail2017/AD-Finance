/** Global search — one box for transactions, accounts, debts, receivables, categories. */

import store from '../services/store.js';
import { searchAll, accountSummaries } from '../services/finance.js';
import { esc, on, qs } from '../utils/dom.js';
import { money, maskAccountNumber } from '../utils/format.js';
import { formatDate } from '../utils/date.js';
import { icon, iconTile } from '../components/icons.js';
import { badgeHtml, openOverlay } from '../components/ui.js';
import { txnRowHtml, openTransactionDetail } from '../components/ledger.js';

const SUGGESTIONS = ['Gaji', 'Makan', 'Transfer', 'Hutang', 'Piutang', 'Listrik', 'Investasi'];

export function openSearchOverlay(ctx) {
  const state = store.state;
  let debounceTimer = null;

  const api = openOverlay({
    title: 'Pencarian Global',
    iconName: 'search',
    size: 'md',
    body: `
      <div class="search-input-wrap" style="margin:calc(var(--s-5) * -1);margin-bottom:0">
        <div class="input-group">
          <span class="input-icon">${icon('search', { size: 18 })}</span>
          <input class="search-input" data-search-input placeholder="Cari transaksi, akun, hutang, piutang, nominal…" data-autofocus aria-label="Pencarian global" />
        </div>
        <div class="chip-row" data-suggestions>
          ${SUGGESTIONS.map((s) => `<button class="chip chip-static" data-suggest="${esc(s)}">${esc(s)}</button>`).join('')}
        </div>
      </div>
      <div class="search-results" data-results>
        <div class="search-group-label t-label">Mulai mengetik untuk mencari</div>
        <div class="t-xs t-dim" style="padding:0 var(--s-3)">
          Cari berdasarkan keterangan, kategori, akun, pihak, tag, atau nominal. Contoh: <strong>gaji</strong>, <strong>500000</strong>, <strong>budi</strong>.
        </div>
      </div>`,
    onMount(sheet, instance) {
      const input = qs('[data-search-input]', sheet);
      const results = qs('[data-results]', sheet);

      const run = () => {
        const query = input.value.trim();
        if (!query) {
          results.innerHTML = `<div class="search-group-label t-label">Mulai mengetik untuk mencari</div>
            <div class="t-xs t-dim" style="padding:0 var(--s-3)">Contoh: <strong>gaji</strong>, <strong>500000</strong>, <strong>budi</strong>.</div>`;
          return;
        }
        const found = searchAll(store.state, query, 6);
        const balances = accountSummaries(store.state);
        const groups = [];

        if (found.transactions.length) {
          groups.push(`<div class="search-group-label t-label">Transaksi (${found.transactions.length})</div>
            <div class="ledger">${found.transactions.map((t) => txnRowHtml(t, { state: store.state })).join('')}</div>`);
        }
        if (found.accounts.length) {
          groups.push(`<div class="search-group-label t-label">Akun (${found.accounts.length})</div>
            ${found.accounts.map((a) => `<button class="search-hit" data-account="${esc(a.id)}">
              ${iconTile(a.icon, { color: a.color, size: 36, radius: 11, iconSize: 18 })}
              <span class="grow"><span class="t-sm t-semibold" style="display:block">${esc(a.name)}</span>
                <span class="t-2xs t-dim">${esc(a.account_number ? maskAccountNumber(a.account_number) : a.institution || '')}</span></span>
              <span class="t-sm t-num t-bold">${esc(money(balances.find((b) => b.account.id === a.id)?.balance || 0))}</span>
            </button>`).join('')}`);
        }
        if (found.debts.length) {
          groups.push(`<div class="search-group-label t-label">Hutang (${found.debts.length})</div>
            ${found.debts.map((d) => `<button class="search-hit" data-debt="${esc(d.id)}">
              ${iconTile('hand-coins', { color: 'var(--warn)', size: 36, radius: 11, iconSize: 18 })}
              <span class="grow"><span class="t-sm t-semibold" style="display:block">${esc(d.counterparty)}</span>
                <span class="t-2xs t-dim">Hutang · ${esc(formatDate(d.start_date, { year: false }))}</span></span>
              <span class="t-sm t-num t-bold">${esc(money(d.principal))}</span>
            </button>`).join('')}`);
        }
        if (found.receivables.length) {
          groups.push(`<div class="search-group-label t-label">Piutang (${found.receivables.length})</div>
            ${found.receivables.map((r) => `<button class="search-hit" data-receivable="${esc(r.id)}">
              ${iconTile('file-text', { color: 'var(--info)', size: 36, radius: 11, iconSize: 18 })}
              <span class="grow"><span class="t-sm t-semibold" style="display:block">${esc(r.counterparty)}</span>
                <span class="t-2xs t-dim">Piutang · ${esc(r.due_date ? formatDate(r.due_date, { year: false }) : 'tanpa tenggat')}</span></span>
              <span class="t-sm t-num t-bold">${esc(money(r.principal))}</span>
            </button>`).join('')}`);
        }
        if (found.categories.length) {
          groups.push(`<div class="search-group-label t-label">Kategori (${found.categories.length})</div>
            <div class="row wrap gap-2" style="padding:0 var(--s-3)">
              ${found.categories.map((c) => `<button class="chip" data-category="${esc(c.id)}">
                ${iconTile(c.icon, { color: c.color, size: 20, radius: 6, iconSize: 12 })}${esc(c.name)}</button>`).join('')}
            </div>`);
        }

        results.innerHTML = groups.length
          ? groups.join('')
          : `<div class="search-group-label t-label">Tidak ada hasil</div>
             <div class="t-xs t-dim" style="padding:0 var(--s-3)">Tidak ditemukan data untuk "<strong>${esc(query)}</strong>".</div>`;
      };

      input.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(run, 140);
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          const first = qs('[data-txn-id]', results) || qs('.search-hit', results);
          first?.click();
        }
      });
      on(sheet, 'click', '[data-suggest]', (event, el) => { input.value = el.dataset.suggest; run(); });

      on(sheet, 'click', '[data-txn-id]', (event, el) => {
        instance.close();
        setTimeout(() => openTransactionDetail(el.dataset.txnId, { onChanged: () => ctx.rerender?.() }), 80);
      });
      on(sheet, 'click', '[data-account]', (event, el) => { instance.close(); ctx.navigate('accounts', { id: el.dataset.account }); });
      on(sheet, 'click', '[data-debt]', (event, el) => { instance.close(); ctx.navigate('debts', { id: el.dataset.debt, tab: 'hutang' }); });
      on(sheet, 'click', '[data-receivable]', (event, el) => { instance.close(); ctx.navigate('debts', { id: el.dataset.receivable, tab: 'receivables' }); });
      on(sheet, 'click', '[data-category]', (event, el) => { instance.close(); ctx.navigate('transactions', { categoryId: el.dataset.category, period: 'all' }); });
    },
  });
  return api;
}

export default { openSearchOverlay };
