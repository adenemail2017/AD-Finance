/**
 * Debt & Receivable management.
 * Every payment here writes a real ledger entry, so balances stay consistent.
 */

import store from '../services/store.js';
import {
  debtList, debtState, receivableList, receivableState, sortTransactions, txns,
} from '../services/finance.js';
import { esc, on, qs, qsa } from '../utils/dom.js';
import { money, parseMoneyInput, formatAmountTyping } from '../utils/format.js';
import { formatDate, relativeDays, todayISO } from '../utils/date.js';
import { icon, iconTile } from '../components/icons.js';
import {
  badgeHtml, confirmDialog, emptyState, fieldHtml, moneyHtml, openAdaptive, progressHtml, toast,
} from '../components/ui.js';
import { animateCounters, debtCard, receivableCard, metricCard } from '../components/cards.js';
import {
  ledgerHtml, openDebtPayment, openReceivablePayment, openTransactionDetail,
} from '../components/ledger.js';

export const debtsPage = {
  id: 'debts',
  title: 'Hutang & Piutang',
  eyebrow: 'Kewajiban & Tagihan',
  render(root, ctx) {
    let tab = ctx.params?.tab === 'receivables' ? 'receivables' : 'hutang';
    let filter = 'open';
    let cleanups = [];

    function data() {
      const state = store.state;
      const debts = debtList(state, { status: filter });
      const receivables = receivableList(state, { status: filter });
      const openDebts = debtList(state, { status: 'open' });
      const openRec = receivableList(state, { status: 'open' });
      return {
        state,
        debts,
        receivables,
        totals: {
          debtOutstanding: openDebts.reduce((acc, d) => acc + d.info.remaining, 0),
          debtPrincipal: openDebts.reduce((acc, d) => acc + d.info.principal, 0),
          debtPaid: openDebts.reduce((acc, d) => acc + d.info.paid, 0),
          overdueDebts: openDebts.filter((d) => d.info.isOverdue).length,
          recOutstanding: openRec.reduce((acc, r) => acc + r.info.remaining, 0),
          recPrincipal: openRec.reduce((acc, r) => acc + r.info.principal, 0),
          recReceived: openRec.reduce((acc, r) => acc + r.info.received, 0),
          overdueRec: openRec.filter((r) => r.info.isOverdue).length,
          dueSoon: openDebts.filter((d) => d.info.isDueSoon).length + openRec.filter((r) => r.info.isDueSoon).length,
        },
      };
    }

    function renderPage() {
      const {
        state, debts, receivables, totals,
      } = data();
      const isHutang = tab === 'hutang';
      root.innerHTML = `
        <div class="page-enter stack-5">
          <div class="page-head">
            <div>
              <h2>Hutang &amp; Piutang</h2>
              <p>Kelola kewajiban dan tagihan Anda dengan progress pembayaran yang jelas.</p>
            </div>
            <div class="page-head-actions">
              <button class="btn btn-outline" data-new-receivable>${icon('file-text', { size: 17 })} Piutang Baru</button>
              <button class="btn btn-primary" data-new-debt>${icon('plus', { size: 17 })} Hutang Baru</button>
            </div>
          </div>

          <div class="bento">
            ${metricCard({
    cls: 'col-3', label: 'Total Hutang Aktif', value: totals.debtOutstanding, iconName: 'hand-coins',
    color: 'var(--warn)', sub: `${totals.overdueDebts} jatuh tempo · ${esc(money(totals.debtPaid))} sudah dibayar`,
  })}
            ${metricCard({
    cls: 'col-3', label: 'Total Piutang Aktif', value: totals.recOutstanding, iconName: 'file-text',
    color: 'var(--info)', sub: `${totals.overdueRec} terlambat · ${esc(money(totals.recReceived))} sudah diterima`,
  })}
            <section class="card col-6">
              <div class="card-head">
                <div><h3>Ringkasan Posisi</h3><div class="card-sub">Net posisi hutang − piutang</div></div>
                ${badgeHtml(`${totals.dueSoon} mendekati jatuh tempo`, totals.dueSoon ? 'warn' : 'pos', { icon: 'clock' })}
              </div>
              <div class="grid grid-2">
                <div class="stat-box">
                  <div class="stat-label">Net posisi</div>
                  <div class="stat-value ${totals.debtOutstanding - totals.recOutstanding > 0 ? 't-neg' : 't-pos'}">
                    ${esc(money(totals.recOutstanding - totals.debtOutstanding))}
                  </div>
                </div>
                <div class="stat-box">
                  <div class="stat-label">Total transaksi terkait</div>
                  <div class="stat-value">${txns(state).filter((t) => ['debt', 'receivable', 'debt_payment', 'receivable_payment'].includes(t.transaction_type)).length}</div>
                </div>
              </div>
              <div class="seg-line mt-4" style="height:12px">
                <span style="width:${(totals.debtOutstanding / ((totals.debtOutstanding + totals.recOutstanding) || 1) * 100).toFixed(1)}%;background:var(--warn)" title="Hutang"></span>
                <span style="width:${(totals.recOutstanding / ((totals.debtOutstanding + totals.recOutstanding) || 1) * 100).toFixed(1)}%;background:var(--info)" title="Piutang"></span>
              </div>
              <div class="row t-2xs t-dim mt-2"><span>Hutang ${esc(money(totals.debtOutstanding, { compact: true }))}</span><span class="ml-auto">Piutang ${esc(money(totals.recOutstanding, { compact: true }))}</span></div>
            </section>
          </div>

          <section class="stack-4">
            <div class="row wrap gap-3">
              <div class="segmented" data-tabs>
                <button data-tab="hutang" aria-selected="${isHutang}">Hutang (${data().state.debts.length})</button>
                <button data-tab="receivables" aria-selected="${!isHutang}">Piutang (${data().state.receivables.length})</button>
              </div>
              <div class="segmented ml-auto" data-filters>
                ${[['open', 'Aktif'], ['closed', 'Selesai'], ['all', 'Semua']].map(([v, l]) => `<button data-filter="${v}" aria-selected="${filter === v}">${l}</button>`).join('')}
              </div>
            </div>
            <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:var(--s-4)" data-cards>
              ${isHutang
    ? (debts.length ? debts.map((row) => debtCard({ debt: row.debt, info: row.info })).join('')
      : emptyState({
        title: filter === 'open' ? 'Tidak ada hutang aktif' : 'Belum ada data hutang',
        message: 'Catat pinjaman yang Anda terima agar sisa kewajiban selalu terpantau.',
        actionLabel: 'Catat Hutang', actionAttrs: 'data-new-debt', illustration: '',
      }))
    : (receivables.length ? receivables.map((row) => receivableCard({ receivable: row.receivable, info: row.info })).join('')
      : emptyState({
        title: filter === 'open' ? 'Tidak ada piutang aktif' : 'Belum ada data piutang',
        message: 'Catat uang yang Anda pinjamkan ke orang lain beserta tenggatnya.',
        actionLabel: 'Catat Piutang', actionAttrs: 'data-new-receivable', illustration: '',
      }))}
            </div>
          </section>
        </div>
      `;

      animateCounters(root);

      // bind row actions for the freshly rendered cards
      cleanups.forEach((fn) => fn?.());
      cleanups = [];
      cleanups.push(...bindEvents());
    }

    function bindEvents() {
      return [
        on(root, 'click', '[data-new-debt]', () => openDebtForm({ onSaved: () => { ctx.refreshShell?.(); renderPage(); } })),
        on(root, 'click', '[data-new-receivable]', () => openReceivableForm({ onSaved: () => { ctx.refreshShell?.(); renderPage(); } })),
        on(root, 'click', '[data-tab]', (event, el) => { tab = el.dataset.tab; renderPage(); }),
        on(root, 'click', '[data-filter]', (event, el) => { filter = el.dataset.filter; renderPage(); }),
        on(root, 'click', '[data-pay-debt]', (event, el) => openDebtPayment({
          debtId: el.dataset.payDebt,
          onDone: () => { ctx.refreshShell?.(); renderPage(); },
        })),
        on(root, 'click', '[data-receive]', (event, el) => openReceivablePayment({
          receivableId: el.dataset.receive,
          onDone: () => { ctx.refreshShell?.(); renderPage(); },
        })),
        on(root, 'click', '[data-view-debt]', (event, el) => openDebtDetail(el.dataset.viewDebt, { onChanged: () => renderPage() })),
        on(root, 'click', '[data-debt-card]', (event, el) => {
          if (event.target.closest('button[data-pay-debt]') || event.target.closest('button[data-view-debt]')) return;
          openDebtDetail(el.dataset.debtCard, { onChanged: () => renderPage() });
        }),
        on(root, 'click', '[data-receivable-card]', (event, el) => {
          if (event.target.closest('button[data-receive]') || event.target.closest('button[data-remind]')) return;
          openReceivableDetail(el.dataset.receivableCard, { onChanged: () => renderPage() });
        }),
        on(root, 'click', '[data-remind]', (event, el) => openReminder(el.dataset.remind)),
      ];
    }

    renderPage();
    if (ctx.params?.id) {
      setTimeout(() => {
        if (ctx.params?.tab === 'receivables') openReceivableDetail(ctx.params.id, { onChanged: () => renderPage() });
        else openDebtDetail(ctx.params.id, { onChanged: () => renderPage() });
      }, 140);
    }
    return () => cleanups.forEach((fn) => fn?.());
  },
};

