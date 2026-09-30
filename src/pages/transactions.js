/**
 * Transactions — digital ledger (rekening koran pribadi).
 *
 * Layout rules that keep this page readable:
 *  1. One toolbar card: search + period + the applied filters, nothing else.
 *  2. Account / category / type live in a Filter sheet, and whatever is active
 *     shows up as a removable chip so the list is never silently filtered.
 *  3. A three-figure summary strip sits on top of the ledger.
 *  4. The ledger groups by day, shows a real running balance and paginates.
 */

import store from '../services/store.js';
import {
  accountSummaries, filterTransactions, runningBalanceMap, sortTransactions, txns,
} from '../services/finance.js';
import { TRANSACTION_TYPE_META, TRANSACTION_TYPES } from '../types/models.js';
import { esc, on, qs, qsa } from '../utils/dom.js';
import { money } from '../utils/format.js';
import {
  addDays, endOfMonthISO, formatDate, formatMonth, monthKey, monthOptions,
  parseMonthKey, startOfMonthISO, todayISO, toISO,
} from '../utils/date.js';
import { icon, iconTile } from '../components/icons.js';
import {
  badgeHtml, emptyState, fieldHtml, filterChip, moneyHtml, openAdaptive, statTile, toast,
} from '../components/ui.js';
import { ledgerHtml, openTransactionDetail, openTransactionForm } from '../components/ledger.js';
import { exportCSV, timestampedName } from '../utils/csv.js';
import { exportXLSX } from '../utils/xlsx.js';

const PERIOD_PRESETS = [
  { value: 'month', label: 'Bulan ini' },
  { value: 'prev-month', label: 'Bulan lalu' },
  { value: 'week', label: '7 Hari' },
  { value: 'today', label: 'Hari ini' },
  { value: 'year', label: 'Tahun ini' },
  { value: 'all', label: 'Semua' },
  { value: 'custom', label: 'Kustom' },
];

const PAGE_SIZE = 60;

function periodRange(preset, custom = {}) {
  const today = todayISO();
  switch (preset) {
    case 'today': return { from: today, to: today };
    case 'week': {
      const d = new Date();
      const dow = d.getDay() === 0 ? 6 : d.getDay() - 1; // monday-based
      return { from: addDays(today, -dow), to: today };
    }
    case 'month': return { from: startOfMonthISO(), to: endOfMonthISO() };
    case 'prev-month': {
      const d = new Date();
      d.setMonth(d.getMonth() - 1, 1);
      return { from: startOfMonthISO(d), to: endOfMonthISO(d) };
    }
    case 'year': return { from: `${new Date().getFullYear()}-01-01`, to: `${new Date().getFullYear()}-12-31` };
    case 'custom': return { from: custom.from || startOfMonthISO(), to: custom.to || today };
    default: return { from: '1970-01-01', to: today };
  }
}

const monthBounds = (value) => {
  const { year, month } = parseMonthKey(value);
  return { from: toISO(new Date(year, month, 1)), to: toISO(new Date(year, month + 1, 0)) };
};

