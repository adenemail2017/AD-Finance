/**
 * Accounts — banks, e-wallets, cash, investment and emergency-fund envelopes.
 * Balances are always derived from the ledger (opening balance + movements).
 */

import store from '../services/store.js';
import {
  accountFlow, accountSummaries, assetTotals, buildStatement, sortTransactions, totalBalance,
} from '../services/finance.js';
import { ACCOUNT_TYPES, ACCOUNT_TYPE_META, TRANSACTION_TYPES } from '../types/models.js';
import { esc, on, qs, qsa } from '../utils/dom.js';
import { money, maskAccountNumber } from '../utils/format.js';
import { formatDate, rangeForPreset } from '../utils/date.js';
import { icon, iconTile, COLOR_CHOICES } from '../components/icons.js';
import {
  badgeHtml, confirmDialog, emptyState, fieldHtml, moneyHtml, openAdaptive, progressHtml, toast,
} from '../components/ui.js';
import { accountCard, animateCounters, chartCard } from '../components/cards.js';
import { ledgerHtml, openTransactionDetail, openTransactionForm } from '../components/ledger.js';
import { INSTITUTION_PRESETS } from '../database/seed.js';
import { lineAreaChart, attachChartTooltips } from '../components/charts.js';
import { dailySeries } from '../services/finance.js';

const ICON_CHOICES = ['bank', 'wallet', 'cash', 'chart', 'shield', 'credit-card', 'coins', 'store'];

