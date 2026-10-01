/**
 * Dashboard — Bento overview answering "how am I doing?" in <5 seconds.
 * Hierarchy: Total Balance → flows → accounts/debt → charts → recent activity.
 */

import store from '../services/store.js';
import {
  accountSummaries, assetTotals, budgetUsage, dashboardSummary, dailySeries, debtList,
  monthlySeries, periodTotals, receivableList, sortTransactions, txns, inRange,
} from '../services/finance.js';
import { ACCOUNT_TYPES, TRANSACTION_TYPES } from '../types/models.js';
import { esc, on, qs, qsa } from '../utils/dom.js';
import { MASK, money, percent } from '../utils/format.js';
import { maskMoneyInDom } from '../utils/privacy.js';
import { formatMonth, monthKey, rangeForPreset, todayISO, toISO, MONTHS_SHORT_ID } from '../utils/date.js';
import { icon, iconTile } from '../components/icons.js';
import { groupedBarChart, lineAreaChart, sparkline } from '../components/charts.js';
import { attachChartTooltips } from '../components/charts.js';
import { attachCardTilt } from '../components/cards.js';
import {
  accountRail, animateCounters, budgetRow, chartCard, debtPairCard, summaryCard,
  deltaHtml, heroCard, insightCard, legendItem, quickActions,
} from '../components/cards.js';
import { badgeHtml, moneyHtml, onSegment, progressHtml, toast } from '../components/ui.js';
import {
  ledgerHtml, openTransactionDetail, openTransactionForm, openDebtPayment, openReceivablePayment,
} from '../components/ledger.js';
import { openBudgetForm } from './budgets.js';

const QUICK_ACTIONS = [
  { key: TRANSACTION_TYPES.INCOME, label: 'Pemasukan', icon: 'trending-up', color: 'var(--pos)' },
  { key: TRANSACTION_TYPES.EXPENSE, label: 'Pengeluaran', icon: 'trending-down', color: 'var(--neg)' },
  { key: TRANSACTION_TYPES.TRANSFER, label: 'Transfer', icon: 'switch', color: 'var(--brand-500)' },
  { key: TRANSACTION_TYPES.DEBT, label: 'Hutang', icon: 'hand-coins', color: 'var(--warn)' },
  { key: TRANSACTION_TYPES.RECEIVABLE, label: 'Piutang', icon: 'file-text', color: 'var(--info)' },
  { key: 'attachment', label: 'Lampiran', icon: 'image', color: 'var(--accent)' },
  { key: 'budget', label: 'Budget', icon: 'target', color: '#0ea5e9' },
  { key: 'report', label: 'Laporan', icon: 'file-chart', color: '#475569' },
];

const HOME_RECENT_LIMIT = 5;

const RANGE_OPTIONS = [
  { value: '7d', label: '7H' },
  { value: '30d', label: '30H' },
  { value: '3m', label: '3B' },
  { value: '6m', label: '6B' },
  { value: '1y', label: '1T' },
];

function cashflowChart(state, preset) {
  // Grafik ikut menghormati mode privasi: sumbu & ringkasan disensor.
  const hide = !!state.settings.hide_balance;
  const fmt = (value, opts = {}) => (hide ? MASK : money(value, opts));
  const range = rangeForPreset(preset);
  if (preset === '7d' || preset === '30d') {
    const series = dailySeries(state, range.from, range.to);
    const labels = series.map((d) => {
      const day = d.date.slice(8, 10);
      const month = MONTHS_SHORT_ID[Number(d.date.slice(5, 7)) - 1];
      return preset === '7d' ? `${day}/${month}` : day;
    });
    const totals = periodTotals(state, range.from, range.to);
    return {
      html: lineAreaChart({
        labels,
        series: [
          { name: 'Pemasukan', color: 'var(--pos)', values: series.map((d) => d.income), fill: false },
          { name: 'Pengeluaran', color: 'var(--neg)', values: series.map((d) => d.expense), fill: true },
        ],
        height: 250,
        format: (v) => fmt(v, { compact: true }),
      }),
      legend: `${legendItem('Pemasukan', 'var(--pos)', { line: true })}${legendItem('Pengeluaran', 'var(--neg)', { line: true })}`,
      sub: `${esc(fmt(totals.income))} masuk · ${esc(fmt(totals.expense))} keluar · net ${esc(fmt(totals.net))}`,
      empty: series.every((d) => !d.income && !d.expense) ? 'Belum ada transaksi pada periode ini.' : '',
    };
  }
  const monthsBack = preset === '3m' ? 3 : preset === '6m' ? 6 : 12;
  const from = toISO(new Date(new Date().getFullYear(), new Date().getMonth() - monthsBack + 1, 1));
  const rows = monthlySeries(state, from, todayISO());
  const totals = periodTotals(state, from, range.to);
  return {
    html: groupedBarChart({
      labels: rows.map((r) => formatMonth(r.month, true).split(' ')[0]),
      series: [
        { name: 'Pemasukan', color: 'var(--pos)', values: rows.map((r) => r.income) },
        { name: 'Pengeluaran', color: 'var(--neg)', values: rows.map((r) => r.expense) },
      ],
      height: 250,
      format: (v) => money(v, { compact: true }),
    }),
    legend: `${legendItem('Pemasukan', 'var(--pos)')}${legendItem('Pengeluaran', 'var(--neg)')}`,
    sub: `${esc(rows.length)} bulan terakhir · net ${esc(money(rows.reduce((a, r) => a + r.net, 0)))}`,
    empty: rows.length ? '' : 'Belum ada data untuk grafik.',
  };
}