/* ------------------------------------------------------------------ */
/* Detail sheets                                                       */
/* ------------------------------------------------------------------ */

export function openDebtDetail(debtId, { onChanged } = {}) {
  const state = store.state;
  const debt = state.debts.find((d) => d.id === debtId);
  if (!debt) return null;
  const info = debtState(debt, state.debtPayments);
  const payments = sortTransactions(state.transactions.filter((t) => t.reference_id === debt.id && t.reference_type === 'debt'), 'desc');
  const account = state.accounts.find((a) => a.id === debt.account_id);

  return openAdaptive({
    title: `Hutang · ${debt.counterparty}`,
    subtitle: `${money(info.remaining)} tersisa dari ${money(info.principal)}`,
    iconName: 'hand-coins',
    size: 'sm',
    body: `
      <div class="stack-4">
        <div class="debt-hero">
          <div class="debt-hero-top">
            <div>
              <span class="t-label">Sisa hutang</span>
              <div class="debt-hero-value t-neg">${esc(money(info.remaining))}</div>
            </div>
            ${badgeHtml(info.status === 'overdue' ? 'Jatuh tempo' : info.status === 'paid' ? 'Lunas' : info.status === 'partially_paid' ? 'Dibayar sebagian' : 'Aktif',
    info.status === 'overdue' ? 'neg' : info.status === 'paid' ? 'pos' : info.status === 'partially_paid' ? 'warn' : 'info')}
          </div>
          ${progressHtml(info.progress, { tone: info.remaining <= 0 ? 'pos' : info.isOverdue ? 'neg' : 'warn', size: 'progress-lg' })}
          <div class="row-between t-2xs t-dim" style="margin-top:-4px">
            <span>Terbayar ${esc(money(info.paid))} dari ${esc(money(info.principal))}</span>
            <span class="t-bold">${info.progress.toFixed(0)}%</span>
          </div>
          <div class="debt-hero-grid">
            <div class="dh-cell"><span class="dh-label">Total</span><span class="dh-value">${esc(money(info.principal))}</span></div>
            <div class="dh-cell"><span class="dh-label">Dibayar</span><span class="dh-value t-pos">${esc(money(info.paid))}</span></div>
            <div class="dh-cell"><span class="dh-label">Jatuh tempo</span><span class="dh-value">${debt.due_date ? `${esc(formatDate(debt.due_date, { year: false, short: true }))} <i class="t-dim">· ${esc(relativeDays(debt.due_date))}</i>` : '—'}</span></div>
          </div>
        </div>

        <dl class="kv kv-tight">
          <dt>Mulai</dt><dd>${esc(formatDate(debt.start_date, { weekday: true }))}</dd>
          <dt>Akun penerima</dt><dd>${esc(account?.name || '—')}</dd>
          <dt>Pembayaran</dt><dd>${info.payments.length} kali${debt.reminder_days ? ` · pengingat ${debt.reminder_days} hari sebelum jatuh tempo` : ''}</dd>
          ${debt.notes ? `<dt>Catatan</dt><dd>${esc(debt.notes)}</dd>` : ''}
        </dl>

        <div>
          <div class="field-label mb-2">Riwayat pembayaran (${info.payments.length})</div>
          ${info.payments.length ? `<div class="timeline">${info.payments.map((p) => `
            <div class="timeline-item">
              <div class="timeline-rail"><span class="timeline-dot" style="background:var(--pos)"></span><span class="timeline-line"></span></div>
              <div class="timeline-content">
                <div class="row-between"><span class="t-sm t-bold">${esc(money(p.amount))}</span><span class="t-xs t-dim">${esc(formatDate(p.date))}</span></div>
                <div class="t-xs t-dim">${esc(p.notes || 'Pembayaran')}${p.account_id ? ` · ${esc(state.accounts.find((a) => a.id === p.account_id)?.name || '')}` : ''}</div>
              </div>
            </div>`).join('')}</div>` : '<div class="t-xs t-dim">Belum ada pembayaran.</div>'}
        </div>

        ${payments.length ? `<div><div class="field-label mb-2">Transaksi terkait</div>
          <div class="ledger" style="border:1px solid var(--line);border-radius:var(--r-md);overflow:hidden">${ledgerHtml(payments, { state })}</div></div>` : ''}
      </div>`,
    footer: `
      <button class="btn btn-ghost" data-edit>${icon('edit', { size: 16 })} Edit</button>
      <button class="btn btn-danger-soft" data-delete>${icon('trash', { size: 16 })} Hapus</button>
      ${info.remaining > 0 ? `<button class="btn btn-primary ml-auto" data-pay>${icon('hand-coins', { size: 16 })} Bayar Hutang</button>` : ''}`,
    onMount(sheet, api) {
      on(sheet, 'click', '[data-txn-id]', (event, el) => openTransactionDetail(el.dataset.txnId, { onChanged }));
      on(sheet, 'click', '[data-pay]', () => {
        api.close();
        openDebtPayment({ debtId: debt.id, onDone: () => onChanged?.() });
      });
      on(sheet, 'click', '[data-edit]', () => { api.close(); openDebtForm({ debt, onSaved: onChanged }); });
      on(sheet, 'click', '[data-delete]', async () => {
        const yes = await confirmDialog({
          title: 'Hapus hutang ini?',
          message: 'Hutang beserta transaksi dan riwayat pembayarannya akan dihapus, dan saldo akun dihitung ulang.',
          confirmText: 'Hapus', tone: 'danger',
        });
        if (!yes) return;
        await store.deleteDebt(debt.id);
        api.close();
        toast('Hutang dihapus.', { tone: 'pos' });
        onChanged?.();
      });
    },
  });
}

