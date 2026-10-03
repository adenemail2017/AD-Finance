/**
 * Ledger components — transaction rows, day grouping, detail sheet,
 * the Add/Edit transaction form (optimised for <10s entry) and
 * debt / receivable payment sheets.
 */

import store, { AppError } from '../services/store.js';
import { TRANSACTION_TYPES, TRANSACTION_TYPE_META } from '../types/models.js';
import {
  balanceMap, debtList, debtState, receivableList, receivableState,
} from '../services/finance.js';
import { esc, on, qs, qsa } from '../utils/dom.js';
import { MASK, formatAmountTyping, initials, maskAccountNumber, money, parseMoneyInput } from '../utils/format.js';
import { formatDate, formatDayHeader, nowTime, todayISO } from '../utils/date.js';
import { icon, iconTile, CATEGORY_ICON_CHOICES, COLOR_CHOICES } from './icons.js';
import {
  badgeHtml, confirmDialog, fieldHtml, moneyHtml, openAdaptive, openOverlay, toast,
} from './ui.js';

/* ------------------------------------------------------------------ */
/* Visual mapping                                                      */
/* ------------------------------------------------------------------ */

export function txnVisual(txn, state = store.state) {
  const meta = TRANSACTION_TYPE_META[txn.transaction_type] || {};
  const category = state.categories.find((c) => c.id === txn.category_id);
  const sub = state.categories.find((c) => c.id === txn.subcategory_id);
  const account = state.accounts.find((a) => a.id === txn.account_id);
  const dest = state.accounts.find((a) => a.id === txn.destination_account_id);

  let title = txn.description?.trim();
  if (!title) {
    if (txn.transaction_type === TRANSACTION_TYPES.TRANSFER) title = `Transfer ke ${dest?.name || '—'}`;
    else if (txn.counterparty) title = `${meta.short} · ${txn.counterparty}`;
    else title = category?.name || meta.label || 'Transaksi';
  }

  const toneColor = meta.tone === 'positive' ? 'var(--pos)'
    : meta.tone === 'negative' ? 'var(--neg)'
      : meta.tone === 'warning' ? 'var(--warn)'
        : meta.tone === 'accent' ? 'var(--accent)' : 'var(--brand-500)';

  return {
    title,
    meta,
    category,
    sub,
    account,
    dest,
    color: category?.color || toneColor,
    iconName: category?.icon || meta.icon || 'tag',
    accountLabel: account ? account.name : '—',
    transferLabel: dest ? `${account?.name || '—'} → ${dest.name}` : '',
    subLabel: sub?.name || '',
  };
}

export function txnAmountHtml(txn, { masked = false } = {}) {
  const meta = TRANSACTION_TYPE_META[txn.transaction_type] || {};
  // Mode privasi: nominal disensor dan warna dinetralkan agar arah arus pun tidak bocor.
  if (masked) return `<span class="txn-amount is-masked">${MASK}</span>`;
  const positive = ['income', 'receivable_payment', 'debt'].includes(txn.transaction_type);
  const neutral = ['transfer', 'investment', 'emergency_fund'].includes(txn.transaction_type);
  const sign = positive ? '+' : neutral ? '' : '−';
  const cls = positive ? 'money-pos' : neutral ? 'money-neutral' : 'money-neg';
  return `<span class="txn-amount ${cls}">${sign}${esc(money(txn.amount).replace('-', ''))}</span>`;
}

/* ------------------------------------------------------------------ */
/* Rows & grouping                                                     */
/* ------------------------------------------------------------------ */

export function txnRowHtml(txn, {
  balance = null, showBalance = false, state = store.state, masked = false,
  compact = false, hideAccount = false, dateLabel = '',
} = {}) {
  const v = txnVisual(txn, state);
  // Mode ringkas: cukup dua keterangan supaya tidak ada teks yang terpotong —
  // arah transfer/kategori + jam. Tanggal tampil sebagai label di awal baris.
  // Label transfer dipersingkat menjadi arah + tujuan ("→ Reksadana") supaya
  // jam dan kategori tetap terbaca di baris yang sempit.
  const transferShort = v.dest ? `→ ${v.dest.name}` : '';
  const metaParts = compact
    ? [transferShort || (v.category ? v.category.name : v.meta.short), txn.time].filter(Boolean)
    : [
      v.category ? v.category.name : v.meta.short,
      v.subLabel,
      // Di ledger milik satu akun, mengulang nama akun di setiap baris hanya menambah bising.
      v.transferLabel || (hideAccount ? null : v.accountLabel),
      txn.time,
    ].filter(Boolean);
  return `<button class="txn${compact ? ' is-compact' : ''}" data-txn-id="${esc(txn.id)}" type="button">
    ${iconTile(v.iconName, { color: v.color, size: compact ? 34 : 42, radius: compact ? 11 : 13, iconSize: compact ? 17 : 20 })}
    <span class="grow" style="min-width:0">
      <span class="txn-title t-clip" style="display:block">${esc(v.title)}</span>
      <span class="txn-meta">
        ${dateLabel ? `<span class="txn-date">${esc(dateLabel)}</span>` : ''}
        ${metaParts.map((part, i) => `${i || dateLabel ? '<span class="txn-dot"></span>' : ''}<span class="t-clip">${esc(part)}</span>`).join('')}
      </span>
    </span>
    <span class="txn-side">
      ${txnAmountHtml(txn, { masked })}
      ${showBalance && balance !== null ? `<span class="txn-balance">${esc(masked ? MASK : money(balance))}</span>` : ''}
      ${txn.attachment ? `<span class="txn-attach">${icon('paperclip', { size: 12 })}</span>` : ''}
    </span>
  </button>`;
}

/**
 * Group a sorted list into day sections with per-day totals.
 * @param {Array} list transactions (already sorted desc)
 */