export const accountsPage = {
  id: 'accounts',
  title: 'Accounts',
  eyebrow: 'Dompet & Rekening',
  render(root, ctx) {
    let cleanups = [];
    const state = store.state;
    const summaries = accountSummaries(state);
    const active = summaries.filter((s) => s.account.status !== 'archived');
    const archived = summaries.filter((s) => s.account.status === 'archived');
    const totals = assetTotals(state);
    const range = rangeForPreset('30d');

    const typeGroups = [
      { type: ACCOUNT_TYPES.BANK, label: 'Bank', icon: 'bank' },
      { type: ACCOUNT_TYPES.EWALLET, label: 'E-Wallet', icon: 'wallet' },
      { type: ACCOUNT_TYPES.CASH, label: 'Cash', icon: 'cash' },
      { type: ACCOUNT_TYPES.INVESTMENT, label: 'Investasi', icon: 'chart' },
      { type: ACCOUNT_TYPES.EMERGENCY_FUND, label: 'Dana Darurat', icon: 'shield' },
    ];

    root.innerHTML = `
      <div class="page-enter stack-5">
        <div class="page-head">
          <div>
            <h2>Accounts</h2>
            <p>${active.length} akun aktif · total saldo ${esc(money(totalBalance(state)))}</p>
          </div>
          <div class="page-head-actions">
            <button class="btn btn-outline" data-new-transfer>${icon('switch', { size: 17 })} Transfer</button>
            <button class="btn btn-primary" data-new-account>${icon('plus', { size: 17 })} Tambah Akun</button>
          </div>
        </div>

        <div class="bento">
          <section class="card col-8">
            <div class="card-head">
              <div><h3>Distribusi Saldo</h3><div class="card-sub">Ke mana uang Anda tersebar</div></div>
            </div>
            <div class="seg-line" style="height:14px">
              ${typeGroups.filter((g) => totals[g.type] > 0).map((g) => {
    const color = { bank: 'var(--brand-500)', ewallet: '#0ea5e9', cash: '#22c55e', investment: '#6366f1', emergency_fund: '#0d9488' }[g.type];
    const pct = (totals[g.type] / (totalBalance(state) || 1)) * 100;
    return `<span style="width:${pct.toFixed(1)}%;background:${color}" title="${esc(g.label)}"></span>`;
  }).join('')}
            </div>
            <div class="grid mt-4" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
              ${typeGroups.map((g) => `<div class="stat-box">
                <div class="stat-label">${esc(g.label)}</div>
                <div class="stat-value">${esc(money(totals[g.type] || 0))}</div>
              </div>`).join('')}
            </div>
          </section>

          <section class="card col-4">
            <div class="card-head"><div><h3>Kekayaan Bersih</h3><div class="card-sub">Aset − hutang</div></div></div>
            <div class="metric-value" data-count="${totalBalance(state)}">${esc(money(totalBalance(state)))}</div>
            <div class="stack-3 mt-4">
              <div class="row t-xs"><span class="t-dim grow">Aset likuid</span>${moneyHtml(totalBalance(state))}</div>
              <div class="row t-xs"><span class="t-dim grow">Dana darurat</span>${moneyHtml(totals[ACCOUNT_TYPES.EMERGENCY_FUND] || 0)}</div>
              <div class="row t-xs"><span class="t-dim grow">Investasi</span>${moneyHtml(totals[ACCOUNT_TYPES.INVESTMENT] || 0)}</div>
              <div class="row t-xs"><span class="t-dim grow">Hutang</span>${moneyHtml(-state.debts.reduce((acc, d) => acc + d.principal, 0))}</div>
            </div>
            <button class="btn btn-outline btn-block mt-4" data-new-account>${icon('plus', { size: 16 })} Akun baru</button>
          </section>
        </div>

        ${typeGroups.map((group) => {
    const rows = active.filter((s) => s.account.account_type === group.type);
    if (!rows.length) return '';
    return `<section class="stack-3">
      <div class="section-head">
        ${iconTile(group.icon, { size: 32, radius: 10, iconSize: 16 })}
        <div><h3>${esc(group.label)}</h3><div class="section-sub">${rows.length} akun · ${esc(money(totals[group.type] || 0))}</div></div>
      </div>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:var(--s-3)">
        ${rows.map((row) => {
      const flow = accountFlow(state, row.account.id, range.from, range.to);
      return accountCard({
        account: row.account,
        balance: row.balance,
        meta: flow.inflow + flow.outflow > 0
          ? `30 hari: +${money(flow.inflow, { compact: true }).replace('Rp ', '')} / −${money(flow.outflow, { compact: true }).replace('Rp ', '')}`
          : 'Belum ada aktivitas 30 hari',
      });
    }).join('')}
      </div>
    </section>`;
  }).join('')}

        ${archived.length ? `<section class="stack-3">
          <div class="section-head"><div><h3>Arsip</h3><div class="section-sub">${archived.length} akun</div></div></div>
          <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:var(--s-3)">
            ${archived.map((row) => accountCard({ account: row.account, balance: row.balance })).join('')}
          </div>
        </section>` : ''}

        ${!active.length ? `<section class="card">${emptyState({
    title: 'Belum ada akun', illustration: 'accounts',
    message: 'Tambahkan rekening bank, e-wallet, atau dompet cash untuk mulai mencatat transaksi.',
    actionLabel: 'Tambah Akun', actionAttrs: 'data-new-account',
  })}</section>` : ''}
      </div>
    `;

    animateCounters(root);

    const rerender = () => ctx.rerender();

    cleanups.push(on(root, 'click', '[data-account-card]', (event, el) => openAccountDetail(el.dataset.accountCard, { onChanged: rerender, navigate: ctx.navigate })));
    cleanups.push(on(root, 'click', '[data-new-account]', () => openAccountForm({ onSaved: rerender })));
    cleanups.push(on(root, 'click', '[data-new-transfer]', () => openTransactionForm({
      presetType: TRANSACTION_TYPES.TRANSFER, onSaved: rerender,
    })));

    // deep-link from dashboard: open detail directly
    if (ctx.params?.id) setTimeout(() => openAccountDetail(ctx.params.id, { onChanged: rerender, navigate: ctx.navigate }), 120);

    return () => cleanups.forEach((fn) => fn?.());
  },
};

/* ------------------------------------------------------------------ */
/* Account detail                                                      */
/* ------------------------------------------------------------------ */

