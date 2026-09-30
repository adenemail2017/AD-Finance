/**
 * Application store — single source of truth.
 *
 * Pattern: in-memory state + write-through persistence (IndexedDB, with
 * localStorage fallback) + optimistic UI. Every mutation validates first,
 * writes atomically, then notifies subscribers so pages can re-render.
 *
 * All money mutations go through services/finance.js rules so the ledger can
 * never drift out of balance (see docs/ARCHITECTURE.md → Accounting rules).
 */

import * as idb from '../database/idb.js';
import { buildDefaultCategories, buildDemoDataset } from '../database/seed.js';
import {
  DEBT_STATUS, RECEIVABLE_STATUS, TRANSACTION_TYPES, TRANSFER_LIKE,
  makeAccount, makeBudget, makeCategory, makeDebt, makePayment, makeReceivable,
  makeTransaction, monthKey, toISODate, toISOTime, transactionFingerprint,
} from '../types/models.js';
import { uid } from '../utils/id.js';
import { setCurrency, setLocale } from '../utils/format.js';
import { refreshNotifications } from './notifications.js';
import { accountBalance, debtState, receivableState } from './finance.js';

export class AppError extends Error {
  constructor(message, { code = 'error', fields = {} } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.fields = fields;
  }
}

const DEFAULT_PROFILE = {
  id: 'local',
  name: 'Pemilik Akun',
  email: '',
  currency: 'IDR',
  locale: 'id-ID',
  theme: 'system',
  low_balance_threshold: 250_000,
  month_start_day: 1,
  onboarding_done: false,
  demo_loaded: false,
  created_at: new Date().toISOString(),
};

const EMPTY_STATE = {
  ready: false,
  profile: { ...DEFAULT_PROFILE },
  accounts: [],
  transactions: [],
  categories: [],
  debts: [],
  debtPayments: [],
  receivables: [],
  receivablePayments: [],
  budgets: [],
  notifications: [],
  settings: {},
  outbox: [],
  sync: {
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    pending: 0,
    lastSync: null,
    ...storageSync(),
  },
  demo: false,
  version: 1,
};

/** Storage mode can only be known once the async storage probe settles. */
function storageSync() {
  const mode = idb.persistenceMode();
  return {
    mode: mode === 'indexeddb' ? 'IndexedDB' : mode === 'local' ? 'localStorage' : 'Memori sesi',
    persistence: mode,
  };
}

let state = { ...EMPTY_STATE };
const listeners = new Set();
let channel = null;

/* ------------------------------------------------------------------ */
/* Pub/sub                                                             */
/* ------------------------------------------------------------------ */