export function ledgerHtml(list, {
  showBalance = false, balances = null, balanceOf = null, state = store.state, masked = false,
  compact = false, limit = 0, hideAccount = false,
} = {}) {
  if (!list.length) return '';
  // `limit` dipakai untuk ledger tersemat di dalam sheet: tanpa kotak bergulir
  // yang memotong baris di tengah; sisanya diakses lewat tombol "Lihat semua".
  const rows = limit > 0 ? list.slice(0, limit) : list;
  const groups = new Map();
  rows.forEach((t) => {
    if (!groups.has(t.date)) groups.set(t.date, []);
    groups.get(t.date).push(t);
  });
  const running = balances || balanceMap(state);

  if (compact) {
    // Tanpa pengelompokan per hari: setiap baris membawa tanggalnya sendiri,
    // sehingga daftarnya rata, padat, dan tidak ada baris yang terpotong.
    return `<div class="ledger is-compact">${rows.map((t) => txnRowHtml(t, {
      showBalance,
      masked,
      compact: true,
      hideAccount,
      dateLabel: formatDate(t.date, { year: false, short: true }),
      balance: showBalance ? (balanceOf ? balanceOf(t) ?? null : (running.get(t.account_id) || 0)) : null,
      state,
    })).join('')}</div>`;
  }

  return [...groups.entries()].map(([date, dayRows]) => {
    const inSum = dayRows.filter((t) => ['income', 'receivable_payment', 'debt'].includes(t.transaction_type))
      .reduce((acc, t) => acc + t.amount, 0);
    const outSum = dayRows.filter((t) => ['expense', 'debt_payment', 'receivable'].includes(t.transaction_type))
      .reduce((acc, t) => acc + t.amount, 0);
    return `<section class="ledger-day${compact ? ' is-compact' : ''}">
      <div class="ledger-day-head">
        <span>${esc(formatDayHeader(date))}</span>
        <span class="day-total">
          ${inSum ? `<span class="money-pos">+${esc(money(inSum).replace('-', ''))}</span>` : ''}
          ${inSum && outSum ? '<span class="t-dim"> · </span>' : ''}
          ${outSum ? `<span class="money-neg">−${esc(money(outSum).replace('-', ''))}</span>` : ''}
        </span>
      </div>
      ${dayRows.map((t) => txnRowHtml(t, {
    showBalance,
    masked,
    compact,
    hideAccount,
    // prefer a true running balance when the caller can provide one
    balance: showBalance ? (balanceOf ? balanceOf(t) ?? null : (running.get(t.account_id) || 0)) : null,
    state,
  })).join('')}
    </section>`;
  }).join('');
}

/* ------------------------------------------------------------------ */
/* Detail sheet                                                        */
/* ------------------------------------------------------------------ */

export function openTransactionDetail(txnId, { onChanged, showBalance = false, balances = null } = {}) {
  const state = store.state;
  const txn = state.transactions.find((t) => t.id === txnId);
  if (!txn) { toast('Transaksi tidak ditemukan.', { tone: 'neg' }); return null; }
  const v = txnVisual(txn, state);
  const positive = ['income', 'receivable_payment', 'debt'].includes(txn.transaction_type);
  const neutral = ['transfer', 'investment', 'emergency_fund'].includes(txn.transaction_type);
  const balanceShown = balances ? balances.get(txn.account_id) : null;

  const body = `
    <div class="stack-5">
      <div class="row txn-detail-head" style="align-items:flex-start">
        ${iconTile(v.iconName, { color: v.color, size: 52, radius: 16, iconSize: 25 })}
        <div class="grow">
          <div class="t-h3">${esc(v.title)}</div>
          <div class="row gap-2 wrap mt-1">
            ${badgeHtml(v.meta.label, v.meta.tone === 'positive' ? 'pos' : v.meta.tone === 'negative' ? 'neg' : v.meta.tone === 'warning' ? 'warn' : 'brand')}
            ${v.category ? badgeHtml(v.category.name, 'default', { icon: v.category.icon }) : ''}
            ${v.subLabel ? badgeHtml(v.subLabel, 'outline') : ''}
          </div>
        </div>
        <div class="t-right txn-detail-amount">
          <div class="t-h2 ${positive ? 't-pos' : neutral ? '' : 't-neg'}">${positive ? '+' : neutral ? '' : '−'}${esc(money(txn.amount).replace('-', ''))}</div>
          <div class="t-xs t-dim txn-detail-when">${esc(formatDate(txn.date, { weekday: true }))} · ${esc(txn.time || '')}</div>
        </div>
      </div>

      <dl class="kv kv-tight">
        <dt>Akun</dt><dd>${esc(v.accountLabel)}${balanceShown !== null ? ` <span class="t-dim">· saldo ${esc(money(balanceShown))}</span>` : ''}</dd>
        ${v.dest ? `<dt>Akun Tujuan</dt><dd>${esc(v.dest.name)}</dd>` : ''}
        ${txn.counterparty ? `<dt>Pihak</dt><dd>${esc(txn.counterparty)}</dd>` : ''}
        ${txn.reference_id ? `<dt>Referensi</dt><dd class="t-mono t-xs">${esc(txn.reference_id)}</dd>` : ''}
        <dt>Kategori</dt><dd>${esc(v.category?.name || '—')}${v.subLabel ? ` · ${esc(v.subLabel)}` : ''}</dd>
        <dt>Keterangan</dt><dd>${esc(txn.description || '—')}</dd>
        ${txn.notes ? `<dt>Catatan</dt><dd>${esc(txn.notes)}</dd>` : ''}
        ${(txn.tags || []).length ? `<dt>Tag</dt><dd>${txn.tags.map((t) => badgeHtml(t, 'outline')).join(' ')}</dd>` : ''}
        <dt>Status</dt><dd>${badgeHtml(txn.sync_status === 'synced' ? 'Tersinkron' : 'Tersimpan lokal', txn.sync_status === 'synced' ? 'pos' : 'info', { icon: txn.sync_status === 'synced' ? 'badge-check' : 'lock' })}</dd>
        <dt>Dibuat</dt><dd class="t-xs t-mono">${esc(new Date(txn.created_at).toLocaleString('id-ID'))}</dd>
      </dl>

      ${txn.attachment ? `<div class="field"><span class="field-label">Lampiran</span>
        <img src="${esc(txn.attachment)}" alt="Lampiran transaksi" style="max-width:100%;border-radius:var(--r-md);border:1px solid var(--line)"/>
      </div>` : ''}
    </div>`;

  const isTransfer = ['transfer', 'investment', 'emergency_fund'].includes(txn.transaction_type);
  void isTransfer;

  return openAdaptive({
    title: 'Detail Transaksi',
    iconName: v.iconName,
    size: 'sm',
    body,
    footer: `
      <button class="btn btn-danger-soft" data-delete>${icon('trash', { size: 17 })} Hapus</button>
      <button class="btn btn-outline" data-duplicate>${icon('layers', { size: 17 })} Duplikat</button>
      <button class="btn btn-primary ml-auto" data-edit>${icon('edit', { size: 17 })} Edit</button>`,
    onMount(sheet, api) {
      on(sheet, 'click', '[data-edit]', () => {
        api.close();
        openTransactionForm({ txn, onSaved: () => onChanged?.() });
      });
      on(sheet, 'click', '[data-duplicate]', async () => {
        api.close();
        openTransactionForm({
          presetType: txn.transaction_type,
          preset: {
            amount: txn.amount, category_id: txn.category_id, subcategory_id: txn.subcategory_id,
            account_id: txn.account_id, destination_account_id: txn.destination_account_id,
            description: txn.description, notes: txn.notes, tags: txn.tags, counterparty: txn.counterparty,
          },
          date: todayISO(),
          onSaved: () => onChanged?.(),
        });
      });
      on(sheet, 'click', '[data-delete]', async () => {
        const yes = await confirmDialog({
          title: 'Hapus transaksi ini?',
          message: 'Saldo akun akan dihitung ulang. Tindakan ini tidak bisa dibatalkan.',
          confirmText: 'Hapus', tone: 'danger', iconName: 'trash',
        });
        if (!yes) return;
        await store.deleteTransaction(txn.id);
        api.close();
        toast('Transaksi dihapus.', { tone: 'pos', title: 'Berhasil' });
        onChanged?.();
      });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Transaction form                                                    */
/* ------------------------------------------------------------------ */

const RECENT_KEY = 'pfos:recent';
const recents = {
  get() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || { categories: [], accounts: [] }; }
    catch { return { categories: [], accounts: [] }; }
  },
  push(kind, id) {
    const data = this.get();
    const list = [id, ...(data[kind] || []).filter((x) => x !== id)].slice(0, 8);
    data[kind] = list;
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(data)); } catch { /* ignore */ }
  },
};