export function openAccountDetail(accountId, { onChanged, navigate } = {}) {
  const state = store.state;
  const account = state.accounts.find((a) => a.id === accountId);
  if (!account) return null;
  const summaries = accountSummaries(state);
  const row = summaries.find((s) => s.account.id === accountId);
  const range = rangeForPreset('30d');
  const flow = accountFlow(state, accountId, range.from, range.to);
  const history = sortTransactions(state.transactions.filter((t) => t.account_id === accountId || t.destination_account_id === accountId), 'desc');
  const spark = dailySeries(state, range.from, range.to).map((d) => d.net);
  const typeLabel = ACCOUNT_TYPE_META[account.account_type]?.label || 'Akun';

  return openAdaptive({
    title: account.name,
    subtitle: `${typeLabel}${account.institution ? ` · ${account.institution}` : ''}`,
    iconName: account.icon,
    size: 'sm',
    body: `
      <div class="stack-5">
        <div class="row-between">
          <div>
            <div class="t-label">Saldo saat ini</div>
            <div class="t-display" style="font-size:30px" data-count="${row?.balance || 0}">${esc(money(row?.balance || 0))}</div>
            <div class="t-2xs t-dim mt-1">Saldo awal ${esc(money(account.opening_balance, { compact: true }))} · ${history.length} transaksi</div>
          </div>
          <button class="icon-btn" data-reveal title="Tampilkan / sembunyikan nomor">${icon('eye', { size: 18 })}</button>
        </div>

        <div class="grid grid-3">
          <div class="stat-box"><div class="stat-label">Masuk 30 hari</div><div class="stat-value t-pos">${esc(money(flow.inflow, { compact: true }))}</div></div>
          <div class="stat-box"><div class="stat-label">Keluar 30 hari</div><div class="stat-value t-neg">${esc(money(flow.outflow, { compact: true }))}</div></div>
          <div class="stat-box"><div class="stat-label">Net 30 hari</div><div class="stat-value">${esc(money(flow.net, { compact: true }))}</div></div>
        </div>

        <div class="chart-wrap chart-compact">${lineAreaChart({
    labels: dailySeries(state, range.from, range.to).map((d) => d.date.slice(8, 10)),
    series: [{ name: 'Net harian', color: account.color || 'var(--brand-500)', values: spark }],
    height: 134, format: (v) => money(v, { compact: true }), showDots: false, zeroLine: true,
  })}</div>

        <dl class="kv kv-tight">
          <dt>Jenis</dt><dd>${esc(typeLabel)}</dd>
          ${account.institution ? `<dt>Institusi</dt><dd>${esc(account.institution)}</dd>` : ''}
          <dt>Nomor</dt><dd data-number class="t-mono" data-masked="${esc(maskAccountNumber(account.account_number) || '—')}" data-real="${esc(account.account_number || '—')}">${esc(maskAccountNumber(account.account_number) || '—')}</dd>
          <dt>Status</dt><dd>${badgeHtml(account.status === 'archived' ? 'Diarsipkan' : 'Aktif', account.status === 'archived' ? 'outline' : 'pos')}</dd>
          ${account.notes ? `<dt>Catatan</dt><dd>${esc(account.notes)}</dd>` : ''}
        </dl>

        <div>
          <div class="row-between mb-2">
            <span class="field-label">Transaksi terakhir</span>
            <button class="btn btn-sm btn-ghost" data-statement>Rekening koran ${icon('chevron-right', { size: 14 })}</button>
          </div>
          <div class="ledger" style="border:1px solid var(--line);border-radius:var(--r-md);overflow:hidden;max-height:240px;overflow-y:auto">
            ${history.length ? ledgerHtml(history.slice(0, 25), { state }) : '<div class="t-xs t-dim" style="padding:var(--s-4)">Belum ada transaksi pada akun ini.</div>'}
          </div>
        </div>
      </div>`,
    footer: `
      <button class="btn btn-ghost" data-edit>${icon('edit', { size: 16 })} Edit</button>
      <button class="btn btn-danger-soft" data-delete>${icon('trash', { size: 16 })} ${history.length ? 'Arsipkan' : 'Hapus'}</button>
      <button class="btn btn-primary ml-auto" data-add-txn>${icon('plus', { size: 16 })} Transaksi</button>`,
    onMount(sheet, api) {
      attachChartTooltips(qs('.chart-wrap', sheet));
      on(sheet, 'click', '[data-reveal]', () => {
        const el = qs('[data-number]', sheet);
        const revealed = el.dataset.revealed === '1';
        el.textContent = revealed ? el.dataset.masked : el.dataset.real;
        el.dataset.revealed = revealed ? '0' : '1';
      });
      on(sheet, 'click', '[data-txn-id]', (event, el) => {
        openTransactionDetail(el.dataset.txnId, { onChanged: () => { onChanged?.(); } });
      });
      on(sheet, 'click', '[data-edit]', () => {
        api.close();
        openAccountForm({ account, onSaved: onChanged });
      });
      on(sheet, 'click', '[data-statement]', () => {
        api.close();
        navigate?.('reports', { accountId: account.id, tab: 'statement' });
      });
      on(sheet, 'click', '[data-add-txn]', () => {
        api.close();
        openTransactionForm({ preset: { account_id: account.id }, onSaved: onChanged });
      });
      on(sheet, 'click', '[data-delete]', async () => {
        const hasHistory = history.length > 0;
        const yes = await confirmDialog({
          title: hasHistory ? 'Arsipkan akun ini?' : 'Hapus akun ini?',
          message: hasHistory
            ? 'Akun dengan riwayat transaksi tidak dihapus permanen agar laporan tetap utuh — akun akan diarsipkan dan disembunyikan dari dashboard.'
            : 'Akun tanpa riwayat akan dihapus permanen.',
          confirmText: hasHistory ? 'Arsipkan' : 'Hapus', tone: 'danger',
        });
        if (!yes) return;
        const result = await store.deleteAccount(account.id);
        api.close();
        toast(result.archived ? 'Akun diarsipkan.' : 'Akun dihapus.', { tone: 'pos' });
        onChanged?.();
      });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Account form                                                        */
/* ------------------------------------------------------------------ */

export function openAccountForm({ account = null, onSaved, presetType = ACCOUNT_TYPES.BANK } = {}) {
  const editing = !!account;
  const draft = {
    name: account?.name || '',
    account_type: account?.account_type || presetType,
    institution: account?.institution || '',
    account_number: account?.account_number || '',
    opening_balance: account?.opening_balance || 0,
    color: account?.color || '#2563eb',
    icon: account?.icon || 'bank',
    notes: account?.notes || '',
    status: account?.status || 'active',
  };

  const typeOptions = Object.entries(ACCOUNT_TYPE_META).map(([key, meta]) => `
    <button type="button" class="option-tile ${draft.account_type === key ? 'is-active' : ''}" data-acct-type="${key}">
      ${iconTile(meta.icon, { size: 30, radius: 9, iconSize: 16 })}
      <span class="option-title">${esc(meta.label)}</span>
    </button>`).join('');

  return openAdaptive({
    title: editing ? 'Edit Akun' : 'Tambah Akun',
    subtitle: editing ? account.name : 'Bank, e-wallet, cash, investasi atau dana darurat',
    iconName: 'bank',
    size: 'md',
    body: `
      <div class="stack-5">
        <div class="field"><span class="field-label">Jenis Akun</span><div class="option-grid" data-types>${typeOptions}</div></div>

        <div class="field">
          <span class="field-label">Pilih cepat institusi</span>
          <div class="chip-row" data-presets></div>
        </div>

        <div class="grid grid-2">
          ${fieldHtml({ label: 'Nama Akun', name: 'name', id: 'acc-name', control: `<input class="input" id="acc-name" data-autofocus data-name placeholder="BCA / DANA / Cash" value="${esc(draft.name)}" maxlength="40" />` })}
          ${fieldHtml({ label: 'Institusi (opsional)', name: 'institution', id: 'acc-inst', control: `<input class="input" id="acc-inst" data-institution placeholder="Bank Central Asia" value="${esc(draft.institution)}" />` })}
        </div>

        <div class="grid grid-2">
          ${fieldHtml({ label: 'Nomor Akun (opsional)', name: 'account_number', id: 'acc-num', hint: 'Disimpan lokal, ditampilkan tersamarkan', control: `<input class="input" id="acc-num" data-number-input placeholder="1234567890" value="${esc(draft.account_number)}" class="t-mono" inputmode="numeric" />` })}
          ${fieldHtml({ label: editing ? 'Saldo Awal (terkunci setelah ada transaksi)' : 'Saldo Awal', name: 'opening_balance', id: 'acc-bal', control: `<div class="input-group"><span class="input-prefix">Rp</span><input class="input" style="padding-left:44px" id="acc-bal" data-opening inputmode="numeric" value="${draft.opening_balance ? Number(draft.opening_balance).toLocaleString('id-ID') : ''}" placeholder="0" /></div>` })}
        </div>

        <div class="field"><span class="field-label">Warna</span>
          <div class="swatch-grid" data-colors>${COLOR_CHOICES.map((c) => `<button type="button" class="swatch ${c === draft.color ? 'is-active' : ''}" data-color="${c}" style="background:${c}" aria-label="Warna ${c}"></button>`).join('')}</div>
        </div>

        <div class="field"><span class="field-label">Ikon</span>
          <div class="swatch-grid" data-icons>${ICON_CHOICES.map((n) => `<button type="button" class="icon-btn ${n === draft.icon ? 'is-active' : ''}" data-icon-name="${n}" style="border:1px solid var(--line)">${icon(n, { size: 18 })}</button>`).join('')}</div>
        </div>

        ${fieldHtml({ label: 'Catatan', name: 'notes', id: 'acc-notes', control: `<textarea class="textarea" id="acc-notes" data-notes placeholder="Tujuan akun, limit, dsb (opsional)">${esc(draft.notes)}</textarea>` })}
      </div>`,
    footer: `<button class="btn btn-ghost" data-close>Batal</button>
      <button class="btn btn-primary ml-auto" data-save>${icon('check', { size: 17 })} ${editing ? 'Simpan Perubahan' : 'Simpan Akun'}</button>`,
    onMount(sheet, api) {
      const presetHost = qs('[data-presets]', sheet);
      const renderPresets = () => {
        const key = draft.account_type === ACCOUNT_TYPES.BANK ? 'bank'
          : draft.account_type === ACCOUNT_TYPES.EWALLET ? 'ewallet'
            : draft.account_type === ACCOUNT_TYPES.CASH ? 'cash'
              : draft.account_type === ACCOUNT_TYPES.INVESTMENT ? 'investment' : 'emergency_fund';
        presetHost.innerHTML = (INSTITUTION_PRESETS[key] || []).map((p) => `<button type="button" class="chip" data-preset="${esc(p.name)}">${esc(p.name)}</button>`).join('');
      };
      renderPresets();

      on(sheet, 'click', '[data-preset]', (event, el) => {
        const preset = Object.values(INSTITUTION_PRESETS).flat().find((p) => p.name === el.dataset.preset);
        if (!preset) return;
        draft.name = preset.name;
        draft.institution = preset.name;
        draft.color = preset.color;
        draft.icon = preset.icon;
        qs('[data-name]', sheet).value = preset.name;
        qs('[data-institution]', sheet).value = preset.name;
        qsa('[data-color]', sheet).forEach((b) => b.classList.toggle('is-active', b.dataset.color === preset.color));
        qsa('[data-icon-name]', sheet).forEach((b) => b.classList.toggle('is-active', b.dataset.iconName === preset.icon));
      });

      on(sheet, 'click', '[data-acct-type]', (event, el) => {
        draft.account_type = el.dataset.acctType;
        qsa('[data-acct-type]', sheet).forEach((b) => b.classList.toggle('is-active', b === el));
        if (!editing || !qs('[data-name]', sheet).value) {
          const first = (INSTITUTION_PRESETS[draft.account_type] || INSTITUTION_PRESETS.bank)[0];
          if (!editing) {
            draft.name = first.name;
            draft.institution = first.name;
            draft.color = first.color;
            draft.icon = first.icon;
            qs('[data-name]', sheet).value = first.name;
            qs('[data-institution]', sheet).value = first.name;
            qsa('[data-color]', sheet).forEach((b) => b.classList.toggle('is-active', b.dataset.color === first.color));
          }
        }
        renderPresets();
      });

      on(sheet, 'click', '[data-color]', (event, el) => {
        draft.color = el.dataset.color;
        qsa('[data-color]', sheet).forEach((b) => b.classList.toggle('is-active', b === el));
      });
      on(sheet, 'click', '[data-icon-name]', (event, el) => {
        draft.icon = el.dataset.iconName;
        qsa('[data-icon-name]', sheet).forEach((b) => b.classList.toggle('is-active', b === el));
      });

      const openingInput = qs('[data-opening]', sheet);
      openingInput.addEventListener('input', () => {
        const digits = openingInput.value.replace(/[^\d]/g, '');
        openingInput.value = digits ? Number(digits).toLocaleString('id-ID') : '';
      });

      on(sheet, 'click', '[data-save]', async () => {
        const name = qs('[data-name]', sheet).value.trim();
        if (!name) { toast('Nama akun wajib diisi.', { tone: 'warn' }); return; }
        const payload = {
          name,
          account_type: draft.account_type,
          institution: qs('[data-institution]', sheet).value.trim(),
          account_number: qs('[data-number-input]', sheet).value.trim(),
          opening_balance: Number(openingInput.value.replace(/[^\d]/g, '')) || 0,
          color: draft.color,
          icon: draft.icon,
          notes: qs('[data-notes]', sheet).value.trim(),
        };
        try {
          if (editing) await store.updateAccount(account.id, payload);
          else await store.addAccount(payload);
          api.close();
          toast(editing ? 'Akun diperbarui.' : `Akun ${name} ditambahkan.`, { tone: 'pos', title: 'Berhasil' });
          onSaved?.();
        } catch (error) {
          toast(error.message || 'Gagal menyimpan akun.', { tone: 'neg' });
        }
      });
    },
  });
}
