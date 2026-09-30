/**
 * Analytics — interactive financial charts with period selection.
 */

import store from '../services/store.js';
import {
  accountBreakdown, accountSummaries, averageMonthlyExpense, categoryBreakdown, dailySeries,
  debtList, monthlySeries, netWorth, periodComparison, periodTotals, receivableList,
  runwayMonths, spendingHeatmap, topMerchants, topTransactions,
} from '../services/finance.js';
import { esc, on, qs, qsa } from '../utils/dom.js';
import { money, percent } from '../utils/format.js';
import {
  formatMonth, fromISO, monthKey, parseMonthKey, rangeForPreset, startOfMonthISO, toISO, todayISO,
} from '../utils/date.js';
import { icon, iconTile } from '../components/icons.js';
import { badgeHtml, moneyHtml, progressHtml } from '../components/ui.js';
import { animateCounters, chartCard, deltaHtml, legendItem, metricCard } from '../components/cards.js';
import {
  attachChartTooltips, breakdownBars, donutChart, groupedBarChart, lineAreaChart, sparkline,
} from '../components/charts.js';
import { openTransactionDetail } from '../components/ledger.js';

const PRESETS = [
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '3m', label: '3M' },
  { value: '6m', label: '6M' },
  { value: '1y', label: '1Y' },
  { value: 'all', label: 'Semua' },
  { value: 'custom', label: 'Custom' },
];

