/**
 * Reports — three views that each answer one question well:
 *   • Rekening Koran  → "apa yang terjadi di akun ini pada bulan ini?"
 *   • Laporan Bulanan → "bagaimana performa bulan ini?"
 *   • Rekap Bulanan   → "bagaimana tren bulan ke bulan?"
 *
 * Layout rules kept consistent with the Transactions page: one page head, one
 * toolbar card that never moves when tabs change, then titled sections.
 */

import store from '../services/store.js';
import {
  accountBreakdown, budgetUsage, buildStatement, categoryBreakdown,
  dailySeries, monthlySeries, netWorth, periodComparison, periodTotals, sortTransactions,
  spendingHeatmap, topMerchants, topTransactions, txns,
} from '../services/finance.js';
import { esc, on, qs, qsa } from '../utils/dom.js';
import { maskAccountNumber, money, percent } from '../utils/format.js';
import {
  endOfMonthISO, formatDate, formatMonth, monthKey, monthOptions,
  parseMonthKey, startOfMonthISO, toISO, todayISO,
} from '../utils/date.js';
import { icon, iconTile } from '../components/icons.js';
import {
  badgeHtml, emptyState, moneyHtml, openAdaptive, progressHtml, sectionDivider, statTile, toast,
} from '../components/ui.js';
import { animateCounters, legendItem } from '../components/cards.js';
import {
  attachChartTooltips, breakdownBars, donutChart, groupedBarChart, lineAreaChart,
} from '../components/charts.js';
import { exportCSV } from '../utils/csv.js';
import { exportXLSX } from '../utils/xlsx.js';
import { openExportSheet } from './transactions.js';
import { openTransactionDetail } from '../components/ledger.js';

const TABS = [
  { value: 'statement', label: 'Rekening Koran', icon: 'file-text' },
  { value: 'monthly', label: 'Laporan Bulanan', icon: 'file-chart' },
  { value: 'recap', label: 'Rekap Bulanan', icon: 'list' },
];

const TAB_HINT = {
  statement: 'Mutasi per akun lengkap dengan saldo berjalan — seperti rekening koran bank.',
  monthly: 'Ringkasan pemasukan, pengeluaran, rincian kategori, dan realisasi budget.',
  recap: 'Perbandingan bulan ke bulan: arus kas, alokasi, dan saldo akhir.',
};