export function openReceivableDetail(recId, { onChanged } = {}) {
  const state = store.state;
  const rec = state.receivables.find((r) => r.id === recId);
  if (!rec) return null;
  const info = receivableState(rec, state.receivablePayments);
  const payments = sortTransactions(state.transactions.filter((t) => t.reference_id === rec.id && t.reference_type === 'receivable'), 'desc');
  const account = state.accounts.find((a) => a.id === rec.account_id);

  return openAdaptive({
    title: `Piutang · ${rec.counterparty}`,
    subtitle: `${money(info.remaining)} belum diterima dari ${money(info.principal)}`,
    iconName: 'file-text',
    size: 'sm',
    body: `
      <div class="stack-4">
        <div class="debt-hero is-rec">
          <div class="debt-hero-top">
            <div>
              <span class="t-label">Sisa piutang</span>
              <div class="debt-hero-value t-brand">${esc(money(info.remaining))}</div>
            </div>
            ${badgeHtml(info.status === 'overdue' ? 'Terlambat' : info.status === 'received' ? 'Selesai' : info.status === 'partially_received' ? 'Diterima sebagian' : 'Aktif',
    info.status === 'overdue' ? 'neg' : info.status === 'received' ? 'pos' : info.status === 'partially_received' ? 'warn' : 'info')}
          </div>
          ${progressHtml(info.progress, { tone: info.remaining <= 0 ? 'pos' : info.isOverdue ? 'neg' : '', size: 'progress-lg' })}
          <div class="row-between t-2xs t-dim" style="margin-top:-4px">
            <span>Diterima ${esc(money(info.received))} dari ${esc(money(info.principal))}</span>
            <span class="t-bold">${info.progress.toFixed(0)}%</span>
          </div>
          <div class="debt-hero-grid">
            <div class="dh-cell"><span class="dh-label">Total</span><span class="dh-value">${esc(money(info.principal))}</span></div>
            <div class="dh-cell"><span class="dh-label">Diterima</span><span class="dh-value t-pos">${esc(money(info.received))}</span></div>
            <div class="dh-cell"><span class="dh-label">Jatuh tempo</span><span class="dh-value">${rec.due_date ? `${esc(formatDate(rec.due_date, { year: false, short: true }))} <i class="t-dim">· ${esc(relativeDays(rec.due_date))}</i>` : '—'}</span></div>
          </div>
        </div>

        <dl class="kv kv-tight">
          <dt>Diberikan</dt><dd>${esc(formatDate(rec.start_date, { weekday: true }))}</dd>
          <dt>Akun asal</dt><dd>${esc(account?.name || '—')}</dd>
          <dt>Pengingat</dt><dd>${rec.reminder_days} hari sebelum jatuh tempo</dd>
          ${rec.notes ? `<dt>Catatan</dt><dd>${esc(rec.notes)}</dd>` : ''}
        </dl>

        <div>
          <div class="row-between mb-2">
            <span class="field-label">Riwayat penerimaan (${info.payments.length})</span>
            ${rec.reminder_days ? `<button class="btn btn-sm btn-soft" data-remind>${icon('message-square', { size: 14 })} Kirim pengingat</button>` : ''}
          </div>
          ${info.payments.length ? `<div class="timeline">${info.payments.map((p) => `
            <div class="timeline-item">
              <div class="timeline-rail"><span class="timeline-dot" style="background:var(--info)"></span><span class="timeline-line"></span></div>
              <div class="timeline-content">
                <div class="row-between"><span class="t-sm t-bold">${esc(money(p.amount))}</span><span class="t-xs t-dim">${esc(formatDate(p.date))}</span></div>
                <div class="t-xs t-dim">${esc(p.notes || 'Penerimaan')}</div>
              </div>
            </div>`).join('')}</div>` : '<div class="t-xs t-dim">Belum ada penerimaan.</div>'}
        </div>
      </div>`,
    footer: `
      <button class="btn btn-ghost" data-edit>${icon('edit', { size: 16 })} Edit</button>
      <button class="btn btn-danger-soft" data-delete>${icon('trash', { size: 16 })} Hapus</button>

      ${info.remaining > 0 ? `<button class="btn btn-success" data-receive>${icon('circle-check', { size: 16 })} Terima</button>` : ''}`,
    onMount(sheet, api) {
      on(sheet, 'click', '[data-txn-id]', (event, el) => openTransactionDetail(el.dataset.txnId, { onChanged }));
      on(sheet, 'click', '[data-receive]', () => {
        api.close();
        openReceivablePayment({ receivableId: rec.id, onDone: () => onChanged?.() });
      });
      on(sheet, 'click', '[data-remind]', () => openReminder(rec.id));
      on(sheet, 'click', '[data-edit]', () => { api.close(); openReceivableForm({ receivable: rec, onSaved: onChanged }); });
      on(sheet, 'click', '[data-delete]', async () => {
        const yes = await confirmDialog({
          title: 'Hapus piutang ini?',
          message: 'Piutang beserta transaksi terkait akan dihapus dan saldo akun dihitung ulang.',
          confirmText: 'Hapus', tone: 'danger',
        });
        if (!yes) return;
        await store.deleteReceivable(rec.id);
        api.close();
        toast('Piutang dihapus.', { tone: 'pos' });
        onChanged?.();
      });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Reminder                                                            */
/* ------------------------------------------------------------------ */

function openReminder(recId) {
  const state = store.state;
  const rec = state.receivables.find((r) => r.id === recId);
  if (!rec) return;
  const info = receivableState(rec, state.receivablePayments);
  const message = `Halo ${rec.counterparty}, mengingatkan kembali terkait pinjaman sebesar ${money(rec.principal)}`
    + `${info.received ? ` (sudah diterima ${money(info.received)}, sisa ${money(info.remaining)})` : ''}`
    + `${rec.due_date ? ` dengan jatuh tempo ${formatDate(rec.due_date)}` : ''}. Terima kasih 🙏`;
  const waLink = `https://wa.me/?text=${encodeURIComponent(message)}`;

  openAdaptive({
    title: `Pengingat untuk ${rec.counterparty}`,
    iconName: 'message-square',
    size: 'sm',
    body: `
      <div class="stack-4">
        <div class="banner is-warn">${icon('info', { size: 18 })}<div class="grow t-xs">Sisa ${esc(money(info.remaining))}${rec.due_date ? ` · jatuh tempo ${esc(formatDate(rec.due_date))} (${esc(relativeDays(rec.due_date))})` : ''}</div></div>
        <div class="field">
          <span class="field-label">Pesan siap kirim</span>
          <textarea class="textarea" rows="6" data-message>${esc(message)}</textarea>
        </div>
      </div>`,
    footer: `<button class="btn btn-ghost" data-close>Tutup</button>
      <button class="btn btn-outline" data-copy>${icon('layers', { size: 16 })} Salin pesan</button>
      <a class="btn btn-success ml-auto" href="${esc(waLink)}" target="_blank" rel="noopener">${icon('message-square', { size: 16 })} Kirim via WhatsApp</a>`,
    onMount(sheet) {
      on(sheet, 'click', '[data-copy]', async () => {
        const text = qs('[data-message]', sheet).value;
        try {
          await navigator.clipboard.writeText(text);
          toast('Pesan disalin ke clipboard.', { tone: 'pos' });
        } catch {
          qs('[data-message]', sheet).select();
          toast('Tekan Ctrl/Cmd + C untuk menyalin.', { tone: 'info' });
        }
      });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Forms                                                               */
/* ------------------------------------------------------------------ */

function openDebtForm({ debt = null, onSaved } = {}) {
  const editing = !!debt;
  const state = store.state;
  const accounts = state.accounts.filter((a) => a.status !== 'archived');
  const draft = {
    counterparty: debt?.counterparty || '',
    principal: debt?.principal || 0,
    account_id: debt?.account_id || accounts[0]?.id || '',
    start_date: debt?.start_date || todayISO(),
    due_date: debt?.due_date || '',
    notes: debt?.notes || '',
  };

  return openAdaptive({
    title: editing ? 'Edit Hutang' : 'Catat Hutang Baru',
    subtitle: 'Uang yang Anda pinjam dari pihak lain',
    iconName: 'hand-coins',
    size: 'sm',
    body: `
      <div class="stack-5">
        <div class="banner">${icon('info', { size: 18 })}<div class="grow t-xs">Saldo akun bertambah saat hutang dicatat, dan kewajiban muncul sebagai liabilitas. Net worth tidak berubah.</div></div>
        <div class="grid grid-2">
          ${fieldHtml({ label: 'Nama Pemberi Hutang', name: 'counterparty', id: 'debt-party', control: `<input class="input" id="debt-party" data-autofocus data-party placeholder="Andi / Koperasi" value="${esc(draft.counterparty)}" maxlength="60" />` })}
          ${fieldHtml({ label: 'Tanggal Hutang', name: 'start_date', id: 'debt-start', control: `<input class="input" type="date" id="debt-start" data-start value="${esc(draft.start_date)}" />` })}
        </div>
        <div class="field">
          <span class="field-label">Nominal</span>
          <div class="input-group"><span class="input-prefix">Rp</span>
            <input class="input amount-input" style="padding-left:44px" data-amount inputmode="numeric" value="${draft.principal ? formatAmountTyping(draft.principal) : ''}" placeholder="0" />
          </div>
        </div>
        <div class="grid grid-2">
          ${fieldHtml({ label: 'Jatuh Tempo (opsional)', name: 'due_date', id: 'debt-due', control: `<input class="input" type="date" id="debt-due" data-due value="${esc(draft.due_date)}" />` })}
          ${fieldHtml({ label: 'Akun Penerima', name: 'account_id', id: 'debt-acc', control: `<select class="select" id="debt-acc" data-account>${accounts.map((a) => `<option value="${esc(a.id)}" ${a.id === draft.account_id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>` })}
        </div>
        ${fieldHtml({ label: 'Catatan', name: 'notes', id: 'debt-notes', control: `<textarea class="textarea" id="debt-notes" data-notes placeholder="Bunga, kesepakatan, dsb (opsional)">${esc(draft.notes)}</textarea>` })}
      </div>`,
    footer: `<button class="btn btn-ghost" data-close>Batal</button>
      <button class="btn btn-primary ml-auto" data-save>${icon('check', { size: 17 })} ${editing ? 'Simpan Perubahan' : 'Simpan Hutang'}</button>`,
    onMount(sheet, api) {
      const amountInput = qs('[data-amount]', sheet);
      amountInput.addEventListener('input', () => {
        const digits = amountInput.value.replace(/[^\d]/g, '');
        amountInput.value = digits ? formatAmountTyping(parseInt(digits, 10)) : '';
      });
      on(sheet, 'click', '[data-save]', async () => {
        const party = qs('[data-party]', sheet).value.trim();
        const amount = parseMoneyInput(amountInput.value);
        if (!party) { toast('Nama pemberi hutang wajib diisi.', { tone: 'warn' }); return; }
        if (!amount) { toast('Nominal hutang wajib diisi.', { tone: 'warn' }); return; }
        const payload = {
          counterparty: party,
          principal: amount,
          account_id: qs('[data-account]', sheet).value,
          start_date: qs('[data-start]', sheet).value,
          due_date: qs('[data-due]', sheet).value || null,
          notes: qs('[data-notes]', sheet).value.trim(),
        };
        try {
          if (editing) await store.updateDebt(debt.id, payload);
          else await store.createDebt(payload);
          api.close();
          toast(editing ? 'Hutang diperbarui.' : `Hutang dari ${party} dicatat.`, { tone: 'pos', title: 'Berhasil' });
          onSaved?.();
        } catch (error) {
          toast(error.message || 'Gagal menyimpan hutang.', { tone: 'neg' });
        }
      });
    },
  });
}

function openReceivableForm({ receivable = null, onSaved } = {}) {
  const editing = !!receivable;
  const state = store.state;
  const accounts = state.accounts.filter((a) => a.status !== 'archived');
  const draft = {
    counterparty: receivable?.counterparty || '',
    principal: receivable?.principal || 0,
    account_id: receivable?.account_id || accounts[0]?.id || '',
    start_date: receivable?.start_date || todayISO(),
    due_date: receivable?.due_date || '',
    reminder_days: receivable?.reminder_days || 3,
    notes: receivable?.notes || '',
  };

  return openAdaptive({
    title: editing ? 'Edit Piutang' : 'Catat Piutang Baru',
    subtitle: 'Uang Anda yang dipinjam orang lain',
    iconName: 'file-text',
    size: 'sm',
    body: `
      <div class="stack-5">
        <div class="banner">${icon('info', { size: 18 })}<div class="grow t-xs">Saldo akun berkurang saat dana dipinjamkan, namun tercatat sebagai aset piutang — net worth tetap sama.</div></div>
        <div class="grid grid-2">
          ${fieldHtml({ label: 'Nama Peminjam', name: 'counterparty', id: 'rec-party', control: `<input class="input" id="rec-party" data-autofocus data-party placeholder="Budi / Sinta" value="${esc(draft.counterparty)}" maxlength="60" />` })}
          ${fieldHtml({ label: 'Tanggal Dipinjamkan', name: 'start_date', id: 'rec-start', control: `<input class="input" type="date" id="rec-start" data-start value="${esc(draft.start_date)}" />` })}
        </div>
        <div class="field">
          <span class="field-label">Nominal</span>
          <div class="input-group"><span class="input-prefix">Rp</span>
            <input class="input amount-input" style="padding-left:44px" data-amount inputmode="numeric" value="${draft.principal ? formatAmountTyping(draft.principal) : ''}" placeholder="0" />
          </div>
        </div>
        <div class="grid grid-2">
          ${fieldHtml({ label: 'Jatuh Tempo (opsional)', name: 'due_date', id: 'rec-due', control: `<input class="input" type="date" id="rec-due" data-due value="${esc(draft.due_date)}" />` })}
          ${fieldHtml({ label: 'Reminder (hari sebelum)', name: 'reminder_days', id: 'rec-rem', control: `<input class="input" type="number" min="0" max="30" id="rec-rem" data-reminder value="${esc(String(draft.reminder_days))}" />` })}
        </div>
        ${fieldHtml({ label: 'Akun Sumber', name: 'account_id', id: 'rec-acc', control: `<select class="select" id="rec-acc" data-account>${accounts.map((a) => `<option value="${esc(a.id)}" ${a.id === draft.account_id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>` })}
        ${fieldHtml({ label: 'Catatan', name: 'notes', id: 'rec-notes', control: `<textarea class="textarea" id="rec-notes" data-notes placeholder="Kesepakatan, bukti transfer, dsb (opsional)">${esc(draft.notes)}</textarea>` })}
      </div>`,
    footer: `<button class="btn btn-ghost" data-close>Batal</button>
      <button class="btn btn-primary ml-auto" data-save>${icon('check', { size: 17 })} ${editing ? 'Simpan Perubahan' : 'Simpan Piutang'}</button>`,
    onMount(sheet, api) {
      const amountInput = qs('[data-amount]', sheet);
      amountInput.addEventListener('input', () => {
        const digits = amountInput.value.replace(/[^\d]/g, '');
        amountInput.value = digits ? formatAmountTyping(parseInt(digits, 10)) : '';
      });
      on(sheet, 'click', '[data-save]', async () => {
        const party = qs('[data-party]', sheet).value.trim();
        const amount = parseMoneyInput(amountInput.value);
        if (!party) { toast('Nama peminjam wajib diisi.', { tone: 'warn' }); return; }
        if (!amount) { toast('Nominal piutang wajib diisi.', { tone: 'warn' }); return; }
        const payload = {
          counterparty: party,
          principal: amount,
          account_id: qs('[data-account]', sheet).value,
          start_date: qs('[data-start]', sheet).value,
          due_date: qs('[data-due]', sheet).value || null,
          reminder_days: Number(qs('[data-reminder]', sheet).value) || 3,
          notes: qs('[data-notes]', sheet).value.trim(),
        };
        try {
          if (editing) await store.updateReceivable(receivable.id, payload);
          else await store.createReceivable(payload);
          api.close();
          toast(editing ? 'Piutang diperbarui.' : `Piutang ke ${party} dicatat.`, { tone: 'pos', title: 'Berhasil' });
          onSaved?.();
        } catch (error) {
          toast(error.message || 'Gagal menyimpan piutang.', { tone: 'neg' });
        }
      });
    },
  });
}

export { openDebtForm, openReceivableForm };
export default debtsPage;