/** Downscale an image file to a data URL (keeps IndexedDB small). */
async function fileToCompressedDataUrl(file, maxSize = 1100, quality = 0.72) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  if (!file.type.startsWith('image/')) return dataUrl;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx || typeof canvas.toDataURL !== 'function') { resolve(dataUrl); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch {
        resolve(dataUrl); // keep the original image rather than losing the attachment
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/**
 * Add / edit a transaction.
 * @param {object} cfg { txn?, presetType?, preset?, date?, onSaved? }
 */
export function openTransactionForm(cfg = {}) {
  const state = store.state;
  const editing = cfg.txn || null;
  if (!state.accounts.length) {
    toast('Buat akun terlebih dahulu sebelum mencatat transaksi.', { tone: 'warn', title: 'Belum ada akun' });
    return null;
  }

  const draft = {
    transaction_type: editing?.transaction_type || cfg.presetType || TRANSACTION_TYPES.EXPENSE,
    amount: editing?.amount || cfg.preset?.amount || 0,
    date: editing?.date || cfg.preset?.date || cfg.date || todayISO(),
    time: editing?.time || nowTime(),
    category_id: editing?.category_id || cfg.preset?.category_id || null,
    subcategory_id: editing?.subcategory_id || cfg.preset?.subcategory_id || null,
    account_id: editing?.account_id || cfg.preset?.account_id || state.accounts.find((a) => a.is_default)?.id || state.accounts[0].id,
    destination_account_id: editing?.destination_account_id || cfg.preset?.destination_account_id || null,
    description: editing?.description || cfg.preset?.description || '',
    notes: editing?.notes || cfg.preset?.notes || '',
    counterparty: editing?.counterparty || cfg.preset?.counterparty || '',
    tags: editing?.tags || cfg.preset?.tags || [],
    attachment: editing?.attachment || null,
    reference_id: editing?.reference_id || null,
    due_date: cfg.preset?.due_date || null,
    descriptionTouched: !!editing,
    force: false,
  };

  const balances = balanceMap(state);
  const isTransferLike = (type) => ['transfer', 'investment', 'emergency_fund'].includes(type);
  const needsCategory = (type) => [TRANSACTION_TYPES.INCOME, TRANSACTION_TYPES.EXPENSE].includes(type);
  const needsLinkedEntity = (type) => [TRANSACTION_TYPES.DEBT, TRANSACTION_TYPES.RECEIVABLE].includes(type);
  const needsOpenRecord = (type) => [TRANSACTION_TYPES.DEBT_PAYMENT, TRANSACTION_TYPES.RECEIVABLE_PAYMENT].includes(type);

  const activeAccounts = state.accounts.filter((a) => a.status !== 'archived');

  function ruleAccountTargets(type) {
    if (type === TRANSACTION_TYPES.INVESTMENT) return activeAccounts.filter((a) => a.account_type === 'investment' || a.account_type === 'bank');
    if (type === TRANSACTION_TYPES.EMERGENCY_FUND) return activeAccounts.filter((a) => a.account_type === 'emergency_fund' || a.account_type === 'bank');
    return activeAccounts;
  }

  const typeOptions = Object.values(TRANSACTION_TYPES).map((type) => {
    const meta = TRANSACTION_TYPE_META[type];
    return `<button type="button" class="txn-type" data-type="${type}" aria-pressed="false">
      ${icon(meta.icon, { size: 18 })}<span>${esc(meta.label)}</span></button>`;
  }).join('');

  const body = `
    <div class="txn-form">
      <div class="stack-2">
        <span class="field-label">Jenis Transaksi</span>
        <div class="txn-types" data-types>${typeOptions}</div>
        <span class="field-hint" data-type-hint></span>
      </div>

      <section class="txn-amount-card">
        <div class="txn-amount-head">
          <span class="field-label">Nominal</span>
          <span class="txn-amount-kind" data-amount-kind></span>
        </div>
        <div class="txn-amount-row">
          <span class="txn-currency">Rp</span>
          <input class="txn-amount-input" data-amount inputmode="numeric" autocomplete="off"
            placeholder="0" data-autofocus aria-label="Nominal" />
          <div class="txn-amount-tools">
            <button type="button" class="txn-tool" data-add-amount="double" title="Kalikan dua" aria-label="Kalikan dua">×2</button>
            <button type="button" class="txn-tool" data-add-amount="clear" title="Kosongkan" aria-label="Kosongkan">${icon('x', { size: 15 })}</button>
          </div>
        </div>
        <div class="chip-row txn-quick" data-quick-amounts>
          ${[10_000, 50_000, 100_000, 500_000, 1_000_000].map((v) => `<button type="button" class="chip chip-sm" data-add-amount="${v}">+${esc(money(v, { compact: true }))}</button>`).join('')}
        </div>
        <span class="field-error" data-error="amount" hidden></span>
      </section>

      <div class="grid grid-2" data-row-datetime>
        ${fieldHtml({
    label: 'Tanggal', name: 'date', id: 'txn-date',
    control: `<input class="input" type="date" id="txn-date" data-date value="${esc(draft.date)}" max="2999-12-31" />`,
  })}
        ${fieldHtml({
    label: 'Waktu', name: 'time', id: 'txn-time',
    control: `<input class="input" type="time" id="txn-time" data-time value="${esc(draft.time)}" />`,
  })}
      </div>

      <div class="stack-2" data-block="category">
        <div class="row-between">
          <span class="field-label">Kategori</span>
          <button type="button" class="btn btn-sm btn-ghost" data-new-category>${icon('plus', { size: 15 })} Kategori baru</button>
        </div>
        <input class="input input-sm" data-category-search placeholder="Cari kategori…" aria-label="Cari kategori" />
        <div data-category-grid class="cat-grid"></div>
        <span class="field-error" data-error="category_id" hidden></span>
        <div data-subcategory-wrap hidden>
          <span class="field-label" style="display:block;margin-bottom:6px">Sub Kategori</span>
          <select class="select" data-subcategory></select>
        </div>
      </div>

      <div class="grid grid-2">
        <div class="field" data-field="account_id">
          <label class="field-label" for="txn-account">Akun <span class="t-dim" data-account-label-suffix>sumber dana</span></label>
          <select class="select" id="txn-account" data-account>${activeAccounts.map((a) => `<option value="${esc(a.id)}">${esc(a.name)} — ${esc(money(balances.get(a.id) || 0))}</option>`).join('')}</select>
          <span class="field-error" data-error="account_id" hidden></span>
        </div>
        <div class="field" data-block="destination" hidden data-field="destination_account_id">
          <label class="field-label" for="txn-destination">Akun Tujuan</label>
          <select class="select" id="txn-destination" data-destination></select>
          <span class="field-error" data-error="destination_account_id" hidden></span>
        </div>
      </div>

      <div class="stack-2" data-block="linked" hidden>
        <div class="grid grid-2">
          ${fieldHtml({
    label: 'Nama Pihak', name: 'counterparty', id: 'txn-counterparty',
    control: '<input class="input" id="txn-counterparty" data-counterparty placeholder="Contoh: Andi / Budi" />',
  })}
          ${fieldHtml({
    label: 'Jatuh Tempo', name: 'due_date', id: 'txn-due',
    control: `<input class="input" type="date" id="txn-due" data-due value="${esc(draft.due_date || '')}" />`,
  })}
        </div>
      </div>

      <div class="stack-2" data-block="open-record" hidden>
        ${fieldHtml({
    label: 'Pilih Hutang / Piutang', name: 'reference_id', id: 'txn-reference',
    control: '<select class="select" id="txn-reference" data-reference></select>',
  })}
        <div class="banner" data-open-record-info hidden></div>
      </div>

      <details class="txn-more" data-txn-more>
        <summary>
          <span class="txn-more-title">Detail tambahan</span>
          <span class="txn-more-sub" data-more-sub>keterangan · tag · catatan · lampiran</span>
          ${icon('chevron-down', { size: 16, class: 'txn-more-chev' })}
        </summary>
        <div class="txn-more-body">
          <div class="grid grid-2">
            ${fieldHtml({
    label: 'Keterangan', name: 'description', id: 'txn-desc',
    control: '<input class="input" id="txn-desc" data-description placeholder="Contoh: Makan siang" maxlength="120" />',
  })}
            ${fieldHtml({
    label: 'Tag', name: 'tags', id: 'txn-tags', hint: 'Pisahkan dengan koma',
    control: '<input class="input" id="txn-tags" data-tags placeholder="rutin, keluarga" />',
  })}
          </div>
          ${fieldHtml({
    label: 'Catatan', name: 'notes', id: 'txn-notes',
    control: '<textarea class="textarea" id="txn-notes" data-notes placeholder="Detail tambahan (opsional)"></textarea>',
  })}
          <div class="stack-2">
            <span class="field-label">Lampiran</span>
            <div class="row gap-3">
              <label class="btn btn-outline btn-sm" style="cursor:pointer">
                ${icon('image', { size: 16 })} Pilih gambar
                <input type="file" accept="image/*" data-file hidden />
              </label>
              <button type="button" class="btn btn-sm btn-ghost" data-scan>${icon('scan', { size: 16 })} Kamera</button>
              <button type="button" class="btn btn-sm btn-ghost" data-remove-attachment hidden>${icon('trash', { size: 16 })} Hapus</button>
            </div>
            <div data-attachment-preview hidden></div>
          </div>
        </div>
      </details>

      <div class="banner is-warn" data-duplicate-banner hidden>
        ${icon('alert', { size: 18 })}
        <div class="grow t-xs" data-duplicate-text></div>
        <button class="btn btn-sm btn-warn" data-force-save>Simpan tetap</button>
      </div>
    </div>`;

  const footer = `
    <div class="txn-footer">
      <button class="btn btn-primary btn-block" data-save>${icon('check', { size: 17 })} ${editing ? 'Simpan Perubahan' : 'Simpan Transaksi'}</button>
      <div class="row">
        <button class="btn btn-ghost btn-sm" data-cancel>Batal</button>
        <button class="btn btn-outline btn-sm" data-save-more>${icon('plus', { size: 16 })} Simpan &amp; tambah</button>
      </div>
    </div>`;

  return openAdaptive({
    title: editing ? 'Edit Transaksi' : 'Transaksi Baru',
    subtitle: editing ? `${formatDate(editing.date)} · ${editing.time || ''}` : 'Catat dalam hitungan detik',
    iconName: TRANSACTION_TYPE_META[draft.transaction_type]?.icon || 'plus',
    size: 'lg',
    body,
    footer,
    onMount(sheet, api) {
      const amountInput = qs('[data-amount]', sheet);
      const descriptionInput = qs('[data-description]', sheet);
      const categoryGrid = qs('[data-category-grid]', sheet);
      const categorySearch = qs('[data-category-search]', sheet);
      const subWrap = qs('[data-subcategory-wrap]', sheet);
      const subSelect = qs('[data-subcategory]', sheet);
      const accountSelect = qs('[data-account]', sheet);
      const destBlock = qs('[data-block="destination"]', sheet);
      const destSelect = qs('[data-destination]', sheet);
      const linkedBlock = qs('[data-block="linked"]', sheet);
      const openRecordBlock = qs('[data-block="open-record"]', sheet);
      const referenceSelect = qs('[data-reference]', sheet);
      const referenceInfo = qs('[data-open-record-info]', sheet);
      const typeHint = qs('[data-type-hint]', sheet);
      const duplicateBanner = qs('[data-duplicate-banner]', sheet);
      const duplicateText = qs('[data-duplicate-text]', sheet);
      const attachmentPreview = qs('[data-attachment-preview]', sheet);
      const fileInput = qs('[data-file]', sheet);
      const removeAttachmentBtn = qs('[data-remove-attachment]', sheet);

      const footerEl = qs('.sheet-footer', sheet.closest('.overlay') || document);
      if (footerEl) footerEl.classList.add('is-stacked');
      const moreWrap = qs('[data-txn-more]', sheet);
      const moreSub = qs('[data-more-sub]', sheet);
      const isiDetail = () => {
        const n = [draft.description, draft.notes, (draft.tags || []).join(''), draft.attachment ? 'x' : ''].filter(Boolean).length;
        moreSub.textContent = n ? `${n} kolom terisi` : 'keterangan · tag · catatan · lampiran';
      };
      if (draft.description || draft.notes || (draft.tags || []).length || draft.attachment) moreWrap.open = true;
      isiDetail();

      accountSelect.value = draft.account_id;
      qs('[data-date]', sheet).value = draft.date;
      qs('[data-time]', sheet).value = draft.time;
      descriptionInput.value = draft.description;
      qs('[data-notes]', sheet).value = draft.notes;
      qs('[data-counterparty]', sheet).value = draft.counterparty;
      qs('[data-tags]', sheet).value = (draft.tags || []).join(', ');
      qs('[data-due]', sheet).value = draft.due_date || '';
      renderAmount();
      setType(draft.transaction_type);
      renderCategories();
      renderAttachment();

      /* ---------- amount handling ---------- */
      function renderAmount() {
        amountInput.value = draft.amount ? formatAmountTyping(draft.amount) : '';
      }
      amountInput.addEventListener('input', () => {
        const digits = amountInput.value.replace(/[^\d]/g, '');
        const caretAtEnd = amountInput.selectionStart === amountInput.value.length;
        draft.amount = digits ? parseInt(digits, 10) : 0;
        const formatted = draft.amount ? formatAmountTyping(draft.amount) : '';
        amountInput.value = formatted;
        if (caretAtEnd) amountInput.setSelectionRange(formatted.length, formatted.length);
        clearError('amount');
      });
      amountInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); submit(false); }
      });
      on(sheet, 'click', '[data-add-amount]', (event, btn) => {
        const raw = btn.dataset.addAmount;
        if (raw === 'clear') draft.amount = 0;
        else if (raw === 'double') draft.amount = Math.round(draft.amount * 2);
        else draft.amount += parseInt(raw, 10);
        renderAmount();
        clearError('amount');
      });

      /* ---------- type ---------- */
      function setType(type) {
        draft.transaction_type = type;
        const meta = TRANSACTION_TYPE_META[type];
        qsa('[data-type]', sheet).forEach((b) => {
          const isActive = b.dataset.type === type;
          b.classList.toggle('is-active', isActive);
          b.setAttribute('aria-pressed', String(isActive));
          if (isActive) { try { b.scrollIntoView?.({ inline: 'center', block: 'nearest' }); } catch { /* non-fatal */ } }
        });
        typeHint.textContent = meta?.hint || '';
        const amountKind = qs('[data-amount-kind]', sheet);
        if (amountKind) amountKind.textContent = meta?.label || '';
        const accSuffix = qs('[data-account-label-suffix]', sheet);
        if (accSuffix) {
          const ACC_LABEL = {
            income: 'penerima dana',
            expense: 'sumber dana',
            transfer: 'sumber dana',
            investment: 'sumber dana',
            emergency_fund: 'sumber dana',
            debt: 'penerima dana',
            receivable: 'sumber dana',
            debt_payment: 'akun pembayaran',
            receivable_payment: 'akun penerimaan',
          };
          accSuffix.textContent = ACC_LABEL[type] || 'akun';
        }
        destBlock.hidden = !isTransferLike(type);
        linkedBlock.hidden = !needsLinkedEntity(type);
        openRecordBlock.hidden = !needsOpenRecord(type);
        qs('[data-block="category"]', sheet).hidden = !needsCategory(type);
        if (isTransferLike(type)) buildDestinationOptions();
        if (needsOpenRecord(type)) buildReferenceOptions();
        if (needsCategory(type)) renderCategories();
      }
      on(sheet, 'click', '[data-type]', (event, btn) => { setType(btn.dataset.type); clearError(''); });

      /* ---------- categories ---------- */
      function buildDestinationOptions() {
        const targets = ruleAccountTargets(draft.transaction_type).filter((a) => a.id !== accountSelect.value);
        destSelect.innerHTML = targets.map((a) => `<option value="${esc(a.id)}">${esc(a.name)} — ${esc(money(balances.get(a.id) || 0))}</option>`).join('');
        if (!targets.length) destSelect.innerHTML = '<option value="">Tidak ada akun tujuan tersedia</option>';
        if (draft.destination_account_id && targets.some((a) => a.id === draft.destination_account_id)) {
          destSelect.value = draft.destination_account_id;
        } else {
          draft.destination_account_id = targets[0]?.id || null;
        }
      }

      function buildReferenceOptions() {
        const isDebt = draft.transaction_type === TRANSACTION_TYPES.DEBT_PAYMENT;
        const rows = isDebt ? debtList(state, { status: 'open' }) : receivableList(state, { status: 'open' });
        referenceSelect.innerHTML = rows.length
          ? rows.map((row) => {
            const party = isDebt ? row.debt.counterparty : row.receivable.counterparty;
            const info = isDebt ? row.info : row.info;
            return `<option value="${esc(isDebt ? row.debt.id : row.receivable.id)}">${esc(party)} — sisa ${esc(money(info.remaining))}</option>`;
          }).join('')
          : '<option value="">Tidak ada data terbuka</option>';
        const info = referenceInfo;
        const update = () => {
          const row = rows.find((r) => (isDebt ? r.debt.id : r.receivable.id) === referenceSelect.value);
          if (!row) { info.hidden = true; return; }
          info.hidden = false;
          const data = row.info;
          info.className = `banner ${data.isOverdue ? 'is-neg' : 'is-warn'}`;
          info.innerHTML = `${icon(data.isOverdue ? 'alert' : 'info', { size: 18 })}
            <div class="grow t-xs">
              Total ${esc(money(data.principal))} · sudah ${esc(money(isDebt ? data.paid : data.received))} ·
              <strong>sisa ${esc(money(data.remaining))}</strong>
              ${row.debt?.due_date || row.receivable?.due_date ? ` · jatuh tempo ${esc(formatDate(row.debt?.due_date || row.receivable?.due_date))}` : ''}
            </div>`;
          // smart default: fill amount with remaining balance
          if (!draft.amount || draft.amount > data.remaining) { draft.amount = data.remaining; renderAmount(); }
        };
        referenceSelect.onchange = update;
        update();
      }

      function renderCategories() {
        const kind = draft.transaction_type === TRANSACTION_TYPES.INCOME ? 'income' : 'expense';
        const all = state.categories.filter((c) => !c.parent_id && !c.archived && c.kind === kind);
        const query = (categorySearch?.value || '').toLowerCase();
        const filtered = query ? all.filter((c) => c.name.toLowerCase().includes(query)) : all;
        const recentIds = recents.get().categories;
        const recent = filtered.filter((c) => recentIds.includes(c.id)).slice(0, 4);
        const rest = filtered.filter((c) => !recent.includes(c));
        const tile = (c) => `<button type="button" class="cat-pill ${draft.category_id === c.id ? 'is-active' : ''}" data-category="${esc(c.id)}">
          ${iconTile(c.icon, { color: c.color, size: 22, radius: 7, iconSize: 12 })}
          <span class="t-clip">${esc(c.name)}</span>
        </button>`;
        categoryGrid.innerHTML = `
          ${recent.length ? `<div class="col-12 t-label" style="grid-column:1/-1">Sering dipakai</div>${recent.map(tile).join('')}` : ''}
          ${rest.length ? `<div class="t-label" style="grid-column:1/-1">${recent.length ? 'Semua kategori' : ''}</div>${rest.map(tile).join('')}` : '<div class="t-xs t-dim" style="grid-column:1/-1">Kategori tidak ditemukan.</div>'}`;
        applySubcategories();
      }

      function applySubcategories() {
        const children = state.categories.filter((c) => c.parent_id === draft.category_id && !c.archived);
        if (!children.length) { subWrap.hidden = true; draft.subcategory_id = null; return; }
        subWrap.hidden = false;
        subSelect.innerHTML = `<option value="">— Tanpa sub kategori —</option>${children.map((c) => `<option value="${esc(c.id)}" ${draft.subcategory_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}`;
      }

      categorySearch?.addEventListener('input', renderCategories);
      on(sheet, 'click', '[data-category]', (event, btn) => {
        draft.category_id = btn.dataset.category;
        draft.subcategory_id = null;
        renderCategories();
        clearError('category_id');
        const cat = state.categories.find((c) => c.id === draft.category_id);
        if (cat && !draft.descriptionTouched && !descriptionInput.value) descriptionInput.placeholder = `Contoh: ${cat.name} harian`;
      });
      subSelect.addEventListener('change', () => { draft.subcategory_id = subSelect.value || null; });

      /* ---------- inline new category ---------- */
      on(sheet, 'click', '[data-new-category]', () => {
        const kind = draft.transaction_type === TRANSACTION_TYPES.INCOME ? 'income' : 'expense';
        openOverlay({
          title: 'Kategori Baru',
          iconName: 'tag',
          size: 'sm',
          body: `
            <div class="stack-4">
              ${fieldHtml({ label: 'Nama kategori', name: 'name', id: 'new-cat-name', control: '<input class="input" id="new-cat-name" data-autofocus maxlength="40" placeholder="Contoh: Hobi" />' })}
              <div class="field"><span class="field-label">Warna</span>
                <div class="swatch-grid" data-colors>${COLOR_CHOICES.map((c, i) => `<button type="button" class="swatch ${i === 1 ? 'is-active' : ''}" data-color="${c}" style="background:${c}" aria-label="Warna ${c}"></button>`).join('')}</div>
              </div>
              <div class="field"><span class="field-label">Ikon</span>
                <div class="swatch-grid" data-icons>${CATEGORY_ICON_CHOICES.map((n, i) => `<button type="button" class="icon-btn ${i === 0 ? 'is-active' : ''}" data-icon-name="${n}" style="border:1px solid var(--line)">${icon(n, { size: 18 })}</button>`).join('')}</div>
              </div>
            </div>`,
          footer: '<button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-primary ml-auto" data-create>Simpan Kategori</button>',
          onMount(inner, innerApi) {
            let color = COLOR_CHOICES[1];
            let iconName = CATEGORY_ICON_CHOICES[0];
            on(inner, 'click', '[data-color]', (event, btn) => {
              qsa('[data-color]', inner).forEach((b) => b.classList.remove('is-active'));
              btn.classList.add('is-active');
              color = btn.dataset.color;
            });
            on(inner, 'click', '[data-icon-name]', (event, btn) => {
              qsa('[data-icon-name]', inner).forEach((b) => b.classList.remove('is-active'));
              btn.classList.add('is-active');
              iconName = btn.dataset.iconName;
            });
            on(inner, 'click', '[data-create]', async () => {
              const name = qs('[data-autofocus]', inner).value.trim();
              if (!name) { toast('Nama kategori wajib diisi.', { tone: 'warn' }); return; }
              const category = await store.addCategory({ name, kind, color, icon: iconName });
              draft.category_id = category.id;
              innerApi.close();
              renderCategories();
              toast(`Kategori "${name}" ditambahkan.`, { tone: 'pos' });
            });
          },
        });
      });

      /* ---------- attachment ---------- */
      function renderAttachment() {
        if (draft.attachment) {
          attachmentPreview.hidden = false;
          removeAttachmentBtn.hidden = false;
          attachmentPreview.innerHTML = `<img src="${esc(draft.attachment)}" alt="Pratinjau lampiran" style="max-height:150px;border-radius:var(--r-md);border:1px solid var(--line)"/>`;
        } else {
          attachmentPreview.hidden = true;
          removeAttachmentBtn.hidden = true;
          attachmentPreview.innerHTML = '';
        }
      }
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        const dataUrl = await fileToCompressedDataUrl(file);
        draft.attachment = dataUrl;
        renderAttachment();
      });
      on(sheet, 'click', '[data-scan]', () => fileInput.click());
      on(sheet, 'click', '[data-remove-attachment]', () => { draft.attachment = null; renderAttachment(); });

      /* ---------- validation helpers ---------- */
      function showError(field, message) {
        const el = qs(`[data-error="${field}"]`, sheet);
        if (el) { el.textContent = message; el.hidden = false; }
        const group = qs(`[data-field="${field}"]`, sheet);
        qs('input, select, textarea', group || sheet)?.setAttribute?.('aria-invalid', 'true');
      }
      function clearError(field) {
        if (!field) {
          qsa('[data-error]', sheet).forEach((el) => { el.hidden = true; });
          return;
        }
        const el = qs(`[data-error="${field}"]`, sheet);
        if (el) el.hidden = true;
      }

      /* ---------- submit ---------- */
      async function submit(keepOpen) {
        clearError('');
        duplicateBanner.hidden = true;
        draft.account_id = accountSelect.value;
        draft.destination_account_id = destBlock.hidden ? null : destSelect.value;
        draft.date = qs('[data-date]', sheet).value;
        draft.time = qs('[data-time]', sheet).value;
        draft.description = descriptionInput.value.trim();
        draft.notes = qs('[data-notes]', sheet).value.trim();
        draft.counterparty = qs('[data-counterparty]', sheet).value.trim();
        draft.due_date = qs('[data-due]', sheet).value || null;
        draft.tags = qs('[data-tags]', sheet).value.split(',').map((t) => t.trim()).filter(Boolean);

        const payload = {
          transaction_type: draft.transaction_type,
          amount: draft.amount,
          date: draft.date,
          time: draft.time,
          category_id: needsCategory(draft.transaction_type) ? draft.category_id : null,
          subcategory_id: draft.subcategory_id,
          account_id: draft.account_id,
          destination_account_id: draft.destination_account_id,
          description: draft.description,
          notes: draft.notes,
          counterparty: draft.counterparty,
          tags: draft.tags,
          attachment: draft.attachment,
          reference_id: needsOpenRecord(draft.transaction_type) ? referenceSelect.value : null,
          reference_type: needsOpenRecord(draft.transaction_type)
            ? (draft.transaction_type === TRANSACTION_TYPES.DEBT_PAYMENT ? 'debt' : 'receivable')
            : null,
        };

        if (!draft.amount || draft.amount <= 0) { showError('amount', 'Nominal harus lebih dari 0.'); toast('Nominal belum diisi.', { tone: 'warn' }); return; }
        if (needsCategory(draft.transaction_type) && !draft.category_id) { showError('category_id', 'Pilih kategori.'); toast('Kategori belum dipilih.', { tone: 'warn' }); return; }
        if (needsLinkedEntity(draft.transaction_type) && !draft.counterparty) { toast('Nama pihak wajib diisi untuk hutang/piutang.', { tone: 'warn' }); return; }
        if (needsOpenRecord(draft.transaction_type) && !referenceSelect.value) { toast('Tidak ada data hutang/piutang yang bisa dipilih.', { tone: 'warn' }); return; }

        try {
          if (editing) {
            await store.updateTransaction(editing.id, payload, { force: draft.force });
            toast('Perubahan disimpan.', { tone: 'pos', title: 'Berhasil' });
          } else {
            await store.addTransaction(payload, {
              force: draft.force,
              linkEntity: needsLinkedEntity(draft.transaction_type)
                ? {
                  counterparty: draft.counterparty,
                  principal: draft.amount,
                  account_id: draft.account_id,
                  start_date: draft.date,
                  due_date: draft.due_date,
                  notes: draft.notes,
                }
                : null,
            });
            recents.push('categories', draft.category_id);
            recents.push('accounts', draft.account_id);
            toast(
              `${TRANSACTION_TYPE_META[draft.transaction_type].label} ${money(draft.amount)} tersimpan.`,
              { tone: 'pos', title: 'Transaksi dicatat' },
            );
          }
          cfg.onSaved?.();
          if (keepOpen) {
            draft.amount = 0;
            draft.description = '';
            draft.descriptionTouched = false;
            draft.notes = '';
            draft.attachment = null;
            descriptionInput.value = '';
            qs('[data-notes]', sheet).value = '';
            renderAmount();
            renderAttachment();
            amountInput.focus();
          } else {
            api.close();
          }
        } catch (error) {
          if (error instanceof AppError) {
            if (error.code === 'duplicate') {
              duplicateBanner.hidden = false;
              duplicateText.textContent = error.message;
              draft.force = true;
              return;
            }
            Object.entries(error.fields || {}).forEach(([field, message]) => showError(field, message));
            toast(error.message, { tone: 'neg', title: 'Tidak bisa disimpan' });
            return;
          }
          console.error(error);
          toast('Terjadi kesalahan saat menyimpan transaksi.', { tone: 'neg' });
        }
      }

      on(sheet, 'click', '[data-save]', () => submit(false));
      on(sheet, 'click', '[data-save-more]', () => submit(true));
      on(sheet, 'click', '[data-force-save]', () => submit(false));
      on(sheet, 'click', '[data-cancel]', () => api.close());
      descriptionInput.addEventListener('input', () => { draft.descriptionTouched = true; isiDetail(); });
      qs('[data-notes]', sheet).addEventListener('input', isiDetail);
      qs('[data-tags]', sheet).addEventListener('input', isiDetail);
      accountSelect.addEventListener('change', () => {
        draft.account_id = accountSelect.value;
        if (!destBlock.hidden) buildDestinationOptions();
      });
      destSelect.addEventListener('change', () => { draft.destination_account_id = destSelect.value; });
      sheet.addEventListener('keydown', (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); submit(false); }
      });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Debt / receivable payment sheets                                    */
/* ------------------------------------------------------------------ */

export function openDebtPayment({ debtId, onDone }) {
  const state = store.state;
  const debt = state.debts.find((d) => d.id === debtId);
  if (!debt) return null;
  const info = debtState(debt, state.debtPayments);
  const balances = balanceMap(state);
  const accounts = state.accounts.filter((a) => a.status !== 'archived');

  return openAdaptive({
    title: `Bayar Hutang · ${debt.counterparty}`,
    iconName: 'hand-coins',
    size: 'sm',
    body: `
      <div class="stack-5">
        <div class="banner is-warn">
          ${icon('info', { size: 18 })}
          <div class="grow t-xs">Pokok ${esc(money(info.principal))}${info.terms.hasInterest ? ` + bunga ${esc(money(info.terms.interest))} = ${esc(money(info.obligation))}` : ''} ·
            sudah dibayar ${esc(money(info.paid))} · <strong>sisa ${esc(money(info.remaining))}</strong>${info.terms.installment ? ` · cicilan ${esc(money(info.terms.installment))}/bln${info.monthsLeft ? ` (${info.monthsLeft}× lagi)` : ''}` : ''}</div>
        </div>
        <div class="field">
          <span class="field-label">Nominal pembayaran</span>
          <div class="input-group">
            <span class="input-prefix">Rp</span>
            <input class="input amount-input" data-amount inputmode="numeric" data-autofocus placeholder="0" style="padding-left:44px" value="${esc(formatAmountTyping(info.terms.installment > 0 ? Math.min(info.remaining, info.terms.installment) : (Math.min(info.remaining, Math.max(0, balances.get(debt.account_id) || 0)) || info.remaining)))}" />
          </div>
          <div class="chip-row">
            ${info.terms.installment > 0 && info.remaining > info.terms.installment ? `<button type="button" class="chip" data-fill="installment">Cicilan (${esc(money(info.terms.installment, { compact: true }))})</button>` : ''}
            <button type="button" class="chip" data-fill="remaining">Lunasi sisa (${esc(money(info.remaining, { compact: true }))})</button>
            <button type="button" class="chip" data-fill="balance">Sesuaikan ke saldo akun</button>
            ${[100_000, 500_000, 1_000_000].map((v) => v <= info.remaining ? `<button type="button" class="chip" data-add="${v}">+${esc(money(v, { compact: true }))}</button>` : '').join('')}
          </div>
          <div class="banner is-warn" data-afford hidden></div>
        </div>
        <div class="grid grid-2">
          ${fieldHtml({ label: 'Tanggal', name: 'date', id: 'pay-date', control: `<input class="input" type="date" id="pay-date" data-date value="${todayISO()}" />` })}
          ${fieldHtml({ label: 'Akun pembayaran', name: 'account_id', id: 'pay-acc', control: `<select class="select" id="pay-acc" data-account>${accounts.map((a) => `<option value="${esc(a.id)}" ${a.id === debt.account_id ? 'selected' : ''}>${esc(a.name)} — ${esc(money(balances.get(a.id) || 0))}</option>`).join('')}</select>` })}
        </div>
        ${fieldHtml({ label: 'Catatan', name: 'notes', id: 'pay-notes', control: '<input class="input" id="pay-notes" data-notes placeholder="Angsuran ke-n (opsional)" />' })}
      </div>`,
    footer: '<button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-primary ml-auto" data-pay>Bayar Sekarang</button>',
    onMount(sheet, api) {
      const amountInput = qs('[data-amount]', sheet);
      const accountSelect = qs('[data-account]', sheet);
      const afford = qs('[data-afford]', sheet);
      const val = (selector) => qs(selector, sheet)?.value ?? '';

      const balanceOf = (id) => balances.get(id) || 0;
      /** Live feedback: can the selected account actually cover this payment? */
      const syncAffordability = () => {
        const balance = balanceOf(accountSelect.value);
        const entered = parseMoneyInput(amountInput.value);
        const accountName = state.accounts.find((a) => a.id === accountSelect.value)?.name || 'Akun';
        if (entered > balance) {
          afford.hidden = false;
          afford.className = 'banner is-neg';
          afford.innerHTML = `${icon('alert', { size: 18 })}<div class="grow t-xs">
            Saldo ${esc(accountName)} (${esc(money(balance))}) tidak cukup untuk pembayaran ${esc(money(entered))}.
            Kurangi nominalnya atau pilih akun lain.</div>`;
        } else if (info.remaining > balance) {
          afford.hidden = false;
          afford.className = 'banner is-warn';
          afford.innerHTML = `${icon('info', { size: 18 })}<div class="grow t-xs">
            Sisa hutang ${esc(money(info.remaining))} lebih besar dari saldo ${esc(accountName)} (${esc(money(balance))}).
            Anda bisa membayar sebagian terlebih dahulu.</div>`;
        } else {
          afford.hidden = true;
        }
      };

      amountInput.addEventListener('input', () => {
        const digits = amountInput.value.replace(/[^\d]/g, '');
        amountInput.value = digits ? formatAmountTyping(parseInt(digits, 10)) : '';
        syncAffordability();
      });
      accountSelect.addEventListener('change', syncAffordability);
      on(sheet, 'click', '[data-fill]', (event, btn) => {
        let target = info.remaining;
        if (btn.dataset.fill === 'balance') target = balanceOf(accountSelect.value);
        if (btn.dataset.fill === 'installment') target = info.terms.installment;
        amountInput.value = formatAmountTyping(Math.max(0, Math.min(info.remaining, target)));
        syncAffordability();
      });
      on(sheet, 'click', '[data-add]', (event, btn) => {
        const current = parseMoneyInput(amountInput.value);
        amountInput.value = formatAmountTyping(Math.min(info.remaining, current + parseInt(btn.dataset.add, 10)));
        syncAffordability();
      });
      syncAffordability();
      on(sheet, 'click', '[data-pay]', async () => {
        const amount = parseMoneyInput(amountInput.value);
        try {
          await store.payDebt(debt.id, {
            amount,
            account_id: val('[data-account]') || debt.account_id,
            date: val('[data-date]') || todayISO(),
            notes: val('[data-notes]'),
          });
          api.close();
          toast(`Pembayaran ${money(amount)} ke ${debt.counterparty} tercatat.`, { tone: 'pos', title: 'Hutang berkurang' });
          onDone?.();
        } catch (error) {
          toast(error.message || 'Pembayaran gagal.', { tone: 'neg', title: 'Gagal' });
        }
      });
    },
  });
}

export function openReceivablePayment({ receivableId, onDone }) {
  const state = store.state;
  const rec = state.receivables.find((r) => r.id === receivableId);
  if (!rec) return null;
  const info = receivableState(rec, state.receivablePayments);
  const balances = balanceMap(state);
  const accounts = state.accounts.filter((a) => a.status !== 'archived');

  return openAdaptive({
    title: `Terima Piutang · ${rec.counterparty}`,
    iconName: 'circle-check',
    size: 'sm',
    body: `
      <div class="stack-5">
        <div class="banner is-pos">
          ${icon('info', { size: 18 })}
          <div class="grow t-xs">Total ${esc(money(info.principal))} · sudah diterima ${esc(money(info.received))} ·
            <strong>sisa ${esc(money(info.remaining))}</strong>${rec.due_date ? ` · jatuh tempo ${esc(formatDate(rec.due_date))}` : ''}</div>
        </div>
        <div class="field">
          <span class="field-label">Nominal diterima</span>
          <div class="input-group">
            <span class="input-prefix">Rp</span>
            <input class="input amount-input" data-amount inputmode="numeric" data-autofocus placeholder="0" style="padding-left:44px" value="${esc(formatAmountTyping(info.remaining))}" />
          </div>
          <div class="chip-row"><button type="button" class="chip" data-fill>Terima pelunasan (${esc(money(info.remaining, { compact: true }))})</button></div>
        </div>
        <div class="grid grid-2">
          ${fieldHtml({ label: 'Tanggal', name: 'date', id: 'rec-date', control: `<input class="input" type="date" id="rec-date" data-date value="${todayISO()}" />` })}
          ${fieldHtml({ label: 'Masuk ke akun', name: 'account_id', id: 'rec-acc', control: `<select class="select" id="rec-acc" data-account>${accounts.map((a) => `<option value="${esc(a.id)}" ${a.id === rec.account_id ? 'selected' : ''}>${esc(a.name)} — ${esc(money(balances.get(a.id) || 0))}</option>`).join('')}</select>` })}
        </div>
        ${fieldHtml({ label: 'Catatan', name: 'notes', id: 'rec-notes', control: '<input class="input" id="rec-notes" data-notes placeholder="Pembayaran tahap ke-n (opsional)" />' })}
      </div>`,
    footer: '<button class="btn btn-ghost" data-close>Batal</button><button class="btn btn-success ml-auto" data-receive>Catat Penerimaan</button>',
    onMount(sheet, api) {
      const amountInput = qs('[data-amount]', sheet);
      const val = (selector) => qs(selector, sheet)?.value ?? '';
      amountInput.addEventListener('input', () => {
        const digits = amountInput.value.replace(/[^\d]/g, '');
        amountInput.value = digits ? formatAmountTyping(parseInt(digits, 10)) : '';
      });
      on(sheet, 'click', '[data-fill]', () => { amountInput.value = formatAmountTyping(info.remaining); });
      on(sheet, 'click', '[data-receive]', async () => {
        const amount = parseMoneyInput(amountInput.value);
        try {
          await store.receivePayment(rec.id, {
            amount,
            account_id: val('[data-account]') || rec.account_id,
            date: val('[data-date]') || todayISO(),
            notes: val('[data-notes]'),
          });
          api.close();
          toast(`Penerimaan ${money(amount)} dari ${rec.counterparty} tercatat.`, { tone: 'pos', title: 'Piutang berkurang' });
          onDone?.();
        } catch (error) {
          toast(error.message || 'Penerimaan gagal.', { tone: 'neg', title: 'Gagal' });
        }
      });
    },
  });
}

export { initials, maskAccountNumber };