export const reportsPage = {
  id: 'reports',
  title: 'Reports',
  eyebrow: 'Laporan & Rekening Koran',
  render(root, ctx) {
    let tab = ctx.params?.tab || 'statement';
    let accountId = ctx.params?.accountId || 'all';
    let period = ctx.params?.period || monthKey();
    let cleanups = [];

    function range() {
      const { year, month } = parseMonthKey(period);
      return { from: toISO(new Date(year, month, 1)), to: toISO(new Date(year, month + 1, 0)) };
    }

    function renderPage() {
      const state = store.state;
      const accounts = state.accounts.filter((a) => a.status !== 'archived');

      root.innerHTML = `
        <div class="page-enter stack-5">
          <div class="page-head no-print">
            <div>
              <h2>Reports</h2>
              <p>Rekening koran digital, laporan bulanan, dan rekap multi-bulan dalam satu tempat.</p>
            </div>
            <div class="page-head-actions">
              <button class="btn btn-outline" data-export>${icon('download', { size: 17 })} Ekspor</button>
              <button class="btn btn-dark" data-print>${icon('printer', { size: 17 })} Cetak / PDF</button>
            </div>
          </div>

          <section class="card tool-card no-print">
            <div class="tool-row is-split">
              <div class="period-scroll">
                <div class="segmented" data-tabs role="tablist" aria-label="Jenis laporan">
                  ${TABS.map((t) => `<button data-tab="${t.value}" aria-selected="${tab === t.value}">
                    ${icon(t.icon, { size: 15 })} ${esc(t.label)}</button>`).join('')}
                </div>
              </div>
              <div class="row gap-3 wrap">
                ${tab === 'statement' ? `
                  <label class="row gap-2">
                    <span class="tool-note t-nowrap">Akun</span>
                    <select class="select" data-account aria-label="Pilih akun" style="width:auto;min-width:170px">
                      <option value="all" ${accountId === 'all' ? 'selected' : ''}>Semua Akun (Portofolio)</option>
                      ${accounts.map((a) => `<option value="${esc(a.id)}" ${a.id === accountId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
                    </select>
                  </label>` : ''}
                <label class="row gap-2">
                  <span class="tool-note t-nowrap">Bulan</span>
                  <select class="select" data-period aria-label="Pilih bulan" style="width:auto;min-width:170px">
                    ${monthOptions(24).map((o) => `<option value="${esc(o.value)}" ${o.value === period ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
                  </select>
                </label>
              </div>
            </div>
          </section>

          <div data-panel></div>
        </div>
      `;

      const panel = qs('[data-panel]', root);
      if (tab === 'statement') renderStatement(panel, state, accountId, period, range());
      else if (tab === 'monthly') renderMonthly(panel, state, period, formatMonth(period), range());
      else renderRecap(panel, state);

      animateCounters(root);
      qsa('.chart-wrap', root).forEach((h) => attachChartTooltips(h));

      cleanups.forEach((fn) => fn?.());
      cleanups = bind();
    }

    function bind() {
      const state = store.state;
      return [
        on(root, 'click', '[data-tab]', (event, el) => { tab = el.dataset.tab; renderPage(); }),
        on(root, 'change', '[data-account]', (event, el) => { accountId = el.value; renderPage(); }),
        on(root, 'change', '[data-period]', (event, el) => { period = el.value; renderPage(); }),
        on(root, 'click', '[data-txn-id]', (event, el) => {
          openTransactionDetail(el.dataset.txnId, { onChanged: () => renderPage() });
        }),
        on(root, 'click', '[data-print]', () => {
          toast('Dialog cetak dibuka — pilih "Save as PDF".', { tone: 'info', duration: 4000 });
          setTimeout(() => window.print(), 350);
        }),
        on(root, 'click', '[data-export]', () => {
          const r = range();
          const list = sortTransactions(txns(state).filter((t) => t.date >= r.from && t.date <= r.to), 'desc');
          if (!list.length) { toast('Tidak ada transaksi pada periode ini.', { tone: 'warn' }); return; }
          openExportSheet(list, r);
        }),
        on(root, 'click', '[data-export-statement]', () => {
          const r = range();
          const statement = buildStatement(state, { accountId: accountId === 'all' ? null : accountId, from: r.from, to: r.to });
          const columns = [
            { key: 'date', label: 'Tanggal', width: 12 },
            { key: 'time', label: 'Jam', width: 8 },
            { key: 'type', label: 'Jenis', width: 18 },
            { key: 'description', label: 'Keterangan', width: 34 },
            { key: 'account', label: 'Akun', width: 18 },
            { key: 'debit', label: 'Debit', width: 14, style: 2 },
            { key: 'credit', label: 'Credit', width: 14, style: 2 },
            { key: 'balance', label: 'Saldo', width: 16, style: 2 },
          ];
          const rows = statement.rows.map((row) => ({
            date: row.txn.date,
            time: row.txn.time,
            type: row.txn.transaction_type,
            description: row.txn.description || row.txn.counterparty || '-',
            account: state.accounts.find((a) => a.id === (accountId === 'all' ? row.txn.account_id : accountId))?.name || '',
            debit: row.debit,
            credit: row.credit,
            balance: row.balance,
          }));
          openAdaptive({
            title: 'Ekspor Rekening Koran',
            iconName: 'download',
            size: 'sm',
            body: `<div class="stack-4">
              <div class="banner">${icon('info', { size: 18 })}<div class="grow t-xs">${statement.count} baris · saldo awal ${esc(money(statement.opening))} · saldo akhir ${esc(money(statement.closing))}</div></div>
              <div class="option-grid">
                <button class="option-tile" data-dl="csv">${iconTile('file-text', { size: 30, radius: 9, iconSize: 16 })}<span class="option-title">CSV</span></button>
                <button class="option-tile" data-dl="xlsx">${iconTile('file-chart', { size: 30, radius: 9, iconSize: 16 })}<span class="option-title">Excel</span></button>
              </div>
            </div>`,
            onMount(sheet, api) {
              on(sheet, 'click', '[data-dl]', (event, el) => {
                const name = `rekening-koran-${accountId === 'all' ? 'semua-akun' : accountId}-${period}`;
                if (el.dataset.dl === 'csv') exportCSV(rows, columns, `${name}.csv`);
                else exportXLSX([{ name: 'Statement', columns, rows }], `${name}.xlsx`);
                toast('Rekening koran diekspor.', { tone: 'pos' });
                api.close();
              });
            },
          });
        }),
      ];
    }

    /* ---------------- Statement ---------------- */

    function renderStatement(panel, state, accId, periodKey, r) {
      const statement = buildStatement(state, { accountId: accId === 'all' ? null : accId, from: r.from, to: r.to });
      const totals = periodTotals(state, r.from, r.to);
      const account = accId === 'all' ? null : state.accounts.find((a) => a.id === accId);
      const label = formatMonth(periodKey);
      const worth = netWorth(state);
      const periodText = `${formatDate(r.from)} – ${formatDate(r.to)}`;
      const balanced = Math.abs(statement.opening + statement.totalIn - statement.totalOut - statement.closing) < 0.01;

      panel.innerHTML = `
        <div class="stack-5">
          <div class="print-only print-head">
            <div class="ph-brand">
              <div class="ph-mark">AD</div>
              <div>
                <div class="ph-title">PERSONAL FINANCIAL STATEMENT</div>
                <div class="ph-sub">${esc(account ? account.name : 'Semua Akun (Portofolio)')}${account?.account_number ? ` · ${esc(maskAccountNumber(account.account_number))}` : ''}</div>
              </div>
            </div>
            <table class="ph-meta">
              <tr><th>Periode</th><td>${esc(periodText)}</td><th>Jumlah transaksi</th><td>${statement.count}</td></tr>
              <tr><th>Opening Balance</th><td>${esc(money(statement.opening))}</td><th>Closing Balance</th><td>${esc(money(statement.closing))}</td></tr>
              <tr><th>Total Pemasukan</th><td>${esc(money(totals.income))}</td><th>Total Pengeluaran</th><td>${esc(money(totals.expense))}</td></tr>
              <tr><th>Transfer Antar Akun</th><td>${esc(money(totals.transfer))}</td><th>Net Cash Flow</th><td>${esc(money(totals.income - totals.expense))}</td></tr>
              <tr><th>Hutang Baru</th><td>${esc(money(totals.debt_new))}</td><th>Piutang Baru</th><td>${esc(money(totals.receivable_new))}</td></tr>
              <tr><th>Pembayaran Hutang</th><td>${esc(money(totals.debt_payment))}</td><th>Penerimaan Piutang</th><td>${esc(money(totals.receivable_payment))}</td></tr>
              <tr><th>Sisa Hutang</th><td>${esc(money(worth.debts))}</td><th>Sisa Piutang</th><td>${esc(money(worth.receivables))}</td></tr>
            </table>
            <div class="ph-rule"></div>
          </div>

          <section class="statement-head">
            <div class="row-between wrap gap-4">
              <div class="row gap-3">
                ${iconTile(account?.icon || 'layers', { color: account?.color || 'var(--brand-500)', size: 46, radius: 14, iconSize: 22 })}
                <div>
                  <div class="t-label">Rekening Koran Digital</div>
                  <div class="t-h2" style="color:#fff">${esc(account ? account.name : 'Semua Akun (Portofolio)')}</div>
                  <div class="t-xs" style="color:rgba(255,255,255,.72)">${esc(label)} · ${statement.count} transaksi<span class="sh-period"> · ${esc(periodText)}</span></div>
                </div>
              </div>
              <div class="t-right">
                <div class="t-label">Saldo Akhir</div>
                <div class="t-display" style="font-size:30px;color:#fff" data-count="${statement.closing}">${esc(money(statement.closing))}</div>
              </div>
            </div>
          </section>

          <div class="stat-grid">
            ${statTile({
    label: 'Opening Balance', value: money(statement.opening), sub: 'saldo awal periode',
    iconName: 'calendar', color: 'var(--brand-500)', raw: statement.opening,
  })}
            ${statTile({
    label: 'Total Masuk (Credit)', value: `+${money(statement.totalIn).replace('-', '')}`,
    sub: `${totals.income ? 'termasuk pemasukan' : 'tidak ada pemasukan'}`, tone: 'pos', iconName: 'trending-up',
  })}
            ${statTile({
    label: 'Total Keluar (Debit)', value: `−${money(statement.totalOut).replace('-', '')}`,
    sub: 'pengeluaran & alokasi', tone: 'neg', iconName: 'trending-down',
  })}
            ${statTile({
    label: 'Transfer Antar Akun', value: money(totals.transfer),
    sub: 'tidak dihitung income/expense', iconName: 'switch', color: 'var(--accent)',
  })}
          </div>

          <div class="card card-pad-sm">
            <div class="row-between wrap gap-3">
              <div class="row gap-3 wrap">
                ${balanced ? badgeHtml('Seimbang', 'pos', { icon: 'badge-check' }) : badgeHtml('Selisih terdeteksi', 'neg')}
                <span class="t-xs t-dim">${esc(money(statement.opening))} + ${esc(money(statement.totalIn))} − ${esc(money(statement.totalOut))} = <b class="t-bold">${esc(money(statement.closing))}</b></span>
              </div>
              <span class="t-2xs t-dim">${accId === 'all'
    ? 'Transfer antar akun saling menghapus, jadi total tidak menggelembung.'
    : `Mutasi ${esc(account?.name || '')} dengan saldo berjalan per baris.`}</span>
            </div>
          </div>

          <section class="card card-flush">
            <div class="card-head" style="padding:var(--s-5) var(--s-5) var(--s-3)">
              <div>
                <h3>Detail Mutasi</h3>
                <div class="card-sub">${statement.count} baris · saldo berjalan dihitung dari saldo awal</div>
              </div>
              <div class="card-head-actions no-print">
                <button class="btn btn-sm btn-outline" data-export-statement>${icon('download', { size: 15 })} Ekspor</button>
              </div>
            </div>
            ${statement.rows.length ? `
              <div class="table-wrap is-plain">
                <table class="data table-stack">
                  <thead>
                    <tr>
                      <th>Tanggal</th><th>Keterangan</th><th>Jenis</th>
                      <th class="t-right">Debit</th><th class="t-right">Credit</th><th class="t-right">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${statement.rows.map((row) => `
                      <tr data-txn-id="${esc(row.txn.id)}" style="cursor:pointer">
                        <td data-label="Tanggal" class="t-nowrap t-xs">${esc(formatDate(row.txn.date, { year: false, short: true }))}
                          <div class="t-dim">${esc(row.txn.time || '')}</div></td>
                        <td data-label="Keterangan" class="cell-title">
                          ${esc(row.txn.description || row.txn.counterparty || 'Transaksi')}
                          <div class="t-2xs t-dim">${esc(state.accounts.find((a) => a.id === row.txn.account_id)?.name || '')}${row.txn.destination_account_id ? ` → ${esc(state.accounts.find((a) => a.id === row.txn.destination_account_id)?.name || '')}` : ''}</div>
                        </td>
                        <td data-label="Jenis" class="t-2xs">${badgeHtml(row.txn.transaction_type.replace(/_/g, ' '), 'outline')}</td>
                        <td data-label="Debit" ${row.debit ? '' : 'data-empty'} class="t-right t-num ${row.debit ? 't-neg' : 't-dim'}">${row.debit ? esc(money(row.debit).replace('-', '')) : '—'}</td>
                        <td data-label="Credit" ${row.credit ? '' : 'data-empty'} class="t-right t-num ${row.credit ? 't-pos' : 't-dim'}">${row.credit ? esc(money(row.credit).replace('-', '')) : '—'}</td>
                        <td data-label="Saldo" class="t-right t-num t-bold">${esc(money(row.balance))}</td>
                      </tr>`).join('')}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td data-label="Total periode ini" data-span="2" colspan="3">Total periode ini</td>
                      <td data-label="Total debit" class="t-right t-neg">${esc(money(statement.totalOut).replace('-', ''))}</td>
                      <td data-label="Total credit" class="t-right t-pos">${esc(money(statement.totalIn).replace('-', ''))}</td>
                      <td data-label="Saldo akhir" class="t-right">${esc(money(statement.closing))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>`
    : emptyState({
      title: 'Tidak ada mutasi pada periode ini',
      message: 'Pilih bulan lain, ganti akun, atau tambahkan transaksi baru.',
      illustration: 'transactions',
    })}
          </section>
        </div>`;
    }

    /* ---------------- Monthly report ---------------- */

    function renderMonthly(panel, state, periodKey, label, r) {
      const totals = periodTotals(state, r.from, r.to);
      const prev = periodComparison(state, r.from, r.to);
      const expenseCats = categoryBreakdown(state, { from: r.from, to: r.to, kind: 'expense' });
      const incomeCats = categoryBreakdown(state, { from: r.from, to: r.to, kind: 'income' });
      const accounts = accountBreakdown(state, { from: r.from, to: r.to });
      const daily = dailySeries(state, r.from, r.to);
      const heat = spendingHeatmap(state, periodKey);
      const topTx = topTransactions(state, { from: r.from, to: r.to, limit: 5 });
      const merchants = topMerchants(state, { from: r.from, to: r.to, limit: 5 });
      const budgets = budgetUsage(state, periodKey);
      const statements = buildStatement(state, { accountId: null, from: r.from, to: r.to });
      const activeDays = new Set(totals.list.map((t) => t.date)).size;
      const debtOut = state.debts.reduce((acc, d) => {
        const paid = state.debtPayments.filter((p) => p.debt_id === d.id && p.date <= r.to).reduce((s, p) => s + p.amount, 0);
        return acc + Math.max(0, d.principal - paid);
      }, 0);
      const recOut = state.receivables.reduce((acc, rec) => {
        const got = state.receivablePayments.filter((p) => p.receivable_id === rec.id && p.date <= r.to).reduce((s, p) => s + p.amount, 0);
        return acc + Math.max(0, rec.principal - got);
      }, 0);

      panel.innerHTML = `
        <div class="stack-5">
          ${sectionDivider({
    title: `Financial Summary · ${label}`,
    sub: `Total Income, Total Expense, dan posisi akhir bulan · ${totals.count} transaksi pada ${activeDays} hari aktif`,
    actions: `${badgeHtml(`Savings rate ${percent(totals.savingsRate, 1)}`, totals.savingsRate >= 20 ? 'pos' : totals.savingsRate >= 0 ? 'warn' : 'neg')}`,
  })}

          <div class="stat-grid">
            ${statTile({
    label: 'Total Income', value: money(totals.income), tone: 'pos', iconName: 'trending-up',
    sub: `${percent(prev.deltas.income, 0, true)} vs bulan lalu`, raw: totals.income,
  })}
            ${statTile({
    label: 'Total Expense', value: money(totals.expense), tone: 'neg', iconName: 'trending-down',
    sub: `${percent(prev.deltas.expense, 0, true)} vs bulan lalu`, raw: totals.expense,
  })}
            ${statTile({
    label: 'Net Cash Flow', value: money(totals.net), tone: totals.net >= 0 ? 'pos' : 'neg', iconName: 'switch',
    sub: 'Income − Expense', raw: totals.net,
  })}
            ${statTile({
    label: 'Savings Rate', value: percent(totals.savingsRate, 1), tone: 'brand', iconName: 'target',
    sub: `bulan lalu ${percent(prev.previous.savingsRate, 1)}`,
  })}
            ${statTile({ label: 'Total Hutang', value: money(debtOut), sub: `per akhir ${esc(label)}`, iconName: 'credit-card', color: 'var(--neg)' })}
            ${statTile({ label: 'Total Piutang', value: money(recOut), sub: 'belum diterima', iconName: 'hand-coins', color: 'var(--warn)' })}
            ${statTile({ label: 'Ending Balance', value: money(statements.closing), sub: 'saldo akhir semua akun', iconName: 'wallet', color: 'var(--brand-500)' })}
          </div>

          ${sectionDivider({ title: 'Arus Kas', sub: 'Pola pengeluaran harian dan komposisi kategori bulan ini' })}
          <div class="bento">
            <section class="card col-7">
              <div class="card-head">
                <div><h3>Pengeluaran Harian</h3>
                  <div class="card-sub">Rata-rata ${esc(money(totals.expense / Math.max(1, activeDays)))} per hari aktif</div></div>
                ${legendItem('Pengeluaran', 'var(--neg)', { line: true })}
              </div>
              <div class="chart-wrap">${lineAreaChart({
    labels: daily.map((d) => d.date.slice(8, 10)),
    series: [{ name: 'Pengeluaran', color: 'var(--neg)', values: daily.map((d) => d.expense) }],
    height: 220, format: (v) => money(v, { compact: true }), showDots: false,
  })}</div>
            </section>

            <section class="card col-5">
              <div class="card-head">
                <div><h3>Expense Breakdown</h3><div class="card-sub">${expenseCats.length} kategori</div></div>
              </div>
              ${expenseCats.length ? `<div class="chart-wrap">${donutChart({
    segments: expenseCats.slice(0, 7).map((c) => ({ label: c.category.name, value: c.total, color: c.category.color })),
    size: 150, thickness: 18,
    centerValue: money(totals.expense, { compact: true }).replace('Rp ', ''),
    centerLabel: 'Pengeluaran',
    format: (v) => money(v, { compact: true }),
  })}</div>` : '<div class="t-xs t-dim">Belum ada pengeluaran bulan ini.</div>'}
            </section>
          </div>

          ${sectionDivider({ title: 'Rincian', sub: 'Dari mana uang datang, ke mana perginya, dan apa yang paling besar' })}
          <div class="bento">
            <section class="card col-6">
              <div class="card-head"><div><h3>Income Breakdown</h3><div class="card-sub">Sumber pemasukan ${esc(label)}</div></div></div>
              ${incomeCats.length
    ? `<div class="stack-4">${breakdownBars(incomeCats.map((c) => ({ label: c.category.name, value: c.total, color: c.category.color, suffix: `· ${c.count}x` })), { format: money })}</div>`
    : '<div class="t-xs t-dim">Belum ada pemasukan.</div>'}
            </section>

            <section class="card col-6">
              <div class="card-head"><div><h3>Account Breakdown</h3><div class="card-sub">Arus dana per akun</div></div></div>
              ${accounts.length ? `
                <div class="table-wrap is-plain">
                  <table class="data table-stack">
                    <thead><tr><th>Akun</th><th class="t-right">Masuk</th><th class="t-right">Keluar</th><th class="t-right">Net</th></tr></thead>
                    <tbody>${accounts.map((a) => `<tr>
                      <td data-label="Akun" class="cell-title">${esc(a.account.name)}</td>
                      <td data-label="Masuk" class="t-right t-pos t-num">${esc(money(a.in))}</td>
                      <td data-label="Keluar" class="t-right t-neg t-num">${esc(money(a.out))}</td>
                      <td data-label="Net" class="t-right t-num t-bold">${esc(money(a.net))}</td>
                    </tr>`).join('')}</tbody>
                  </table>
                </div>` : '<div class="t-xs t-dim">Belum ada aktivitas.</div>'}
            </section>
          </div>

          <div class="bento">
            <section class="card col-4">
              <div class="card-head"><div><h3>Top Pengeluaran</h3><div class="card-sub">Transaksi terbesar</div></div></div>
              <div class="stack-2">
                ${topTx.length ? topTx.map((t) => `<button class="row-between gap-3 t-tap" data-txn-id="${esc(t.id)}" type="button">
                  <span class="t-xs t-clip grow">${esc(t.description || 'Transaksi')}<span class="t-dim"> · ${esc(formatDate(t.date, { year: false, short: true }))}</span></span>
                  ${moneyHtml(-t.amount, { cls: 't-sm' })}
                </button>`).join('') : '<div class="t-xs t-dim">Belum ada data.</div>'}
              </div>
            </section>

            <section class="card col-4">
              <div class="card-head"><div><h3>Merchant / Kegiatan</h3><div class="card-sub">Pengeluaran berulang terbanyak</div></div></div>
              <div class="stack-2">
                ${merchants.length ? merchants.map((m) => `<div class="row-between gap-3">
                  <span class="t-xs t-clip grow">${esc(m.name)}<span class="t-dim"> · ${m.count}x</span></span>
                  <span class="t-sm t-num t-bold">${esc(money(m.total))}</span>
                </div>`).join('') : '<div class="t-xs t-dim">Belum ada data.</div>'}
              </div>
            </section>

            <section class="card col-4">
              <div class="card-head"><div><h3>Kalender Belanja</h3><div class="card-sub">Intensitas harian · ${esc(label)}</div></div></div>
              <div class="heat-grid">
                ${['S', 'S', 'R', 'K', 'J', 'S', 'M'].map((d) => `<div class="t-2xs t-dim t-center">${d}</div>`).join('')}
                ${heat.cells.map((cell) => (cell.empty
    ? '<div></div>'
    : `<div class="heat-cell" style="background:${cell.value ? `color-mix(in srgb, var(--neg) ${Math.round(12 + cell.intensity * 88)}%, var(--surface-3))` : ''}" title="${esc(formatDate(cell.date))}: ${esc(money(cell.value))}"></div>`)).join('')}
              </div>
              <div class="row-between t-2xs t-dim mt-3"><span>Rp 0</span><span>Tertinggi ${esc(money(heat.max, { compact: true }))}</span></div>
            </section>
          </div>

          ${budgets.length ? `
            ${sectionDivider({ title: 'Budget vs Realisasi', sub: `Realisasi anggaran ${esc(label)} — peringatan pada 80% dan 100%` })}
            <section class="card">
              <div class="stack-3">
                ${budgets.map((row) => `<div class="stack-2">
                  <div class="row-between t-xs gap-3">
                    <span class="t-semibold">${esc(row.category?.name || '-')}</span>
                    <span class="t-dim t-num">${esc(money(row.spent))} / ${esc(money(row.amount))} · ${row.usage.toFixed(0)}%</span>
                  </div>
                  ${progressHtml(Math.min(row.usage, 100), { tone: row.level === 'over' ? 'neg' : row.level === 'warn' ? 'warn' : 'pos' })}
                </div>`).join('')}
              </div>
            </section>` : ''}
        </div>`;
    }

    /* ---------------- Recap ---------------- */

    function renderRecap(panel, state) {
      const fromAll = toISO(new Date(new Date().getFullYear() - 1, new Date().getMonth() - 11, 1));
      const rows = monthlySeries(state, fromAll, endOfMonthISO());
      const active = rows.filter((row) => row.count);
      const sums = active.reduce((acc, row) => ({
        income: acc.income + row.income,
        expense: acc.expense + row.expense,
        net: acc.net + row.net,
        investment: acc.investment + row.investment,
        emergency_fund: acc.emergency_fund + row.emergency_fund,
      }), { income: 0, expense: 0, net: 0, investment: 0, emergency_fund: 0 });
      const last = rows[rows.length - 1] || { endingBalance: 0, netWorth: 0 };
      const best = active.slice().sort((a, b) => b.net - a.net)[0];

      panel.innerHTML = `
        <div class="stack-5">
          ${sectionDivider({
    title: 'Rekap Bulanan',
    sub: `${active.length} bulan berisi data · investasi, dana darurat, pembayaran hutang, dan saldo akhir`,
    actions: badgeHtml(`${active.length} bulan`, 'brand'),
  })}

          <div class="stat-grid">
            ${statTile({ label: 'Total Income', value: money(sums.income), tone: 'pos', iconName: 'trending-up', sub: `${active.length} bulan` })}
            ${statTile({ label: 'Total Expense', value: money(sums.expense), tone: 'neg', iconName: 'trending-down', sub: `rata-rata ${money(active.length ? sums.expense / active.length : 0, { compact: true })}/bulan` })}
            ${statTile({ label: 'Net Cash Flow', value: money(sums.net), tone: sums.net >= 0 ? 'pos' : 'neg', iconName: 'switch', sub: best ? `terbaik ${formatMonth(best.month)}` : '—' })}
            ${statTile({ label: 'Ending Balance', value: money(last.endingBalance), iconName: 'wallet', color: 'var(--brand-500)', sub: 'saldo akhir bulan terakhir' })}
          </div>

          <section class="card card-flush">
            <div class="card-head" style="padding:var(--s-5) var(--s-5) var(--s-3)">
              <div><h3>Tabel Rekap</h3>
                <div class="card-sub">Ending Balance = saldo seluruh akun pada akhir bulan (aset likuid), bukan net worth</div></div>
            </div>
            <div class="table-wrap is-plain">
              <table class="data table-stack recap-table">
                <thead>
                  <tr>
                    <th>Bulan</th><th class="t-right">Income</th><th class="t-right">Expense</th>
                    <th class="t-right">Investasi</th><th class="t-right">Dana Darurat</th>
                    <th class="t-right">Bayar Hutang</th><th class="t-right">Terima Piutang</th>
                    <th class="t-right">Net Cash Flow</th><th class="t-right">Ending Balance</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows.map((row) => `<tr>
                    <td data-label="Bulan" class="cell-title t-nowrap">
                      <span>${esc(formatMonth(row.month))}</span>
                      <span class="recap-net-chip ${row.net >= 0 ? 'is-pos' : 'is-neg'}">${esc(money(row.net))}</span>
                    </td>
                    <td data-label="Income" class="t-right t-num t-pos">${esc(money(row.income))}</td>
                    <td data-label="Expense" class="t-right t-num t-neg">${esc(money(row.expense))}</td>
                    <td data-label="Investasi" class="t-right t-num">${esc(money(row.investment))}</td>
                    <td data-label="Dana Darurat" class="t-right t-num">${esc(money(row.emergency_fund))}</td>
                    <td data-label="Bayar Hutang" class="t-right t-num">${esc(money(row.debt_payment))}</td>
                    <td data-label="Terima Piutang" class="t-right t-num">${esc(money(row.receivable_payment))}</td>
                    <td data-label="Net Cash Flow" class="t-right t-num t-bold is-net ${row.net >= 0 ? 't-pos' : 't-neg'}">${esc(money(row.net))}</td>
                    <td data-label="Ending Balance" class="t-right t-num t-bold is-ending">${esc(money(row.endingBalance))}</td>
                  </tr>`).join('')}
                </tbody>
                <tfoot>
                  <tr class="recap-total-row">
                    <td data-label="Total" class="cell-title is-total-label">Total</td>
                    <td data-label="Income" class="t-right t-pos">${esc(money(sums.income))}</td>
                    <td data-label="Expense" class="t-right t-neg">${esc(money(sums.expense))}</td>
                    <td data-label="Investasi" class="t-right">${esc(money(sums.investment))}</td>
                    <td data-label="Dana Darurat" class="t-right">${esc(money(sums.emergency_fund))}</td>
                    <td data-label="Bayar Hutang" class="t-right">${esc(money(active.reduce((a, row) => a + row.debt_payment, 0)))}</td>
                    <td data-label="Terima Piutang" class="t-right">${esc(money(active.reduce((a, row) => a + row.receivable_payment, 0)))}</td>
                    <td data-label="Net Cash Flow" class="t-right ${sums.net >= 0 ? 't-pos' : 't-neg'}">${esc(money(sums.net))}</td>
                    <td data-label="Ending Balance" class="t-right">${esc(money(last.endingBalance))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          ${sectionDivider({ title: 'Tren', sub: 'Pergerakan kekayaan bersih dan arus kas bulanan' })}
          <div class="bento">
            <section class="card col-7">
              <div class="card-head">
                <div><h3>Tren Net Worth</h3><div class="card-sub">Aset likuid + piutang − hutang</div></div>
              </div>
              <div class="chart-wrap">${lineAreaChart({
    labels: rows.map((row) => formatMonth(row.month, true)),
    series: [{ name: 'Net Worth', color: 'var(--brand-500)', values: rows.map((row) => row.netWorth) }],
    height: 240, format: (v) => money(v, { compact: true }),
  })}</div>
            </section>
            <section class="card col-5">
              <div class="card-head"><div><h3>Net Cash Flow per Bulan</h3><div class="card-sub">Surplus / defisit</div></div></div>
              <div class="chart-wrap">${groupedBarChart({
    labels: rows.map((row) => formatMonth(row.month, true).split(' ')[0]),
    series: [{ name: 'Net', color: 'var(--brand-500)', values: rows.map((row) => Math.max(0, row.net)) },
      { name: 'Defisit', color: 'var(--neg)', values: rows.map((row) => Math.abs(Math.min(0, row.net))) }],
    height: 220, format: (v) => money(v, { compact: true }),
  })}</div>
            </section>
          </div>
        </div>`;
    }

    void startOfMonthISO;
    void todayISO;
    renderPage();
    return () => cleanups.forEach((fn) => fn?.());
  },
};

export default reportsPage;