function netWorthCard(state, { masked = false } = {}) {
  /** Format nominal, atau sensor saat mode privasi aktif. */
  const fmt = (value, opts = {}) => (masked ? MASK : money(value, opts));
  const worth = (() => {
    const summaries = accountSummaries(state);
    const balances = new Map(summaries.map((s) => [s.account.id, s.balance]));
    const accountTotal = state.accounts.filter((a) => a.status !== 'archived')
      .reduce((acc, a) => acc + (balances.get(a.id) || 0), 0);
    return { accountTotal };
  })();
  void worth;
  const rows = monthlySeries(state, toISO(new Date(new Date().getFullYear(), new Date().getMonth() - 5, 1)), todayISO());
  const series = rows.map((r) => r.netWorth);
  const current = series.length ? series[series.length - 1] : 0;
  const prev = series.length > 1 ? series[series.length - 2] : current;
  const change = current - prev;
  const assets = assetTotals(state);
  const segs = [
    { label: 'Bank', value: Math.max(0, assets.bank), color: 'var(--brand-500)' },
    { label: 'E-Wallet', value: Math.max(0, assets.ewallet), color: '#0ea5e9' },
    { label: 'Cash', value: Math.max(0, assets.cash), color: '#22c55e' },
    { label: 'Investasi', value: Math.max(0, assets.investment), color: '#6366f1' },
    { label: 'Dana Darurat', value: Math.max(0, assets.emergency_fund), color: '#0d9488' },
  ];
  const total = segs.reduce((acc, s) => acc + s.value, 0) || 1;
  return `<section class="card col-5">
    <div class="card-head">
      <div>
        <h3>Kekayaan Bersih</h3>
        <div class="card-sub">Aset − Liabilitas · 6 bulan terakhir</div>
      </div>
      <div class="card-head-actions">${badgeHtml('Net Worth', 'brand', { icon: 'wallet' })}</div>
    </div>
    <div class="card-body stack-4">
      <div>
        ${masked
    ? `<div class="metric-value is-masked">${MASK}</div>`
    : `<div class="metric-value" data-count="${current}">${esc(money(current))}</div>`}
        ${deltaHtml(prev ? ((change / Math.abs(prev)) * 100) : 0, { suffix: 'vs bulan lalu' })}
      </div>
      <div style="margin:0 -4px">${sparkline(series, { color: 'var(--brand-500)', height: 62 })}</div>
      <div class="seg-line" aria-label="Komposisi aset">
        ${segs.map((s) => `<span style="width:${((s.value / total) * 100).toFixed(1)}%;background:${s.color}" title="${esc(s.label)}"></span>`).join('')}
      </div>
      <div class="stack-2">
        ${segs.filter((s) => s.value > 0).slice(0, 5).map((s) => `<div class="row" style="font-size:var(--fs-xs)">
          <span class="legend-swatch" style="--swatch:${s.color}"></span>
          <span class="t-muted grow">${esc(s.label)}</span>
          <span class="t-num t-bold">${esc(masked ? MASK : money(s.value))}</span>
          <span class="t-dim t-2xs" style="min-width:38px;text-align:right">${((s.value / total) * 100).toFixed(0)}%</span>
        </div>`).join('')}
      </div>
    </div>
    <div class="card-foot row gap-3">
      <span class="grow t-xs t-dim">Piutang ${esc(fmt(state.receivables.reduce((acc, r) => acc + Math.max(0, r.principal), 0), { compact: true }))} belum dihitung sebagai aset likuid.</span>
      <button class="btn btn-sm btn-ghost" data-go="analytics">Analitik ${icon('chevron-right', { size: 14 })}</button>
    </div>
  </section>`;
}