export const analyticsPage = {
  id: 'analytics',
  title: 'Analytics',
  eyebrow: 'Analisis Keuangan',
  render(root, ctx) {
    let preset = ctx.params?.preset || '6m';
    const custom = {
      from: ctx.params?.from || startOfMonthISO(),
      to: ctx.params?.to || todayISO(),
    };
    let cleanups = [];

    function renderPage() {
      const state = store.state;
      const range = preset === 'custom'
        ? { from: custom.from, to: custom.to }
        : rangeForPreset(preset);
      if (preset === 'all') {
        const dates = state.transactions.map((t) => t.date).sort();
        range.from = dates[0] || `${monthKey().slice(0, 4)}-01-01`;
      }
      const totals = periodTotals(state, range.from, range.to);
      const comparison = periodComparison(state, range.from, range.to);
      const days = dailySeries(state, range.from, range.to);
      const shortRange = preset === '7d' || preset === '30d';
      const fromMonth = preset === '7d' ? toISO(new Date(new Date().setMonth(new Date().getMonth() - 1, 1)))
        : preset === '30d' ? toISO(new Date(new Date().setMonth(new Date().getMonth() - 1, 1)))
          : range.from;
      const months = monthlySeries(state, fromMonth, todayISO());
      const expenseCats = categoryBreakdown(state, { from: range.from, to: range.to, kind: 'expense' });
      const incomeCats = categoryBreakdown(state, { from: range.from, to: range.to, kind: 'income' });
      const accounts = accountSummaries(state).filter((a) => a.account.status !== 'archived');
      const worth = netWorth(state);
      const avgMonthly = averageMonthlyExpense(state, 3);
      const runway = runwayMonths(state);
      const heat = spendingHeatmap(state, monthKey());
      const topTx = topTransactions(state, { from: range.from, to: range.to, limit: 6 });
      const merchants = topMerchants(state, { from: range.from, to: range.to, limit: 6 });
      const savingSeries = months.map((m) => (m.income ? (m.net / m.income) * 100 : 0));
      const spendingTrend = months.map((m) => m.expense);
      const avgSpend = spendingTrend.length ? spendingTrend.reduce((a, b) => a + b, 0) / spendingTrend.length : 0;

      root.innerHTML = `
        <div class="page-enter stack-5">
          <div class="page-head">
            <div>
              <h2>Analytics</h2>
              <p>Analisis arus kas, kategori, dan pertumbuhan kekayaan bersih Anda.</p>
            </div>
            <div class="page-head-actions">
              <div class="stack-2">
                <div class="segmented" data-presets>
                  ${PRESETS.map((p) => `<button data-preset="${p.value}" aria-selected="${p.value === preset}">${p.label}</button>`).join('')}
                </div>
                <div class="row gap-2" data-custom-range ${preset === 'custom' ? '' : 'hidden'}>
                  <input class="input" type="date" data-range-from value="${esc(custom.from)}" aria-label="Dari tanggal" style="width:auto" />
                  <span class="t-xs t-dim">sampai</span>
                  <input class="input" type="date" data-range-to value="${esc(custom.to)}" aria-label="Sampai tanggal" style="width:auto" />
                </div>
              </div>
            </div>
          </div>

          <div class="bento">
            ${metricCard({ cls: 'col-3', label: 'Total Pemasukan', value: totals.income, iconName: 'trending-up', color: 'var(--pos)', delta: comparison.deltas.income })}
            ${metricCard({ cls: 'col-3', label: 'Total Pengeluaran', value: totals.expense, iconName: 'trending-down', color: 'var(--neg)', delta: comparison.deltas.expense, deltaOpts: { invert: true } })}
            <section class="card col-3">
              <div class="metric">
                <div class="metric-label">${iconTile('calculator', { color: 'var(--brand-500)', size: 28, radius: 9, iconSize: 15 })}<span>Rata-rata Harian</span></div>
                <div class="metric-value">${esc(money(totals.expense / Math.max(1, days.length)))}</div>
                <div class="metric-sub">Burn rate bulanan ${esc(money(avgMonthly))}</div>
              </div>
            </section>
            <section class="card col-3">
              <div class="metric">
                <div class="metric-label">${iconTile('shield', { color: 'var(--accent)', size: 28, radius: 9, iconSize: 15 })}<span>Runway</span></div>
                <div class="metric-value">${runway ? `${runway.toFixed(1)} bulan` : '—'}</div>
                <div class="metric-sub">${runway ? `Saldo likuid ${esc(money(worth.accounts, { compact: true }))} dibagi burn rate 3 bulan` : 'Belum cukup data pengeluaran'}</div>
              </div>
            </section>
          </div>

          <div class="bento">
            <section class="card col-8">
              <div class="card-head">
                <div><h3>Income vs Expense</h3><div class="card-sub">${esc(range.from)} — ${esc(range.to)}</div></div>
              </div>
              <div class="chart-wrap">${shortRange
    ? lineAreaChart({
      labels: days.map((d) => d.date.slice(8, 10)),
      series: [
        { name: 'Pemasukan', color: 'var(--pos)', values: days.map((d) => d.income), fill: false },
        { name: 'Pengeluaran', color: 'var(--neg)', values: days.map((d) => d.expense) },
      ],
      height: 260, format: (v) => money(v, { compact: true }), showDots: false,
    })
    : groupedBarChart({
      labels: months.map((m) => formatMonth(m.month, true)),
      series: [
        { name: 'Pemasukan', color: 'var(--pos)', values: months.map((m) => m.income) },
        { name: 'Pengeluaran', color: 'var(--neg)', values: months.map((m) => m.expense) },
      ],
      height: 260, format: (v) => money(v, { compact: true }),
    })}</div>
              <div class="chart-legend mt-4">${legendItem('Pemasukan', 'var(--pos)')}${legendItem('Pengeluaran', 'var(--neg)')}
                <span class="ml-auto t-dim">Net ${esc(money(totals.net))} · ${esc(percent(comparison.deltas.net, 1, true))}</span></div>
            </section>

            <section class="card col-4">
              <div class="card-head"><div><h3>Expense by Category</h3><div class="card-sub">${expenseCats.length} kategori</div></div></div>
              ${expenseCats.length ? `<div class="chart-wrap">${donutChart({
    segments: expenseCats.slice(0, 7).map((c) => ({ label: c.category.name, value: c.total, color: c.category.color })),
    size: 152, thickness: 18,
    centerValue: money(totals.expense, { compact: true }).replace('Rp ', ''),
    centerLabel: 'Total',
    format: (v) => money(v, { compact: true }),
  })}</div>` : '<div class="chart-xs t-dim">Belum ada pengeluaran.</div>'}
            </section>
          </div>

          <div class="bento">
            <section class="card col-6">
              <div class="card-head"><div><h3>Monthly Cash Flow</h3><div class="card-sub">Surplus vs defisit per bulan</div></div></div>
              <div class="chart-wrap">${groupedBarChart({
    labels: months.map((m) => formatMonth(m.month, true).split(' ')[0]),
    series: [
      { name: 'Surplus', color: 'var(--pos)', values: months.map((m) => Math.max(0, m.net)) },
      { name: 'Defisit', color: 'var(--neg)', values: months.map((m) => Math.abs(Math.min(0, m.net))) },
    ],
    height: 230, format: (v) => money(v, { compact: true }),
  })}</div>
            </section>

            <section class="card col-6">
              <div class="card-head"><div><h3>Income by Source</h3><div class="card-sub">${incomeCats.length} sumber pemasukan</div></div></div>
              <div class="stack-4">${incomeCats.length
    ? breakdownBars(incomeCats.map((c) => ({ label: c.category.name, value: c.total, color: c.category.color, suffix: `· ${c.count}x` })), { format: money })
    : '<div class="t-xs t-dim">Belum ada pemasukan pada periode ini.</div>'}</div>
            </section>
          </div>

          <div class="bento">
            <section class="card col-7">
              <div class="card-head">
                <div><h3>Net Worth Growth</h3><div class="card-sub">Aset likuid + piutang − hutang</div></div>
                <div class="card-head-actions">
                  <span class="badge badge-brand">${esc(money(worth.net))}</span>
                </div>
              </div>
              <div class="chart-wrap">${lineAreaChart({
    labels: months.map((m) => formatMonth(m.month, true)),
    series: [{ name: 'Net Worth', color: 'var(--brand-500)', values: months.map((m) => m.netWorth) }],
    height: 250, format: (v) => money(v, { compact: true }),
  })}</div>
            </section>

            <section class="card col-5">
              <div class="card-head"><div><h3>Savings Rate Trend</h3><div class="card-sub">% pemasukan yang disimpan</div></div></div>
              <div class="chart-wrap">${lineAreaChart({
    labels: months.map((m) => formatMonth(m.month, true).split(' ')[0]),
    series: [{ name: 'Savings rate', color: 'var(--accent)', values: savingSeries }],
    height: 250, format: (v) => `${v.toFixed(0)}%`, showDots: true,
  })}</div>
              <div class="row-between t-2xs t-dim mt-3"><span>Target sehat &gt; 20%</span>
                <span>Rata-rata ${percent(savingSeries.length ? savingSeries.reduce((a, b) => a + b, 0) / savingSeries.length : 0, 1)}</span></div>
            </section>
          </div>

          <div class="bento">
            <section class="card col-6">
              <div class="card-head">
                <div><h3>Spending Trend</h3><div class="card-sub">Rata-rata ${esc(money(avgSpend))} per bulan</div></div>
                ${spendingTrend.length ? badgeHtml(spendingTrend[spendingTrend.length - 1] > avgSpend ? 'Di atas rata-rata' : 'Di bawah rata-rata',
    spendingTrend[spendingTrend.length - 1] > avgSpend ? 'warn' : 'pos') : ''}
              </div>
              <div class="chart-wrap">${lineAreaChart({
    labels: months.map((m) => formatMonth(m.month, true).split(' ')[0]),
    series: [{ name: 'Pengeluaran', color: 'var(--neg)', values: spendingTrend },
      { name: 'Rata-rata', color: 'var(--text-3)', values: months.map(() => avgSpend), dashed: true, fill: false }],
    height: 230, format: (v) => money(v, { compact: true }),
  })}</div>
              <div class="chart-legend mt-3">${legendItem('Pengeluaran bulanan', 'var(--neg)', { line: true })}${legendItem('Rata-rata', 'var(--text-3)', { line: true })}</div>
            </section>

            <section class="card col-6">
              <div class="card-head"><div><h3>Account Balance</h3><div class="card-sub">Distribusi saldo saat ini</div></div></div>
              <div class="stack-4">
                ${breakdownBars(accounts.map((a) => ({
    label: a.account.name, value: Math.max(0, a.balance), color: a.account.color,
    suffix: a.txnCount ? `· ${a.txnCount} trx` : '',
  })), { format: money })}
              </div>
              <div class="card-foot row-between">
                <span class="t-xs t-dim">Total saldo</span>
                <span class="t-sm t-bold">${esc(money(worth.accounts))}</span>
              </div>
            </section>
          </div>

          <div class="bento">
            <section class="card col-6">
              <div class="card-head"><div><h3>Debt Progress</h3><div class="card-sub">${debtList(state, { status: 'all' }).length} hutang tercatat</div></div></div>
              <div class="stack-4">
                ${debtList(state, { status: 'all' }).slice(0, 5).map(({ debt, info }) => `<div class="stack-2">
                  <div class="row-between t-xs">
                    <span class="t-semibold t-clip">${esc(debt.counterparty)}</span>
                    <span class="t-dim">${esc(money(info.paid))} / ${esc(money(info.principal))} · ${info.progress.toFixed(0)}%</span>
                  </div>
                  ${progressHtml(info.progress, { tone: info.remaining <= 0 ? 'pos' : info.isOverdue ? 'neg' : 'warn' })}
                </div>`).join('') || '<div class="t-xs t-dim">Belum ada data hutang.</div>'}
              </div>
            </section>

            <section class="card col-6">
              <div class="card-head"><div><h3>Receivable Progress</h3><div class="card-sub">${receivableList(state, { status: 'all' }).length} piutang tercatat</div></div></div>
              <div class="stack-4">
                ${receivableList(state, { status: 'all' }).slice(0, 5).map(({ receivable, info }) => `<div class="stack-2">
                  <div class="row-between t-xs">
                    <span class="t-semibold t-clip">${esc(receivable.counterparty)}</span>
                    <span class="t-dim">${esc(money(info.received))} / ${esc(money(info.principal))} · ${info.progress.toFixed(0)}%</span>
                  </div>
                  ${progressHtml(info.progress, { tone: info.remaining <= 0 ? 'pos' : info.isOverdue ? 'neg' : '' })}
                </div>`).join('') || '<div class="t-xs t-dim">Belum ada data piutang.</div>'}
              </div>
            </section>
          </div>

          <div class="bento">
            <section class="card col-4">
              <div class="card-head"><div><h3>Top Pengeluaran</h3><div class="card-sub">Periode terpilih</div></div></div>
              <div class="stack-3">
                ${topTx.filter((t) => t.transaction_type === 'expense').map((t) => `<div class="row" data-txn-id="${esc(t.id)}" style="cursor:pointer">
                  <span class="t-xs grow t-clip">${esc(t.description || 'Transaksi')}</span>
                  <span class="t-xs t-num t-bold t-neg">${esc(money(t.amount))}</span>
                </div>`).join('') || '<div class="t-xs t-dim">Belum ada data.</div>'}
              </div>
            </section>
            <section class="card col-4">
              <div class="card-head"><div><h3>Kegiatan Terbanyak</h3><div class="card-sub">Frekuensi pengeluaran</div></div></div>
              <div class="stack-3">
                ${merchants.map((m) => `<div class="row">
                  <span class="t-xs grow t-clip">${esc(m.name)}</span>
                  <span class="badge badge-outline">${m.count}x</span>
                  <span class="t-xs t-num t-bold">${esc(money(m.total))}</span>
                </div>`).join('') || '<div class="t-xs t-dim">Belum ada data.</div>'}
              </div>
            </section>
            <section class="card col-4">
              <div class="card-head"><div><h3>Intensitas Harian</h3><div class="card-sub">${esc(formatMonth(monthKey()))}</div></div></div>
              <div class="heat-grid">
                ${['S', 'S', 'R', 'K', 'J', 'S', 'M'].map((d) => `<div class="t-2xs t-dim t-center">${d}</div>`).join('')}
                ${heat.cells.map((cell) => (cell.empty
    ? '<div></div>'
    : `<div class="heat-cell" style="background:${cell.value ? `color-mix(in srgb, var(--neg) ${Math.round(12 + cell.intensity * 88)}%, var(--surface-3))` : ''}" title="${esc(cell.date)}: ${esc(money(cell.value))}"></div>`)).join('')}
              </div>
            </section>
          </div>
        </div>
      `;

      animateCounters(root);
      qsa('.chart-wrap', root).forEach((h) => attachChartTooltips(h));

      cleanups.forEach((fn) => fn?.());
      cleanups = [
        on(root, 'click', '[data-preset]', (event, el) => { preset = el.dataset.preset; renderPage(); }),
        on(root, 'change', '[data-range-from]', (event, el) => {
          if (!el.value) return;
          custom.from = el.value;
          if (custom.to < custom.from) custom.to = startOfMonthISO(fromISO(el.value));
          renderPage();
        }),
        on(root, 'change', '[data-range-to]', (event, el) => {
          if (!el.value) return;
          custom.to = el.value;
          if (custom.from > custom.to) custom.from = startOfMonthISO(fromISO(el.value));
          renderPage();
        }),
        on(root, 'click', '[data-txn-id]', (event, el) => openTransactionDetail(el.dataset.txnId, { onChanged: renderPage })),
      ];
    }

    renderPage();
    return () => cleanups.forEach((fn) => fn?.());
  },
};

export default analyticsPage;