export const transactionsPage = {
  id: 'transactions',
  title: 'Transactions',
  eyebrow: 'Buku Besar Digital',
  render(root, ctx) {
    const filters = {
      period: ctx.params?.period || 'month',
      from: ctx.params?.from || undefined,
      to: ctx.params?.to || undefined,
      month: ctx.params?.month || monthKey(),
      type: ctx.params?.type || 'all',
      accountId: ctx.params?.accountId || 'all',
      categoryId: ctx.params?.categoryId || 'all',
      search: ctx.params?.search || '',
      showBalance: true,
      sort: 'desc',
    };
    let shown = PAGE_SIZE;
    let cleanups = [];

    const state0 = store.state;
    const accountName = (id) => state0.accounts.find((a) => a.id === id)?.name || '';
    const categoryName = (id) => state0.categories.find((c) => c.id === id)?.name || '';

    root.innerHTML = `
      <div class="page-enter stack-4">
        <div class="page-head">
          <div>
            <h2>Transactions</h2>
            <p>Rekening koran pribadi — semua uang masuk, keluar, dan berpindah antar akun.</p>
          </div>
          <div class="page-head-actions">
            <button class="btn btn-outline" data-export>${icon('download', { size: 17 })} Ekspor</button>
            <button class="btn btn-primary" data-add>${icon('plus', { size: 17 })} Transaksi</button>
          </div>
        </div>

        <section class="card tool-card">
          <div class="tool-search">
            <div class="input-group">
              <span class="input-icon">${icon('search', { size: 17 })}</span>
              <input class="input" data-search type="search" placeholder="Cari keterangan, kategori, atau nominal…"
                value="${esc(filters.search)}" aria-label="Cari transaksi" />
            </div>
            <button class="btn btn-soft" data-open-filters>
              ${icon('filter', { size: 16 })} Filter <span class="badge badge-brand" data-filter-count hidden>0</span>
            </button>
          </div>

          <div class="tool-row is-split">
            <div class="period-scroll">
              <div class="segmented segmented-sm" data-periods role="tablist" aria-label="Rentang waktu">
                ${PERIOD_PRESETS.map((p) => `<button data-period="${p.value}" aria-selected="${p.value === filters.period}">${esc(p.label)}</button>`).join('')}
              </div>
            </div>
            <label class="row gap-2">
              <span class="tool-note t-nowrap">Bulan</span>
              <input class="input month-picker" type="month" data-month value="${esc(filters.month)}" aria-label="Pilih bulan" />
            </label>
          </div>

          <div class="row wrap gap-3" data-custom-range hidden>
            <input class="input" type="date" data-from value="${esc(filters.from || startOfMonthISO())}" aria-label="Dari tanggal" style="width:auto" />
            <span class="t-xs t-dim align-self-center">sampai</span>
            <input class="input" type="date" data-to value="${esc(filters.to || todayISO())}" aria-label="Sampai tanggal" style="width:auto" />
            <button class="btn btn-sm btn-soft" data-apply-range>Terapkan</button>
          </div>

          <div class="active-filters" data-active-filters></div>
        </section>

        <section class="card card-flush">
          <div class="list-head">
            <div class="lh-figures" data-summary></div>
            <div class="lh-actions">
              <button class="chip chip-static" data-toggle-balance aria-pressed="true"
                title="Tampilkan saldo berjalan di setiap baris">${icon('calculator', { size: 15 })} Saldo berjalan</button>
              <button class="btn btn-sm btn-ghost" data-sort title="Urutkan tanggal">
                ${icon('chevron-down', { size: 15 })} <span data-sort-label>Terbaru</span>
              </button>
            </div>
          </div>
          <div class="ledger" data-list></div>
          <div class="ledger-more" data-more hidden></div>
        </section>
      </div>
    `;

    /* ---------------- data ---------------- */

    const currentRange = () => {
      if (filters.period === 'custom' && filters.from && filters.to) return { from: filters.from, to: filters.to };
      if (filters.period === 'month' && filters.month !== monthKey()) return monthBounds(filters.month);
      return periodRange(filters.period, { from: filters.from, to: filters.to });
    };

    const currentList = () => {
      const range = currentRange();
      const list = filterTransactions(store.state, {
        from: range.from,
        to: range.to,
        types: filters.type === 'all' ? null : [filters.type],
        accountId: filters.accountId === 'all' ? null : filters.accountId,
        categoryId: filters.categoryId === 'all' ? null : filters.categoryId,
        search: filters.search,
      });
      return sortTransactions(list, filters.sort);
    };

    const activeFilters = () => {
      const items = [];
      if (filters.search) items.push({ key: 'search', label: 'Cari', value: `"${filters.search}"` });
      if (filters.accountId !== 'all') items.push({ key: 'account', label: 'Akun', value: accountName(filters.accountId) });
      if (filters.categoryId !== 'all') items.push({ key: 'category', label: 'Kategori', value: categoryName(filters.categoryId) });
      if (filters.type !== 'all') items.push({ key: 'type', label: 'Jenis', value: TRANSACTION_TYPE_META[filters.type]?.label || filters.type });
      if (filters.period === 'custom') items.push({ key: 'range', label: 'Periode', value: `${filters.from} → ${filters.to}` });
      return items;
    };

    /* ---------------- rendering ---------------- */

    function renderFilters() {
      const items = activeFilters();
      const host = qs('[data-active-filters]', root);
      host.innerHTML = items.length
        ? `${items.map((f) => filterChip({ label: f.label, value: f.value, action: `data-clear="${f.key}"` })).join('')}
           <button class="filter-chip-clear" data-reset>Hapus semua</button>`
        : '';

      const counter = qs('[data-filter-count]', root);
      const structural = items.filter((f) => f.key !== 'range').length;
      counter.hidden = structural === 0;
      counter.textContent = String(structural);

      qsa('[data-period]', root).forEach((btn) => btn.setAttribute('aria-selected', String(btn.dataset.period === filters.period)));
      qs('[data-custom-range]', root).hidden = filters.period !== 'custom';
      qs('[data-month]', root).value = filters.month;
    }

    function renderList() {
      const list = currentList();
      const range = currentRange();
      const listEl = qs('[data-list]', root);
      const summaryEl = qs('[data-summary]', root);
      const moreEl = qs('[data-more]', root);

      const inflow = ['income', 'receivable_payment', 'debt'];
      const outflow = ['expense', 'debt_payment', 'receivable'];
      const income = list.filter((t) => inflow.includes(t.transaction_type)).reduce((acc, t) => acc + t.amount, 0);
      const expense = list.filter((t) => outflow.includes(t.transaction_type)).reduce((acc, t) => acc + t.amount, 0);
      const net = income - expense;

      summaryEl.innerHTML = `
        <div class="lh-fig">
          <span class="lh-label">Masuk</span>
          ${moneyHtml(income, { tone: 'pos', sign: true, cls: 'lh-value' })}
        </div>
        <div class="lh-fig">
          <span class="lh-label">Keluar</span>
          ${moneyHtml(-expense, { cls: 'lh-value' })}
        </div>
        <div class="lh-fig">
          <span class="lh-label">Net</span>
          ${moneyHtml(net, { sign: true, cls: 'lh-value' })}
        </div>
        <div class="lh-fig lh-figure-wide">
          <span class="lh-label">Periode</span>
          <span class="lh-value t-xs">${esc(formatDate(range.from, { year: false }))} – ${esc(formatDate(range.to))}</span>
        </div>
        <div class="lh-fig lh-figure-wide">
          <span class="lh-label">Jumlah</span>
          <span class="lh-value t-xs">${list.length} transaksi</span>
        </div>`;

      if (!list.length) {
        listEl.innerHTML = emptyState({
          title: 'Belum ada transaksi pada filter ini',
          message: 'Ubah periode atau hapus filter, atau catat transaksi baru.',
          actionLabel: 'Tambah Transaksi',
          actionAttrs: 'data-add',
        });
        moreEl.hidden = true;
        return;
      }

      const visible = list.slice(0, shown);
      const running = filters.showBalance
        ? runningBalanceMap(store.state, { accountId: filters.accountId === 'all' ? null : filters.accountId })
        : null;

      listEl.innerHTML = ledgerHtml(visible, {
        showBalance: Boolean(running),
        balanceOf: running ? (t) => running.get(t.id) : null,
        state: store.state,
      });

      const remaining = list.length - visible.length;
      moreEl.hidden = remaining <= 0;
      if (remaining > 0) {
        moreEl.innerHTML = `<button class="btn btn-soft" data-more-btn>
          ${icon('chevron-down', { size: 16 })} Tampilkan ${Math.min(PAGE_SIZE, remaining)} lagi
          <span class="t-dim t-2xs">· sisa ${remaining}</span></button>`;
      }
    }

    const rerender = ({ reset = false } = {}) => {
      if (reset) shown = PAGE_SIZE;
      renderFilters();
      renderList();
    };

    /* ---------------- filter sheet ---------------- */

    function openFilters() {
      const state = store.state;
      const accounts = state.accounts.filter((a) => a.status !== 'archived');
      const categories = state.categories.filter((c) => !c.parent_id && !c.archived);
      openAdaptive({
        title: 'Filter Transaksi',
        subtitle: 'Persempit daftar berdasarkan akun, kategori, atau jenis transaksi',
        iconName: 'filter',
        size: 'sm',
        body: `
          <div class="stack-4">
            ${fieldHtml({
              label: 'Akun', name: 'f-account', id: 'f-account',
              control: `<select class="select" id="f-account" data-account>
                <option value="all">Semua akun</option>
                ${accounts.map((a) => `<option value="${esc(a.id)}"${a.id === filters.accountId ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}
              </select>`,
            })}
            ${fieldHtml({
              label: 'Kategori', name: 'f-category', id: 'f-category',
              control: `<select class="select" id="f-category" data-category>
                <option value="all">Semua kategori</option>
                ${categories.map((c) => `<option value="${esc(c.id)}"${c.id === filters.categoryId ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}
              </select>`,
            })}
            ${fieldHtml({
              label: 'Jenis transaksi', name: 'f-type', id: 'f-type',
              control: `<select class="select" id="f-type" data-type>
                <option value="all">Semua jenis</option>
                ${Object.values(TRANSACTION_TYPES).map((t) => `<option value="${t}"${t === filters.type ? ' selected' : ''}>${esc(TRANSACTION_TYPE_META[t].label)}</option>`).join('')}
              </select>`,
            })}
            <div class="row gap-2 wrap">
              <button class="btn btn-soft btn-sm" data-f-type="expense">${icon('trending-down', { size: 15 })} Hanya pengeluaran</button>
              <button class="btn btn-soft btn-sm" data-f-type="income">${icon('trending-up', { size: 15 })} Hanya pemasukan</button>
              <button class="btn btn-soft btn-sm" data-f-type="transfer">${icon('switch', { size: 15 })} Hanya transfer</button>
            </div>
          </div>`,
        footer: `<div class="row gap-2">
          <button class="btn btn-ghost" data-f-reset>Reset</button>
          <button class="btn btn-primary grow" data-f-apply>Terapkan filter</button>
        </div>`,
        onMount(sheet, api) {
          on(sheet, 'click', '[data-f-type]', (event, el) => { qs('[data-type]', sheet).value = el.dataset.fType; });
          on(sheet, 'click', '[data-f-reset]', () => {
            qs('[data-account]', sheet).value = 'all';
            qs('[data-category]', sheet).value = 'all';
            qs('[data-type]', sheet).value = 'all';
          });
          on(sheet, 'click', '[data-f-apply]', () => {
            filters.accountId = qs('[data-account]', sheet).value;
            filters.categoryId = qs('[data-category]', sheet).value;
            filters.type = qs('[data-type]', sheet).value;
            api.close('applied');
            rerender({ reset: true });
            const count = activeFilters().filter((f) => f.key !== 'range').length;
            toast(count ? `${count} filter aktif.` : 'Filter dihapus.', { duration: 1800 });
          });
        },
      });
    }

    /* ---------------- events ---------------- */

    cleanups.push(on(root, 'click', '[data-txn-id]', (event, el) => {
      openTransactionDetail(el.dataset.txnId, {
        onChanged: () => { ctx.refreshShell?.(); rerender(); },
        balances: null,
      });
    }));

    cleanups.push(on(root, 'click', '[data-add]', () => openTransactionForm({
      onSaved: () => { ctx.refreshShell?.(); rerender({ reset: true }); },
    })));

    cleanups.push(on(root, 'click', '[data-open-filters]', openFilters));

    cleanups.push(on(root, 'click', '[data-period]', (event, el) => {
      const next = el.dataset.period;
      filters.period = next;
      if (next !== 'custom') { filters.from = undefined; filters.to = undefined; }
      if (next === 'month') filters.month = monthKey();
      rerender({ reset: true });
    }));

    cleanups.push(on(root, 'change', '[data-month]', (event, el) => {
      if (!el.value) return;
      filters.month = el.value;
      filters.period = 'month';
      rerender({ reset: true });
    }));

    cleanups.push(on(root, 'click', '[data-apply-range]', () => {
      const from = qs('[data-from]', root).value;
      const to = qs('[data-to]', root).value;
      if (!from || !to) { toast('Lengkapi tanggal mulai dan akhir.', { tone: 'warn' }); return; }
      if (from > to) { toast('Tanggal mulai harus lebih awal dari tanggal akhir.', { tone: 'warn' }); return; }
      filters.from = from;
      filters.to = to;
      rerender({ reset: true });
    }));

    cleanups.push(on(root, 'input', '[data-search]', (event, el) => {
      filters.search = el.value;
      clearTimeout(window.__txnSearchTimer);
      window.__txnSearchTimer = setTimeout(() => rerender({ reset: true }), 180);
    }));

    cleanups.push(on(root, 'click', '[data-clear]', (event, el) => {
      const key = el.dataset.clear;
      if (key === 'search') { filters.search = ''; qs('[data-search]', root).value = ''; }
      if (key === 'account') filters.accountId = 'all';
      if (key === 'category') filters.categoryId = 'all';
      if (key === 'type') filters.type = 'all';
      if (key === 'range') { filters.period = 'month'; filters.from = undefined; filters.to = undefined; }
      rerender({ reset: true });
    }));

    cleanups.push(on(root, 'click', '[data-toggle-balance]', (event, el) => {
      filters.showBalance = !filters.showBalance;
      el.classList.toggle('is-active', filters.showBalance);
      el.setAttribute('aria-pressed', String(filters.showBalance));
      renderList();
    }));

    cleanups.push(on(root, 'click', '[data-sort]', () => {
      filters.sort = filters.sort === 'desc' ? 'asc' : 'desc';
      qs('[data-sort-label]', root).textContent = filters.sort === 'desc' ? 'Terbaru' : 'Terlama';
      renderList();
    }));

    cleanups.push(on(root, 'click', '[data-more-btn]', () => {
      shown += PAGE_SIZE;
      renderList();
    }));

    cleanups.push(on(root, 'click', '[data-reset]', () => {
      filters.period = 'month';
      filters.month = monthKey();
      filters.type = 'all';
      filters.accountId = 'all';
      filters.categoryId = 'all';
      filters.search = '';
      filters.from = undefined;
      filters.to = undefined;
      qs('[data-search]', root).value = '';
      toast('Filter direset.', { duration: 1600 });
      rerender({ reset: true });
    }));

    cleanups.push(on(root, 'click', '[data-export]', () => {
      const list = currentList();
      if (!list.length) { toast('Tidak ada transaksi untuk diekspor.', { tone: 'warn' }); return; }
      openExportSheet(list, currentRange());
    }));

    rerender();
    return () => cleanups.forEach((fn) => fn?.());
  },
};

/* ------------------------------------------------------------------ */
/* Export sheet                                                        */
/* ------------------------------------------------------------------ */

export function transactionColumns(state) {
  const accountName = (id) => state.accounts.find((a) => a.id === id)?.name || '';
  const catName = (id) => state.categories.find((c) => c.id === id)?.name || '';
  return [
    { key: 'date', label: 'Date', width: 12 },
    { key: 'time', label: 'Time', width: 8 },
    { key: 'type', label: 'Type', width: 16, value: (t) => TRANSACTION_TYPE_META[t.transaction_type]?.short || t.transaction_type },
    { key: 'description', label: 'Description', width: 30 },
    { key: 'category', label: 'Category', width: 18, value: (t) => catName(t.category_id) },
    { key: 'subcategory', label: 'Sub Category', width: 16, value: (t) => catName(t.subcategory_id) },
    { key: 'account', label: 'Account', width: 16, value: (t) => accountName(t.account_id) },
    { key: 'destination', label: 'Destination', width: 16, value: (t) => accountName(t.destination_account_id) },
    { key: 'counterparty', label: 'Counterparty', width: 16 },
    { key: 'amount', label: 'Amount', width: 14, style: 2, value: (t) => Number(t.amount) },
    { key: 'notes', label: 'Notes', width: 28 },
    { key: 'tags', label: 'Tags', width: 16, value: (t) => (t.tags || []).join(' ') },
  ];
}

export function openExportSheet(list, range) {
  const state = store.state;
  const label = `${formatDate(range.from)} — ${formatDate(range.to)}`;
  openAdaptive({
    title: 'Ekspor Transaksi',
    iconName: 'download',
    size: 'sm',
    body: `
      <div class="stack-4">
        <div class="banner">${icon('info', { size: 18 })}<div class="grow t-xs">${list.length} transaksi · ${esc(label)}</div></div>
        <div class="option-grid">
          <button class="option-tile" data-format="csv">${iconTile('file-text', { color: 'var(--brand-500)', size: 32, radius: 10, iconSize: 16 })}<span class="option-title">CSV</span><span class="option-sub">Excel / Sheets</span></button>
          <button class="option-tile" data-format="xlsx">${iconTile('file-chart', { color: 'var(--pos)', size: 32, radius: 10, iconSize: 16 })}<span class="option-title">Excel</span><span class="option-sub">.xlsx native</span></button>
          <button class="option-tile" data-format="json">${iconTile('layers', { color: 'var(--accent)', size: 32, radius: 10, iconSize: 16 })}<span class="option-title">JSON</span><span class="option-sub">Backup data</span></button>
          <button class="option-tile" data-format="pdf">${iconTile('printer', { color: 'var(--neg)', size: 32, radius: 10, iconSize: 16 })}<span class="option-title">PDF</span><span class="option-sub">Cetak / simpan</span></button>
        </div>
      </div>`,
    onMount(sheet, api) {
      on(sheet, 'click', '[data-format]', async (event, el) => {
        const format = el.dataset.format;
        const base = `transaksi-${range.from}-${range.to}`;
        const columns = transactionColumns(state);
        if (format === 'csv') {
          exportCSV(list, columns, `${base}.csv`);
          toast('File CSV diunduh.', { tone: 'pos' });
        } else if (format === 'xlsx') {
          exportXLSX([{ name: 'Transaksi', columns, rows: list }], `${base}.xlsx`);
          toast('File Excel diunduh.', { tone: 'pos' });
        } else if (format === 'json') {
          const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), range, rows: list }, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = `${base}.json`;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          toast('Backup JSON diunduh.', { tone: 'pos' });
        } else {
          api.close('print');
          toast('Siapkan cetak — pilih "Save as PDF".', { duration: 3200 });
          setTimeout(() => window.print(), 300);
        }
      });
    },
  });
}

export { timestampedName };
export default transactionsPage;