export const dashboardPage = {
  id: 'dashboard',
  title: 'Dashboard',
  eyebrow: 'Ringkasan Keuangan',
  render(root, ctx) {
    let chartPreset = '30d';
    let cleanupChart = () => {};

    const state = store.state;
    // Mode privasi: tombol mata di kartu saldo menyembunyikan seluruh nominal di Home.
    const hide = !!state.settings.hide_balance;
    const m = (value, opts = {}) => (hide ? MASK : money(value, opts));
    const summary = dashboardSummary(state);
    const monthLabel = formatMonth(summary.monthKey);
    const balances = new Map(summary.accounts.map((a) => [a.account.id, a.balance]));
    const accountsActive = summary.accounts.filter((a) => a.account.status !== 'archived');

    const chart = cashflowChart(state, chartPreset);
    const budgets = budgetUsage(state, monthKey());
    const topBudgets = budgets.slice(0, 3);
    const openDebts = summary.debts;
    const openRec = summary.receivables;
    const nearestDebt = openDebts[0];
    const nearestRec = openRec[0];
    // satu kalimat saja untuk sub-judul ringkasan bulan ini
    const deltaSummaryText = summary.netDelta === null || summary.netDelta === undefined
      ? 'belum ada pembanding bulan lalu'
      : summary.monthTotals.net >= 0
        ? (Math.abs(summary.netDelta) >= 999
          ? 'arus kas melonjak vs bulan lalu'
          : `net naik ${percent(Math.abs(summary.netDelta), 0)} vs bulan lalu`)
        : 'arus kas minus bulan ini';
    const recent = sortTransactions(txns(state), 'desc').slice(0, HOME_RECENT_LIMIT);
    // the ATM card mirrors the user's primary bank account (number stays masked)
    const primaryAccount = accountsActive.find((a) => a.account.is_default && a.account.account_type === 'bank')
      || accountsActive.find((a) => a.account.account_type === 'bank')
      || accountsActive[0];

    root.innerHTML = `
      <div class="page-enter stack-5">
        <div class="bento">
          ${heroCard({
    balance: summary.accounts.reduce((acc, a) => acc + (a.account.status === 'archived' ? 0 : a.balance), 0),
    monthLabel,
    netWorth: summary.worth,
    trend: summary.trend,
    income: summary.monthTotals.income,
    expense: summary.monthTotals.expense,
    net: summary.monthTotals.net,
    holder: state.profile.name,
    cardNumber: primaryAccount?.account_number || '',
    institution: 'AD-Finance',
    since: String(new Date(state.profile.created_at || Date.now()).getFullYear()),
    hideBalance: hide,
  })}
          ${netWorthCard(state, { masked: hide })}
        </div>

        <div class="bento">
          ${summaryCard({
    masked: hide,
    sub: `${summary.monthTotals.count} transaksi tercatat bulan ini · ${deltaSummaryText}`,
    items: [
      {
        label: 'Pemasukan', value: summary.monthTotals.income, iconName: 'trending-up', color: 'var(--pos)',
        delta: summary.incomeDelta, deltaOpts: { suffix: 'vs bulan lalu' },
      },
      {
        label: 'Pengeluaran', value: summary.monthTotals.expense, iconName: 'trending-down', color: 'var(--neg)',
        delta: summary.expenseDelta, deltaOpts: { invert: true, suffix: 'vs bulan lalu' },
      },
      {
        label: 'Net Cash Flow', value: summary.monthTotals.net, iconName: 'switch', color: 'var(--brand-500)',
        delta: summary.netDelta, negative: summary.monthTotals.net < 0,
        deltaOpts: { suffix: 'vs bulan lalu' },
        sub: summary.monthTotals.net >= 0 ? 'Surplus' : 'Defisit',
      },
      {
        label: 'Savings Rate', value: summary.monthTotals.savingsRate, iconName: 'target', color: 'var(--accent)',
        format: 'percent', decimals: 1,
        delta: summary.monthTotals.savingsRate - summary.savingsPrev,
        deltaOpts: { suffix: 'poin', unit: 'point' },
        sub: `Dana darurat ${money(summary.assets[ACCOUNT_TYPES.EMERGENCY_FUND] || 0, { compact: true })}`,
      },
    ],
  })}
        </div>

        <div class="bento">
          ${chartCard({
    cls: 'col-8', title: 'Arus Kas: Pemasukan vs Pengeluaran', sub: chart.sub,
    actions: `<div class="segmented segmented-sm" data-segment="cashflow">${RANGE_OPTIONS.map((o) => `<button data-value="${o.value}" aria-selected="${o.value === chartPreset}">${o.label}</button>`).join('')}</div>`,
    body: `<div class="chart-wrap" data-chart-body>${chart.html}</div>`,
    legend: chart.legend,
  })}
          <div class="col-4 stack-4">
            <section class="card">
              <div class="card-head">
                <div><h3>Aksi Cepat</h3><div class="card-sub">Catat transaksi dalam hitungan detik</div></div>
              </div>
              ${quickActions(QUICK_ACTIONS)}
            </section>
            <section class="card">
              <div class="card-head">
                <div><h3>Kesehatan Budget</h3><div class="card-sub">${budgets.length ? `${budgets.length} budget aktif bulan ini` : 'Belum ada budget'}</div></div>
                <div class="card-head-actions"><button class="btn btn-sm btn-ghost" data-go="budgets">Kelola</button></div>
              </div>
              ${topBudgets.length
    ? `<div>${topBudgets.map((row) => budgetRow({ row, format: (v) => (hide ? MASK : money(v)) })).join('')}</div>`
    : `<div class="banner">${icon('target', { size: 18 })}<div class="grow t-xs">Tentukan budget bulanan untuk mengontrol pengeluaran.</div>
       <button class="btn btn-sm btn-soft" data-quick="budget">Buat</button></div>`}
            </section>
          </div>
        </div>

        <div class="bento">
          <section class="card card-flush col-12">
            <div class="card-head" style="padding:var(--s-5) var(--s-5) var(--s-3)">
              <div><h3>Transaksi Terbaru</h3><div class="card-sub">${summary.monthTotals.count} transaksi bulan ini · 5 terakhir</div></div>
              <div class="card-head-actions"><button class="btn btn-sm btn-outline" data-go="transactions">Lihat semua ${icon('chevron-right', { size: 14 })}</button></div>
            </div>
            <div class="ledger-card" data-recent>
              ${recent.length ? ledgerHtml(recent, { state, masked: hide, compact: true, limit: HOME_RECENT_LIMIT }) : `<div class="empty-state" style="padding:var(--s-7) var(--s-5)">
                ${iconTile('inbox', { size: 54, radius: 18, iconSize: 26 })}
                <h3>Belum ada transaksi</h3><p>Mulai catat pemasukan atau pengeluaran pertama Anda.</p>
                <button class="btn btn-primary" data-quick="expense">${icon('plus', { size: 18 })} Tambah Transaksi</button></div>`}
            </div>
          </section>
        </div>

        <div class="bento">
          <div class="col-8 stack-4">
            <section class="card">
              <div class="card-head">
                <div><h3>Saldo Akun</h3><div class="card-sub">${accountsActive.length} akun terhubung</div></div>
                <div class="card-head-actions"><button class="btn btn-sm btn-outline" data-go="accounts">Kelola akun ${icon('chevron-right', { size: 14 })}</button></div>
              </div>
              ${accountRail({
    masked: hide,
    accounts: accountsActive.map((row) => ({
      account: row.account,
      balance: row.balance,
      meta: row.lastActivity ? `${row.lastActivity.slice(8, 10)}/${row.lastActivity.slice(5, 7)}` : '',
    })),
  })}
            </section>
            <section class="card">
              <div class="card-head">
                <div><h3>Hutang &amp; Piutang</h3><div class="card-sub">${openDebts.length + openRec.length} catatan aktif · 1 pengingat terdekat</div></div>
                <div class="card-head-actions"><button class="btn btn-sm btn-ghost" data-go="debts">Detail ${icon('chevron-right', { size: 14 })}</button></div>
              </div>
              ${debtPairCard({
    debtTotal: summary.worth.debts, recTotal: summary.worth.receivables,
    debtCount: openDebts.length, recCount: openRec.length,
    nearestDebt, nearestRec, masked: hide,
  })}
            </section>
          </div>
          <section class="card col-4">
            <div class="card-head">
              <div><h3>Financial Insights</h3><div class="card-sub">Berdasarkan data Anda</div></div>
              ${iconTile('sparkles', { color: 'var(--accent)', size: 32, radius: 10, iconSize: 16 })}
            </div>
            <div class="stack-3" style="max-height:420px;overflow-y:auto;padding-right:2px">
              ${summary.insights.length
    ? summary.insights.slice(0, 6).map(insightCard).join('')
    : '<div class="banner">' + icon('info', { size: 18 }) + '<div class="t-xs grow">Insight akan muncul setelah ada cukup riwayat transaksi (minimal 2 bulan).</div></div>'}
            </div>
          </section>
        </div>
      </div>
    `;

    /* ---------------- interactions ---------------- */
    animateCounters(root);
    const stopTilt = attachCardTilt(root);

    const bindChart = () => {
      const body = qs('[data-chart-body]', root);
      if (!body) return;
      attachChartTooltips(qs('.chart-wrap', root));
      void body;
    };
    bindChart();

    cleanupChart = onSegment(root, 'cashflow', (value) => {
      chartPreset = value;
      const updated = cashflowChart(store.state, value);
      const wrap = qs('[data-chart-body]', root);
      wrap.innerHTML = updated.html;
      qs('.card-sub', wrap.closest('.card')).textContent = updated.sub.replace(/&amp;/g, '&');
      const legend = qs('.chart-legend', wrap.closest('.card'));
      if (legend) legend.innerHTML = updated.legend;
      attachChartTooltips(wrap);
      toast(`Periode grafik: ${RANGE_OPTIONS.find((r) => r.value === value)?.label}`, { duration: 1600 });
    });

    const rerender = () => ctx.rerender();

    const cleanups = [
      cleanupChart,
      stopTilt,
      on(root, 'click', '[data-toggle-secret]', async () => {
        const next = !store.state.settings.hide_balance;
        await store.setSetting('hide_balance', next);
        toast(next ? 'Saldo disembunyikan.' : 'Saldo ditampilkan kembali.', {
          tone: 'info', duration: 1800, title: next ? 'Mode privasi aktif' : 'Mode privasi nonaktif',
        });
        rerender();
      }),
      on(root, 'click', '[data-txn-id]', (event, el) => {
        openTransactionDetail(el.dataset.txnId, { onChanged: rerender });
      }),
      on(root, 'click', '[data-quick]', (event, el) => {
        const key = el.dataset.quick;
        if (key === 'report') { ctx.navigate('reports'); return; }
        if (key === 'budget') { openBudgetForm({ onSaved: rerender }); return; }
        if (key === 'attachment') { openTransactionForm({ presetType: TRANSACTION_TYPES.EXPENSE, onSaved: rerender }); return; }
        openTransactionForm({ presetType: key, onSaved: rerender });
      }),
      on(root, 'click', '[data-pay-debt]', (event, el) => openDebtPayment({ debtId: el.dataset.payDebt, onDone: rerender })),
      on(root, 'click', '[data-receive]', (event, el) => openReceivablePayment({ receivableId: el.dataset.receive, onDone: rerender })),
      on(root, 'click', '[data-go]', (event, el) => ctx.navigate(el.dataset.go)),
      on(root, 'click', '[data-account-card]', (event, el) => ctx.navigate('accounts', { id: el.dataset.accountCard })),
    ];

    /* rail saldo akun: tombol panah + status geser */
    const rail = qs('[data-rail]', root);
    if (rail) {
      const step = () => Math.max(rail.clientWidth * 0.8, 160);
      const wrap = rail.closest('.rail-wrap');
      const sync = () => {
        const max = rail.scrollWidth - rail.clientWidth - 2;
        const startsAt = rail.scrollLeft <= 2;
        const endsAt = rail.scrollLeft >= max;
        wrap?.classList.toggle('has-overflow', rail.scrollWidth - rail.clientWidth > 4);
        wrap?.classList.toggle('is-start', startsAt);
        wrap?.classList.toggle('is-end', endsAt);
      };
      cleanups.push(on(root, 'click', '[data-rail-nav]', (event, el) => {
        event.preventDefault();
        rail.scrollBy({ left: Number(el.dataset.railNav) * step(), behavior: 'smooth' });
      }));
      cleanups.push(on(rail, 'scroll', sync, { passive: true }));
      sync();
      requestAnimationFrame(sync);
    }

    if (hide) {
      // Jaring pengaman: sisa nominal (ringkasan, sumbu grafik, tooltip) ikut disensor.
      maskMoneyInDom(root);
      const sweep = setTimeout(() => maskMoneyInDom(root), 950);
      cleanups.push(() => clearTimeout(sweep));
    }

    return () => cleanups.forEach((fn) => fn?.());
  },
};

export default dashboardPage;