export function getState() {
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let emitScheduled = false;

export function emit(reason = 'update') {
  if (emitScheduled) return;
  emitScheduled = true;
  queueMicrotask(() => {
    emitScheduled = false;
    listeners.forEach((fn) => {
      try { fn(state, reason); } catch (err) { console.error('[store] listener failed', err); }
    });
  });
}

function patch(partial, reason) {
  state = { ...state, ...partial };
  emit(reason);
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

export async function initStore() {
  const [profileRows, settingsRows, accounts, transactions, categories, debts, debtPayments,
    receivables, receivablePayments, budgets, notifications, outbox] = await Promise.all([
    idb.getAll('profiles'), idb.getAll('settings'), idb.getAll('accounts'), idb.getAll('transactions'),
    idb.getAll('categories'), idb.getAll('debts'), idb.getAll('debt_payments'), idb.getAll('receivables'),
    idb.getAll('receivable_payments'), idb.getAll('budgets'), idb.getAll('notifications'), idb.getAll('outbox'),
  ]);

  let profile = profileRows[0] || null;
  let demo = false;

  if (!profile) {
    // first run → scaffold a complete, realistic workspace
    profile = { ...DEFAULT_PROFILE, id: 'local' };
    await idb.put('profiles', profile);
    const dataset = buildDemoDataset(profile.id);
    await Promise.all([
      idb.putMany('categories', dataset.categories),
      idb.putMany('accounts', dataset.accounts),
      idb.putMany('transactions', dataset.transactions),
      idb.putMany('debts', dataset.debts),
      idb.putMany('debt_payments', dataset.debtPayments),
      idb.putMany('receivables', dataset.receivables),
      idb.putMany('receivable_payments', dataset.receivablePayments),
      idb.putMany('budgets', dataset.budgets),
      idb.put('settings', { key: 'theme', value: profile.theme }),
      idb.put('settings', { key: 'seeded', value: true }),
    ]);
    demo = true;
    await idb.put('profiles', { ...profile, demo_loaded: true });
    state = {
      ...EMPTY_STATE,
      profile: { ...profile, demo_loaded: true },
      accounts: dataset.accounts,
      transactions: dataset.transactions,
      categories: dataset.categories,
      debts: dataset.debts,
      debtPayments: dataset.debtPayments,
      receivables: dataset.receivables,
      receivablePayments: dataset.receivablePayments,
      budgets: dataset.budgets,
      notifications: [],
      settings: { theme: profile.theme },
      outbox: [],
      demo: true,
      ready: true,
    };
  } else {
    state = {
      ...EMPTY_STATE,
      profile: { ...DEFAULT_PROFILE, ...profile },
      accounts, transactions, categories, debts, debtPayments, receivables,
      receivablePayments, budgets, notifications, outbox,
      settings: Object.fromEntries(settingsRows.map((s) => [s.key, s.value])),
      demo: !!profile.demo_loaded,
      ready: true,
      sync: { ...EMPTY_STATE.sync, pending: outbox.filter((o) => o.sync_status === 'pending').length },
    };
  }

  applyProfileFormatting(state.profile);
  // derive entity statuses AND surface the first batch of alerts (overdue debt,
  // budget warnings, due-soon receivables, welcome message)
  // now that the storage probe has resolved, publish the real persistence mode
  state = { ...state, sync: { ...state.sync, ...storageSync() } };
  await syncDerived({ notify: true });
  setupNetworkWatchers();
  setupCrossTab();
  emit('init');
  return state;
}

function applyProfileFormatting(profile) {
  setCurrency(profile.currency || 'IDR');
  setLocale(profile.locale || 'id-ID');
}

function setupNetworkWatchers() {
  if (typeof window === 'undefined') return;
  const update = () => setSync({ online: navigator.onLine });
  window.addEventListener('online', () => { update(); flushOutbox(); });
  window.addEventListener('offline', update);
}

function setupCrossTab() {
  if (typeof BroadcastChannel === 'undefined') return;
  channel = new BroadcastChannel('pfos');
  channel.onmessage = (event) => {
    if (event.data?.type === 'refresh') refreshFromStorage();
  };
}

function broadcast() {
  channel?.postMessage({ type: 'refresh', at: Date.now() });
}

async function refreshFromStorage() {
  const [accounts, transactions, categories, debts, debtPayments, receivables,
    receivablePayments, budgets, notifications, outbox, profiles] = await Promise.all([
    idb.getAll('accounts'), idb.getAll('transactions'), idb.getAll('categories'), idb.getAll('debts'),
    idb.getAll('debt_payments'), idb.getAll('receivables'), idb.getAll('receivable_payments'),
    idb.getAll('budgets'), idb.getAll('notifications'), idb.getAll('outbox'), idb.getAll('profiles'),
  ]);
  state = {
    ...state, accounts, transactions, categories, debts, debtPayments, receivables,
    receivablePayments, budgets, notifications, outbox, profile: { ...state.profile, ...(profiles[0] || {}) },
  };
  await syncDerived();
  emit('external-change');
}

/* ------------------------------------------------------------------ */
/* Derived data (debt/receivable status + notifications)               */
/* ------------------------------------------------------------------ */

export async function syncDerived({ notify = true } = {}) {
  // Recompute stored statuses so exports/filters always match derived views.
  const debtUpdates = [];
  state.debts.forEach((debt) => {
    const info = debtState(debt, state.debtPayments);
    if (debt.status !== info.status) debtUpdates.push({ ...debt, status: info.status, updated_at: new Date().toISOString() });
  });
  const recUpdates = [];
  state.receivables.forEach((rec) => {
    const info = receivableState(rec, state.receivablePayments);
    if (rec.status !== info.status) recUpdates.push({ ...rec, status: info.status, updated_at: new Date().toISOString() });
  });
  if (debtUpdates.length) {
    await idb.putMany('debts', debtUpdates);
    const map = new Map(debtUpdates.map((d) => [d.id, d]));
    state = { ...state, debts: state.debts.map((d) => map.get(d.id) || d) };
  }
  if (recUpdates.length) {
    await idb.putMany('receivables', recUpdates);
    const map = new Map(recUpdates.map((r) => [r.id, r]));
    state = { ...state, receivables: state.receivables.map((r) => map.get(r.id) || r) };
  }

  if (!notify) return;
  const fresh = refreshNotifications(state).filter((n) => !state.notifications.some((old) => old.key === n.key));
  if (fresh.length) {
    await idb.putMany('notifications', fresh);
    patch({ notifications: [...fresh, ...state.notifications] }, 'notifications');
  }
}

/* ------------------------------------------------------------------ */
/* Outbox / sync                                                       */
/* ------------------------------------------------------------------ */

function setSync(partial) {
  patch({ sync: { ...state.sync, ...partial } }, 'sync');
}

async function enqueue(action, store, payload) {
  const item = {
    id: uid('out'),
    action,
    store,
    payload,
    created_at: new Date().toISOString(),
    sync_status: 'pending',
  };
  await idb.put('outbox', item);
  state = { ...state, outbox: [...state.outbox, item] };
  setSync({ pending: state.outbox.filter((o) => o.sync_status === 'pending').length });
  broadcast();
  return item;
}

/** Push queued mutations to the configured API (optional — app is local-first). */
export async function flushOutbox() {
  const endpoint = state.settings.sync_endpoint || '';
  const pending = state.outbox.filter((o) => o.sync_status === 'pending');
  if (!endpoint || !navigator.onLine || !pending.length) return { pushed: 0 };
  try {
    const res = await fetch(`${endpoint.replace(/\/$/, '')}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: state.profile.id, operations: pending }),
    });
    if (!res.ok) throw new Error(`Sync failed (${res.status})`);
    const done = pending.map((o) => ({ ...o, sync_status: 'synced', synced_at: new Date().toISOString() }));
    await idb.putMany('outbox', done);
    const map = new Map(done.map((d) => [d.id, d]));
    state = { ...state, outbox: state.outbox.map((o) => map.get(o.id) || o) };
    setSync({ pending: state.outbox.filter((o) => o.sync_status === 'pending').length, lastSync: new Date().toISOString() });
    return { pushed: done.length };
  } catch (err) {
    console.warn('[sync] flush failed', err);
    return { pushed: 0, error: err.message };
  }
}

/* ------------------------------------------------------------------ */
/* Profile & settings                                                  */
/* ------------------------------------------------------------------ */

export async function updateProfile(patchProfile) {
  const profile = { ...state.profile, ...patchProfile, updated_at: new Date().toISOString() };
  await idb.put('profiles', profile);
  applyProfileFormatting(profile);
  patch({ profile }, 'profile');
  broadcast();
  return profile;
}

export async function setSetting(key, value) {
  await idb.put('settings', { key, value });
  patch({ settings: { ...state.settings, [key]: value } }, 'settings');
  return value;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export function validateTransaction(input, { force = false } = {}) {
  const errors = {};
  const amount = Math.abs(Number(input.amount) || 0);
  if (!amount) errors.amount = 'Nominal wajib diisi dan lebih dari 0.';
  if (!input.date) errors.date = 'Tanggal wajib diisi.';
  if (!input.account_id) errors.account_id = 'Pilih akun terlebih dahulu.';

  const type = input.transaction_type;
  if (TRANSFER_LIKE.includes(type)) {
    if (!input.destination_account_id) errors.destination_account_id = 'Pilih akun tujuan.';
    if (input.destination_account_id && input.destination_account_id === input.account_id) {
      errors.destination_account_id = 'Akun asal dan tujuan tidak boleh sama.';
    }
  }
  if ([TRANSACTION_TYPES.INCOME, TRANSACTION_TYPES.EXPENSE].includes(type) && !input.category_id) {
    errors.category_id = type === TRANSACTION_TYPES.INCOME
      ? 'Pilih kategori pemasukan.' : 'Pilih kategori pengeluaran.';
  }

  if (Object.keys(errors).length) {
    throw new AppError('Periksa kembali data transaksi.', { code: 'validation', fields: errors });
  }

  // Balance checks (friendly, account-specific messages)
  const allowNegative = !!state.settings.allow_negative;
  const account = state.accounts.find((a) => a.id === input.account_id);
  if (!account) throw new AppError('Akun tidak ditemukan.');

  const before = accountBalance(state, account.id);
  const afterMonies = [TRANSACTION_TYPES.EXPENSE, TRANSACTION_TYPES.RECEIVABLE, TRANSACTION_TYPES.DEBT_PAYMENT].includes(type);
  const movesOut = afterMonies || TRANSFER_LIKE.includes(type);
  if (movesOut && !allowNegative && before - amount < 0 && type !== TRANSACTION_TYPES.RECEIVABLE) {
    throw new AppError(
      `Saldo ${account.name} tidak mencukupi untuk transaksi ini. Saldo saat ini ${formatSaldo(before, account)}, dibutuhkan ${formatSaldo(amount, account)}.`,
      { code: 'insufficient_balance', fields: { amount: 'Saldo tidak mencukupi.' } },
    );
  }

  if (type === TRANSACTION_TYPES.DEBT_PAYMENT) {
    const debt = state.debts.find((d) => d.id === input.reference_id);
    if (!debt) throw new AppError('Hutang yang ingin dibayar tidak ditemukan.');
    const { remaining } = debtState(debt, state.debtPayments);
    if (amount > remaining) {
      throw new AppError(`Nominal melebihi sisa hutang (${formatSaldo(remaining, account)}).`);
    }
  }

  if (type === TRANSACTION_TYPES.RECEIVABLE_PAYMENT) {
    const rec = state.receivables.find((r) => r.id === input.reference_id);
    if (!rec) throw new AppError('Piutang tidak ditemukan.');
    const { remaining } = receivableState(rec, state.receivablePayments);
    if (amount > remaining) {
      throw new AppError(`Nominal melebihi sisa piutang (${formatSaldo(remaining, account)}).`);
    }
  }

  if (!force && input.date) {
    const fp = transactionFingerprint(input);
    const duplicate = state.transactions.find((t) => !t.deleted_at && transactionFingerprint(t) === fp);
    if (duplicate) {
      throw new AppError('Transaksi identik sudah tercatat hari ini. Ubah nominal/waktu atau ubah data lain untuk melanjutkan.', { code: 'duplicate' });
    }
  }
  return true;
}

function formatSaldo(value, account) {
  try {
    return new Intl.NumberFormat(state.profile.locale || 'id-ID', {
      style: 'currency', currency: state.profile.currency || 'IDR', maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `Rp ${Math.round(value).toLocaleString('id-ID')}`;
  }
}

/* ------------------------------------------------------------------ */
/* Transactions                                                        */
/* ------------------------------------------------------------------ */

export async function addTransaction(input, opts = {}) {
  validateTransaction(input, opts);
  const txn = makeTransaction({ ...input, id: uid('trx'), user_id: state.profile.id, sync_status: 'pending' });
  await idb.put('transactions', txn);
  state = { ...state, transactions: [txn, ...state.transactions] };

  // Auto-create the linked debt / receiving entity when recording a new one
  if (opts.linkEntity) {
    if (txn.transaction_type === TRANSACTION_TYPES.DEBT) await createDebt({ ...opts.linkEntity, transaction: txn }, { fromTransaction: true });
    if (txn.transaction_type === TRANSACTION_TYPES.RECEIVABLE) await createReceivable({ ...opts.linkEntity, transaction: txn }, { fromTransaction: true });
  }

  await enqueue('create', 'transactions', txn);
  await syncDerived();
  emit('transaction-added');
  return txn;
}

export async function updateTransaction(id, patchTxn, opts = {}) {
  const existing = state.transactions.find((t) => t.id === id);
  if (!existing) throw new AppError('Transaksi tidak ditemukan.');
  const merged = { ...existing, ...patchTxn, updated_at: new Date().toISOString(), sync_status: 'pending' };
  validateTransaction(merged, { ...opts, force: true });
  await idb.put('transactions', merged);
  state = { ...state, transactions: state.transactions.map((t) => (t.id === id ? merged : t)) };
  await enqueue('update', 'transactions', merged);
  await syncDerived();
  emit('transaction-updated');
  return merged;
}

export async function deleteTransaction(id, { silent = false } = {}) {
  const existing = state.transactions.find((t) => t.id === id);
  if (!existing) return false;
  await idb.remove('transactions', id);
  state = { ...state, transactions: state.transactions.filter((t) => t.id !== id) };
  // cascade: remove payments that produced this transaction
  const linkedDebtPayments = state.debtPayments.filter((p) => p.transaction_id === id);
  const linkedRecPayments = state.receivablePayments.filter((p) => p.transaction_id === id);
  if (linkedDebtPayments.length) await removeRows('debt_payments', linkedDebtPayments.map((p) => p.id));
  if (linkedRecPayments.length) await removeRows('receivable_payments', linkedRecPayments.map((p) => p.id));
  await enqueue('delete', 'transactions', { id });
  await syncDerived();
  if (!silent) emit('transaction-deleted');
  return true;
}

async function removeRows(storeName, ids) {
  await idb.removeMany(storeName, ids);
  const set = new Set(ids);
  if (storeName === 'debt_payments') state = { ...state, debtPayments: state.debtPayments.filter((p) => !set.has(p.id)) };
  if (storeName === 'receivable_payments') state = { ...state, receivablePayments: state.receivablePayments.filter((p) => !set.has(p.id)) };
}

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

export async function addAccount(input) {
  const account = makeAccount({
    ...input,
    id: input.id || uid('acc'),
    user_id: state.profile.id,
    sort_order: state.accounts.length,
  });
  await idb.put('accounts', account);
  state = { ...state, accounts: [...state.accounts, account] };
  await enqueue('create', 'accounts', account);
  emit('account-added');
  return account;
}

export async function updateAccount(id, patchAccount) {
  const existing = state.accounts.find((a) => a.id === id);
  if (!existing) throw new AppError('Akun tidak ditemukan.');
  const merged = { ...existing, ...patchAccount, updated_at: new Date().toISOString() };
  await idb.put('accounts', merged);
  state = { ...state, accounts: state.accounts.map((a) => (a.id === id ? merged : a)) };
  await enqueue('update', 'accounts', merged);
  emit('account-updated');
  return merged;
}

/** Deleting an account with history is blocked; archive instead. */
export async function deleteAccount(id) {
  const hasHistory = state.transactions.some((t) => t.account_id === id || t.destination_account_id === id);
  if (hasHistory) {
    const account = state.accounts.find((a) => a.id === id);
    const merged = { ...account, status: 'archived', updated_at: new Date().toISOString() };
    await idb.put('accounts', merged);
    state = { ...state, accounts: state.accounts.map((a) => (a.id === id ? merged : a)) };
    await enqueue('update', 'accounts', merged);
    emit('account-archived');
    return { archived: true };
  }
  await idb.remove('accounts', id);
  state = { ...state, accounts: state.accounts.filter((a) => a.id !== id) };
  await enqueue('delete', 'accounts', { id });
  emit('account-deleted');
  return { archived: false };
}

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

export async function addCategory(input) {
  const category = makeCategory({ ...input, id: uid(input.parent_id ? 'sub' : 'cat'), user_id: state.profile.id });
  await idb.put('categories', category);
  state = { ...state, categories: [...state.categories, category] };
  await enqueue('create', 'categories', category);
  emit('category-added');
  return category;
}

export async function updateCategory(id, patchCategory) {
  const existing = state.categories.find((c) => c.id === id);
  if (!existing) throw new AppError('Kategori tidak ditemukan.');
  const merged = { ...existing, ...patchCategory };
  await idb.put('categories', merged);
  state = { ...state, categories: state.categories.map((c) => (c.id === id ? merged : c)) };
  await enqueue('update', 'categories', merged);
  emit('category-updated');
  return merged;
}

export async function deleteCategory(id) {
  const used = state.transactions.some((t) => t.category_id === id || t.subcategory_id === id);
  if (used) {
    const existing = state.categories.find((c) => c.id === id);
    const merged = { ...existing, archived: true };
    await idb.put('categories', merged);
    state = { ...state, categories: state.categories.map((c) => (c.id === id ? merged : c)) };
    emit('category-archived');
    return { archived: true };
  }
  const children = state.categories.filter((c) => c.parent_id === id).map((c) => c.id);
  const ids = [id, ...children];
  await idb.removeMany('categories', ids);
  const set = new Set(ids);
  state = { ...state, categories: state.categories.filter((c) => !set.has(c.id)), budgets: state.budgets.filter((b) => !set.has(b.category_id)) };
  await idb.removeMany('budgets', state.budgets.filter((b) => set.has(b.category_id)).map((b) => b.id));
  emit('category-deleted');
  return { archived: false };
}

/* ------------------------------------------------------------------ */
/* Debts & receivables                                                 */
/* ------------------------------------------------------------------ */

export async function createDebt(input, { fromTransaction = false } = {}) {
  const debt = makeDebt({
    ...input,
    id: uid('debt'),
    user_id: state.profile.id,
    account_id: input.account_id || null,
    status: DEBT_STATUS.ACTIVE,
  });
  await idb.put('debts', debt);
  state = { ...state, debts: [...state.debts, debt] };

  if (!fromTransaction) {
    // booking the loan: account +, liability +
    await addTransaction({
      transaction_type: TRANSACTION_TYPES.DEBT,
      date: debt.start_date,
      time: toISOTime(),
      amount: debt.principal,
      account_id: debt.account_id,
      reference_id: debt.id,
      reference_type: 'debt',
      counterparty: debt.counterparty,
      description: `Hutang dari ${debt.counterparty}`,
      tags: ['hutang'],
    }, { force: true });
  }
  await enqueue('create', 'debts', debt);
  await syncDerived();
  emit('debt-created');
  return debt;
}

export async function updateDebt(id, patchDebt) {
  const existing = state.debts.find((d) => d.id === id);
  if (!existing) throw new AppError('Hutang tidak ditemukan.');
  const merged = { ...existing, ...patchDebt, updated_at: new Date().toISOString() };
  await idb.put('debts', merged);
  state = { ...state, debts: state.debts.map((d) => (d.id === id ? merged : d)) };
  await enqueue('update', 'debts', merged);
  await syncDerived();
  emit('debt-updated');
  return merged;
}

export async function deleteDebt(id, { removeTransactions = true } = {}) {
  const payments = state.debtPayments.filter((p) => p.debt_id === id);
  await idb.remove('debts', id);
  await idb.removeMany('debt_payments', payments.map((p) => p.id));
  state = { ...state, debts: state.debts.filter((d) => d.id !== id), debtPayments: state.debtPayments.filter((p) => p.debt_id !== id) };
  if (removeTransactions) {
    const linked = state.transactions.filter((t) => t.reference_id === id && t.reference_type === 'debt');
    await Promise.all(linked.map((t) => deleteTransaction(t.id, { silent: true })));
  }
  await enqueue('delete', 'debts', { id });
  await syncDerived();
  emit('debt-deleted');
  return true;
}

/** Record a debt payment — money out, outstanding down, ledger entry created. */
export async function payDebt(debtId, { amount, account_id, date, time, notes }) {
  const debt = state.debts.find((d) => d.id === debtId);
  if (!debt) throw new AppError('Hutang tidak ditemukan.');
  const info = debtState(debt, state.debtPayments);
  const value = Math.abs(Number(amount) || 0);
  if (!value) throw new AppError('Nominal pembayaran wajib diisi.');
  if (value > info.remaining) throw new AppError(`Nominal melebihi sisa hutang (${info.remaining.toLocaleString('id-ID')}).`);

  const txn = await addTransaction({
    transaction_type: TRANSACTION_TYPES.DEBT_PAYMENT,
    date: date || toISODate(),
    time: time || toISOTime(),
    amount: value,
    account_id: account_id || debt.account_id || state.accounts[0]?.id,
    reference_id: debt.id,
    reference_type: 'debt',
    counterparty: debt.counterparty,
    description: `Bayar hutang ${debt.counterparty}`,
    notes: notes || '',
    tags: ['hutang'],
  }, { force: true });

  const payment = makePayment({
    id: uid('dp'),
    user_id: state.profile.id,
    debt_id: debt.id,
    account_id: txn.account_id,
    amount: value,
    date: txn.date,
    time: txn.time,
    notes: notes || '',
    transaction_id: txn.id,
  });
  await idb.put('debt_payments', payment);
  state = { ...state, debtPayments: [...state.debtPayments, payment] };

  const after = debtState(debt, state.debtPayments);
  const merged = { ...debt, status: after.status, updated_at: new Date().toISOString() };
  await idb.put('debts', merged);
  state = { ...state, debts: state.debts.map((d) => (d.id === debt.id ? merged : d)) };

  await enqueue('create', 'debt_payments', payment);
  await syncDerived();
  emit('debt-paid');
  return { transaction: txn, payment, debt: merged };
}

export async function createReceivable(input, { fromTransaction = false } = {}) {
  const rec = makeReceivable({
    ...input,
    id: uid('rec'),
    user_id: state.profile.id,
    status: RECEIVABLE_STATUS.ACTIVE,
  });
  await idb.put('receivables', rec);
  state = { ...state, receivables: [...state.receivables, rec] };

  if (!fromTransaction) {
    await addTransaction({
      transaction_type: TRANSACTION_TYPES.RECEIVABLE,
      date: rec.start_date,
      time: toISOTime(),
      amount: rec.principal,
      account_id: rec.account_id,
      reference_id: rec.id,
      reference_type: 'receivable',
      counterparty: rec.counterparty,
      description: `Piutang ke ${rec.counterparty}`,
      tags: ['piutang'],
    }, { force: true, skipBalanceCheck: true });
  }
  await enqueue('create', 'receivables', rec);
  await syncDerived();
  emit('receivable-created');
  return rec;
}

export async function updateReceivable(id, patchRec) {
  const existing = state.receivables.find((r) => r.id === id);
  if (!existing) throw new AppError('Piutang tidak ditemukan.');
  const merged = { ...existing, ...patchRec, updated_at: new Date().toISOString() };
  await idb.put('receivables', merged);
  state = { ...state, receivables: state.receivables.map((r) => (r.id === id ? merged : r)) };
  await enqueue('update', 'receivables', merged);
  await syncDerived();
  emit('receivable-updated');
  return merged;
}

export async function deleteReceivable(id, { removeTransactions = true } = {}) {
  const payments = state.receivablePayments.filter((p) => p.receivable_id === id);
  await idb.remove('receivables', id);
  await idb.removeMany('receivable_payments', payments.map((p) => p.id));
  state = {
    ...state,
    receivables: state.receivables.filter((r) => r.id !== id),
    receivablePayments: state.receivablePayments.filter((p) => p.receivable_id !== id),
  };
  if (removeTransactions) {
    const linked = state.transactions.filter((t) => t.reference_id === id && t.reference_type === 'receivable');
    await Promise.all(linked.map((t) => deleteTransaction(t.id, { silent: true })));
  }
  await enqueue('delete', 'receivables', { id });
  await syncDerived();
  emit('receivable-deleted');
  return true;
}

export async function receivePayment(receivableId, { amount, account_id, date, time, notes }) {
  const rec = state.receivables.find((r) => r.id === receivableId);
  if (!rec) throw new AppError('Piutang tidak ditemukan.');
  const info = receivableState(rec, state.receivablePayments);
  const value = Math.abs(Number(amount) || 0);
  if (!value) throw new AppError('Nominal penerimaan wajib diisi.');
  if (value > info.remaining) throw new AppError(`Nominal melebihi sisa piutang (${info.remaining.toLocaleString('id-ID')}).`);

  const txn = await addTransaction({
    transaction_type: TRANSACTION_TYPES.RECEIVABLE_PAYMENT,
    date: date || toISODate(),
    time: time || toISOTime(),
    amount: value,
    account_id: account_id || rec.account_id || state.accounts[0]?.id,
    reference_id: rec.id,
    reference_type: 'receivable',
    counterparty: rec.counterparty,
    description: `Terima piutang ${rec.counterparty}`,
    notes: notes || '',
    tags: ['piutang'],
  }, { force: true });

  const payment = makePayment({
    id: uid('rp'),
    user_id: state.profile.id,
    receivable_id: rec.id,
    account_id: txn.account_id,
    amount: value,
    date: txn.date,
    time: txn.time,
    notes: notes || '',
    transaction_id: txn.id,
  });
  await idb.put('receivable_payments', payment);
  state = { ...state, receivablePayments: [...state.receivablePayments, payment] };

  const after = receivableState(rec, state.receivablePayments);
  const merged = { ...rec, status: after.status, updated_at: new Date().toISOString() };
  await idb.put('receivables', merged);
  state = { ...state, receivables: state.receivables.map((r) => (r.id === rec.id ? merged : r)) };

  await enqueue('create', 'receivable_payments', payment);
  await syncDerived();
  emit('receivable-paid');
  return { transaction: txn, payment, receivable: merged };
}

/* ------------------------------------------------------------------ */
/* Budgets                                                             */
/* ------------------------------------------------------------------ */

export async function saveBudget({ id, category_id, amount, period, rollover = false }) {
  if (!category_id) throw new AppError('Pilih kategori untuk budget.');
  const existing = id ? state.budgets.find((b) => b.id === id) : state.budgets.find((b) => b.category_id === category_id && b.period === period);
  const budget = makeBudget({
    ...(existing || {}),
    id: existing?.id || uid('bud'),
    user_id: state.profile.id,
    category_id,
    amount: Math.abs(Number(amount) || 0),
    period: period || monthKey(),
    rollover,
  });
  await idb.put('budgets', budget);
  state = { ...state, budgets: existing ? state.budgets.map((b) => (b.id === budget.id ? budget : b)) : [...state.budgets, budget] };
  await enqueue(existing ? 'update' : 'create', 'budgets', budget);
  emit('budget-saved');
  return budget;
}

export async function deleteBudget(id) {
  await idb.remove('budgets', id);
  state = { ...state, budgets: state.budgets.filter((b) => b.id !== id) };
  await enqueue('delete', 'budgets', { id });
  emit('budget-deleted');
  return true;
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

export async function markNotificationRead(id) {
  const notif = state.notifications.find((n) => n.id === id);
  if (!notif) return null;
  const merged = { ...notif, read: true };
  await idb.put('notifications', merged);
  state = { ...state, notifications: state.notifications.map((n) => (n.id === id ? merged : n)) };
  emit('notification-read');
  return merged;
}

export async function markAllNotificationsRead() {
  const updated = state.notifications.map((n) => ({ ...n, read: true }));
  await idb.putMany('notifications', updated);
  state = { ...state, notifications: updated };
  emit('notifications-read');
}

export async function clearNotifications() {
  await idb.clearStore('notifications');
  state = { ...state, notifications: [] };
  emit('notifications-cleared');
}

/* ------------------------------------------------------------------ */
/* Data lifecycle (settings page)                                      */
/* ------------------------------------------------------------------ */

export async function loadDemoData() {
  const dataset = buildDemoDataset(state.profile.id);
  await Promise.all([
    idb.clearStore('transactions'), idb.clearStore('debt_payments'), idb.clearStore('receivable_payments'),
    idb.clearStore('debts'), idb.clearStore('receivables'), idb.clearStore('budgets'),
    idb.clearStore('accounts'), idb.clearStore('categories'), idb.clearStore('notifications'),
  ]);
  await Promise.all([
    idb.putMany('categories', dataset.categories),
    idb.putMany('accounts', dataset.accounts),
    idb.putMany('transactions', dataset.transactions),
    idb.putMany('debts', dataset.debts),
    idb.putMany('debt_payments', dataset.debtPayments),
    idb.putMany('receivables', dataset.receivables),
    idb.putMany('receivable_payments', dataset.receivablePayments),
    idb.putMany('budgets', dataset.budgets),
  ]);
  await updateProfile({ demo_loaded: true, onboarding_done: true });
  patch({ ...dataset, notifications: [], demo: true }, 'demo-loaded');
  emit('data-reloaded');
  return true;
}

/** Reset everything except the essentials the user needs to start clean. */
export async function startFresh({ keepCategories = true, openingBalance = 0 } = {}) {
  const categories = keepCategories ? state.categories.length ? state.categories : buildDefaultCategories(state.profile.id) : buildDefaultCategories(state.profile.id);
  await Promise.all([
    idb.clearStore('transactions'), idb.clearStore('debt_payments'), idb.clearStore('receivable_payments'),
    idb.clearStore('debts'), idb.clearStore('receivables'), idb.clearStore('budgets'),
    idb.clearStore('accounts'), idb.clearStore('notifications'), idb.clearStore('categories'),
  ]);
  const categoriesToWrite = keepCategories ? categories : buildDefaultCategories(state.profile.id);
  await idb.putMany('categories', categoriesToWrite);

  const defaultAccount = makeAccount({
    id: uid('acc'),
    user_id: state.profile.id,
    name: 'Cash Wallet',
    account_type: 'cash',
    institution: 'Cash',
    opening_balance: openingBalance,
    color: '#16a34a',
    icon: 'cash',
    is_default: true,
  });
  await idb.put('accounts', defaultAccount);
  await updateProfile({ demo_loaded: false, onboarding_done: true });
  patch({
    categories: categoriesToWrite,
    accounts: [defaultAccount],
    transactions: [], debts: [], debtPayments: [], receivables: [], receivablePayments: [],
    budgets: [], notifications: [], demo: false,
  }, 'fresh-start');
  emit('data-reloaded');
  return true;
}

export async function wipeEverything() {
  await idb.clearAll();
  try { localStorage.removeItem('pfos:route'); } catch { /* ignore */ }
  state = { ...EMPTY_STATE };
  await initStore();
  emit('wiped');
}

export async function importDataset(rows) {
  const allowed = ['accounts', 'categories', 'transactions', 'debts', 'debt_payments',
    'receivables', 'receivable_payments', 'budgets'];
  let count = 0;
  for (const key of allowed) {
    if (Array.isArray(rows[key]) && rows[key].length) {
      await idb.putMany(key, rows[key]);
      count += rows[key].length;
    }
  }
  await refreshFromStorage();
  return count;
}

export function exportDataset() {
  return {
    version: 1,
    exported_at: new Date().toISOString(),
    profile: state.profile,
    accounts: state.accounts,
    categories: state.categories,
    transactions: state.transactions,
    debts: state.debts,
    debt_payments: state.debtPayments,
    receivables: state.receivables,
    receivable_payments: state.receivablePayments,
    budgets: state.budgets,
  };
}

export const store = {
  get state() { return state; },
  getState,
  subscribe,
  emit,
  init: initStore,
  updateProfile,
  setSetting,
  addTransaction,
  updateTransaction,
  deleteTransaction,
  addAccount,
  updateAccount,
  deleteAccount,
  addCategory,
  updateCategory,
  deleteCategory,
  createDebt,
  updateDebt,
  deleteDebt,
  payDebt,
  createReceivable,
  updateReceivable,
  deleteReceivable,
  receivePayment,
  saveBudget,
  deleteBudget,
  markNotificationRead,
  markAllNotificationsRead,
  clearNotifications,
  loadDemoData,
  startFresh,
  wipeEverything,
  importDataset,
  exportDataset,
  flushOutbox,
  validateTransaction,
};

export default store;
