/**
 * Budget management — monthly envelopes per category with 80% / 100% alerts.
 */

import store from '../services/store.js';
import { budgetUsage, categoryBreakdown } from '../services/finance.js';
import { esc, on, qs, qsa } from '../utils/dom.js';
import { money, formatAmountTyping, parseMoneyInput } from '../utils/format.js';
import { formatMonth, monthKey, monthOptions } from '../utils/date.js';
import { icon, iconTile } from '../components/icons.js';
import {
  badgeHtml, confirmDialog, emptyState, fieldHtml, moneyHtml, openAdaptive, progressHtml, toast,
} from '../components/ui.js';
import { animateCounters, budgetRow, metricCard } from '../components/cards.js';
import { breakdownBars, donutChart, attachChartTooltips } from '../components/charts.js';

export const budgetsPage = {
  id: 'budgets',
  title: 'Budget',
  eyebrow: 'Kontrol Pengeluaran',
  render(root, ctx) {
    let period = ctx.params?.period || monthKey();
    let cleanups = [];

    function renderPage() {
      const state = store.state;
      const rows = budgetUsage(state, period);
      const breakdown = categoryBreakdown(state, {
        from: `${period}-01`, to: `${period}-31`, kind: 'expense',
      });
      const totalBudget = rows.reduce((acc, r) => acc + r.amount, 0);
      const totalSpent = rows.reduce((acc, r) => acc + r.spent, 0);
      const totalExpense = breakdown.reduce((acc, r) => acc + r.total, 0);
      const unbudgeted = Math.max(0, totalExpense - totalSpent);
      const overallUsage = totalBudget ? (totalSpent / totalBudget) * 100 : 0;
      const budgetedIds = new Set(rows.map((r) => r.budget.category_id));
      const candidates = breakdown.filter((b) => !budgetedIds.has(b.category.id));

      root.innerHTML = `
        <div class="page-enter stack-5">
          <div class="page-head">
            <div>
              <h2>Budget</h2>
              <p>Atur batas pengeluaran bulanan per kategori dan pantau realisasinya.</p>
            </div>
            <div class="page-head-actions">
              <select class="select" data-period style="width:auto">
                ${monthOptions(18).map((o) => `<option value="${esc(o.value)}" ${o.value === period ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
              </select>
              <button class="btn btn-primary" data-new>${icon('plus', { size: 17 })} Budget Baru</button>
            </div>
          </div>

          <div class="bento">
            ${metricCard({
    cls: 'col-3', label: 'Total Budget', value: totalBudget, iconName: 'target', color: 'var(--brand-500)',
    sub: `${rows.length} kategori dianggarkan`,
  })}
            ${metricCard({
    cls: 'col-3', label: 'Terpakai', value: totalSpent, iconName: 'trending-down', color: 'var(--neg)',
    sub: `${overallUsage.toFixed(0)}% dari total budget`,
  })}
            ${metricCard({
    cls: 'col-3', label: 'Sisa Budget', value: Math.max(0, totalBudget - totalSpent), iconName: 'wallet', color: 'var(--pos)',
    sub: totalSpent > totalBudget ? `Overspend ${money(totalSpent - totalBudget)}` : 'Masih dalam batas aman',
  })}
            ${metricCard({
    cls: 'col-3', label: 'Tanpa Budget', value: unbudgeted, iconName: 'alert-circle', color: 'var(--warn)',
    sub: `${candidates.length} kategori belum dianggarkan`,
  })}
          </div>

          <div class="bento">
            <section class="card col-7">
              <div class="card-head">
                <div><h3>Realisasi Budget ${esc(formatMonth(period))}</h3>
                  <div class="card-sub">${esc(money(totalSpent))} dari ${esc(money(totalBudget))}</div></div>
                ${badgeHtml(overallUsage >= 100 ? 'Overspending' : overallUsage >= 80 ? 'Hampir habis' : 'Aman',
    overallUsage >= 100 ? 'neg' : overallUsage >= 80 ? 'warn' : 'pos')}
              </div>
              ${progressHtml(Math.min(overallUsage, 100), { tone: overallUsage >= 100 ? 'neg' : overallUsage >= 80 ? 'warn' : 'pos', size: 'progress-lg' })}
              <div class="mt-5">
                ${rows.length ? rows.map((row) => budgetRow({ row })).join('')
    : emptyState({
      title: 'Belum ada budget', illustration: '',
      message: 'Tentukan batas pengeluaran per kategori, misalnya Food Rp 2.000.000 per bulan.',
      actionLabel: 'Buat Budget', actionAttrs: 'data-new',
    })}
              </div>
            </section>

            <section class="card col-5">
              <div class="card-head">
                <div><h3>Komposisi Pengeluaran</h3><div class="card-sub">${esc(formatMonth(period))} · ${esc(money(totalExpense))}</div></div>
              </div>
              ${breakdown.length ? `<div class="chart-wrap">${donutChart({
    segments: breakdown.slice(0, 6).map((b) => ({ label: b.category.name, value: b.total, color: b.category.color })),
    size: 158, thickness: 19,
    centerValue: money(totalExpense, { compact: true }).replace('Rp ', ''),
    centerLabel: 'Total',
    format: (v) => money(v, { compact: true }),
  })}</div>` : '<div class="t-xs t-dim">Belum ada pengeluaran pada periode ini.</div>'}
            </section>
          </div>

          ${candidates.length ? `<section class="card">
            <div class="card-head">
              <div><h3>Kategori Tanpa Budget</h3><div class="card-sub">Kategori dengan pengeluaran namun belum dianggarkan</div></div>
            </div>
            <div class="row wrap gap-2">
              ${candidates.slice(0, 10).map((c) => `<button class="chip" data-quick-budget="${esc(c.category.id)}">
                ${iconTile(c.category.icon, { color: c.category.color, size: 20, radius: 6, iconSize: 12 })}
                ${esc(c.category.name)} · ${esc(money(c.total, { compact: true }))} ${icon('plus', { size: 13 })}
              </button>`).join('')}
            </div>
          </section>` : ''}
        </div>
      `;

      animateCounters(root);
      cleanups.forEach((fn) => fn?.());
      cleanups = bindEvents();
    }

    function bindEvents() {
      return [
        on(root, 'change', '[data-period]', (event, el) => { period = el.value; renderPage(); }),
        on(root, 'click', '[data-new]', () => openBudgetForm({ period, onSaved: renderPage })),
        on(root, 'click', '[data-quick-budget]', (event, el) => openBudgetForm({
          period, categoryId: el.dataset.quickBudget, onSaved: renderPage,
        })),
        on(root, 'click', '[data-budget]', (event, el) => {
          if (event.target.closest('button')) return;
          const row = budgetUsage(store.state, period).find((r) => r.budget.id === el.dataset.budget);
          if (row) openBudgetDetail(row, { onChanged: renderPage });
        }),
      ];
    }

    renderPage();
    return () => cleanups.forEach((fn) => fn?.());
  },
};

/* ------------------------------------------------------------------ */
/* Detail                                                              */
/* ------------------------------------------------------------------ */

function openBudgetDetail(row, { onChanged }) {
  const state = store.state;
  const sub = row.category?.id
    ? categoryBreakdown(state, { from: `${row.budget.period}-01`, to: `${row.budget.period}-31`, kind: 'expense' })
      .find((b) => b.category.id === row.category.id)
    : null;
  const tone = row.level === 'over' ? 'neg' : row.level === 'warn' ? 'warn' : 'pos';

  return openAdaptive({
    title: `Budget ${row.category?.name || 'Kategori'}`,
    subtitle: `${formatMonth(row.budget.period)} · ${money(row.spent)} dari ${money(row.amount)}`,
    iconName: row.category?.icon || 'target',
    size: 'sm',
    body: `
      <div class="stack-5">
        <div class="grid grid-3">
          <div class="stat-box"><div class="stat-label">Budget</div><div class="stat-value">${esc(money(row.amount))}</div></div>
          <div class="stat-box"><div class="stat-label">Terpakai</div><div class="stat-value ${tone === 'neg' ? 't-neg' : ''}">${esc(money(row.spent))}</div></div>
          <div class="stat-box"><div class="stat-label">${row.overspend > 0 ? 'Kelebihan' : 'Sisa'}</div>
            <div class="stat-value">${esc(money(row.overspend > 0 ? row.overspend : row.remaining))}</div></div>
        </div>
        <div class="stack-2">
          <div class="debt-progress-head"><span>Pemakaian ${row.usage.toFixed(0)}%</span>
            ${badgeHtml(row.level === 'over' ? 'Melebihi limit' : row.level === 'warn' ? 'Mendekati limit' : 'Aman', tone)}</div>
          ${progressHtml(Math.min(row.usage, 100), { tone, size: 'progress-lg' })}
        </div>
        ${sub?.subs?.length ? `<div>
          <div class="field-label mb-2">Sub kategori</div>
          <div class="stack-3">${breakdownBars(sub.subs.map((s) => ({ label: s.name, value: s.total, color: row.category.color })), { format: money })}</div>
        </div>` : ''}
      </div>`,
    footer: `<button class="btn btn-ghost" data-close>Tutup</button>
      <button class="btn btn-danger-soft" data-delete>${icon('trash', { size: 16 })} Hapus</button>
      <button class="btn btn-primary ml-auto" data-edit>${icon('edit', { size: 16 })} Ubah Budget</button>`,
    onMount(sheet, api) {
      on(sheet, 'click', '[data-edit]', () => {
        api.close();
        openBudgetForm({ period: row.budget.period, budget: row.budget, categoryId: row.budget.category_id, onSaved: onChanged });
      });
      on(sheet, 'click', '[data-delete]', async () => {
        const yes = await confirmDialog({
          title: 'Hapus budget ini?', message: 'Budget kategori ini akan dihapus untuk periode terpilih.',
          confirmText: 'Hapus', tone: 'danger',
        });
        if (!yes) return;
        await store.deleteBudget(row.budget.id);
        api.close();
        toast('Budget dihapus.', { tone: 'pos' });
        onChanged?.();
      });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Form                                                                */
/* ------------------------------------------------------------------ */

export function openBudgetForm({
  budget = null, period = monthKey(), categoryId = null, onSaved,
} = {}) {
  const state = store.state;
  const draft = {
    id: budget?.id || null,
    category_id: budget?.category_id || categoryId || '',
    amount: budget?.amount || 0,
    period: budget?.period || period,
    rollover: !!budget?.rollover,
  };
  const expenseCats = state.categories.filter((c) => !c.parent_id && !c.archived && c.kind === 'expense')
    .sort((a, b) => a.name.localeCompare(b.name));

  return openAdaptive({
    title: budget ? 'Ubah Budget' : 'Budget Baru',
    subtitle: 'Batas pengeluaran bulanan per kategori',
    iconName: 'target',
    size: 'sm',
    body: `
      <div class="stack-5">
        <div class="option-grid" data-cats style="max-height:230px;overflow-y:auto">
          ${expenseCats.map((c) => `<button type="button" class="option-tile ${draft.category_id === c.id ? 'is-active' : ''}" data-cat="${esc(c.id)}">
            ${iconTile(c.icon, { color: c.color, size: 30, radius: 9, iconSize: 16 })}
            <span class="option-title t-clip" style="width:100%">${esc(c.name)}</span>
          </button>`).join('')}
        </div>
        <div class="grid grid-2">
          ${fieldHtml({ label: 'Periode', name: 'period', id: 'bud-period', control: `<select class="select" id="bud-period" data-period>${monthOptions(18).map((o) => `<option value="${esc(o.value)}" ${o.value === draft.period ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>` })}
          <div class="field">
            <span class="field-label">Batas Budget</span>
            <div class="input-group"><span class="input-prefix">Rp</span>
              <input class="input" style="padding-left:44px" data-amount inputmode="numeric" value="${draft.amount ? formatAmountTyping(draft.amount) : ''}" placeholder="0" data-autofocus />
            </div>
          </div>
        </div>
        <div class="chip-row">
          ${[500_000, 1_000_000, 2_000_000, 3_000_000, 5_000_000].map((v) => `<button type="button" class="chip" data-set="${v}">${esc(money(v, { compact: true }))}</button>`).join('')}
        </div>
      </div>`,
    footer: `<button class="btn btn-ghost" data-close>Batal</button>
      <button class="btn btn-primary ml-auto" data-save>${icon('check', { size: 17 })} Simpan Budget</button>`,
    onMount(sheet, api) {
      const amountInput = qs('[data-amount]', sheet);
      amountInput.addEventListener('input', () => {
        const digits = amountInput.value.replace(/[^\d]/g, '');
        amountInput.value = digits ? formatAmountTyping(parseInt(digits, 10)) : '';
      });
      on(sheet, 'click', '[data-set]', (event, el) => {
        amountInput.value = formatAmountTyping(parseInt(el.dataset.set, 10));
      });
      on(sheet, 'click', '[data-cat]', (event, el) => {
        draft.category_id = el.dataset.cat;
        qsa('[data-cat]', sheet).forEach((b) => b.classList.toggle('is-active', b === el));
      });
      on(sheet, 'click', '[data-save]', async () => {
        if (!draft.category_id) { toast('Pilih kategori terlebih dahulu.', { tone: 'warn' }); return; }
        const amount = parseMoneyInput(amountInput.value);
        if (!amount) { toast('Nominal budget wajib diisi.', { tone: 'warn' }); return; }
        try {
          await store.saveBudget({
            id: draft.id,
            category_id: draft.category_id,
            amount,
            period: qs('[data-period]', sheet).value,
          });
          api.close();
          toast('Budget disimpan.', { tone: 'pos', title: 'Berhasil' });
          onSaved?.();
        } catch (error) {
          toast(error.message || 'Gagal menyimpan budget.', { tone: 'neg' });
        }
      });
    },
  });
}

export default budgetsPage;
