/**
 * Finance engine — pure derivations over the ledger.
 *
 * Everything here is read-only and side-effect free: given the same state it
 * returns the same numbers. Pages never compute money themselves.
 *
 * Accounting invariants enforced by these functions:
 *   income            : account +amount                     (net worth +)
 *   expense           : account −amount                     (net worth −)
 *   transfer/invest/EF: source −amount, destination +amount (net worth 0)
 *   new debt          : account +amount, liability +amount  (net worth 0)
 *   new receivable    : account −amount, asset +amount      (net worth 0)
 *   debt payment      : account −amount, liability −amount  (net worth 0)
 *   receivable payment: account +amount, asset −amount      (net worth 0)
 */

import { getState } from './store.js';
import {
  ACCOUNT_TYPES, TRANSACTION_TYPES, TRANSFER_LIKE, accountDelta, DEBT_STATUS, RECEIVABLE_STATUS,
} from '../types/models.js';
import { daysBetween, monthKey, monthKeyOfISO, parseMonthKey, toISO, todayISO } from '../utils/date.js';

const db0 = () => getState();

/* ------------------------------------------------------------------ */
/* Filters & ranges                                                    */
/* ------------------------------------------------------------------ */

export function txns(db = db0()) {
  return (db?.transactions || []).filter((t) => !t.deleted_at);
}

export function inRange(iso, from, to) {
  if (!iso) return false;
  if (from && iso < from) return false;
  if (to && iso > to) return false;
  return true;
}

export function filterTransactions(db, filters = {}) {
  const {
    from, to, types, accountId, categoryId, search, minAmount, maxAmount, counterparty, tag,
  } = filters;
  const needle = String(search || '').trim().toLowerCase();
  return txns(db).filter((t) => {
    if (!inRange(t.date, from, to)) return false;
    if (types?.length && !types.includes(t.transaction_type)) return false;
    if (accountId && t.account_id !== accountId && t.destination_account_id !== accountId) return false;
    if (categoryId && t.category_id !== categoryId && t.subcategory_id !== categoryId) return false;
    if (minAmount != null && t.amount < minAmount) return false;
    if (maxAmount != null && t.amount > maxAmount) return false;
    if (counterparty && String(t.counterparty || '').toLowerCase() !== counterparty.toLowerCase()) return false;
    if (tag && !(t.tags || []).includes(tag)) return false;
    if (needle) {
      const haystack = [t.description, t.notes, t.counterparty, String(t.amount)].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

export function sortTransactions(list, dir = 'desc') {
  const sign = dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const ka = `${a.date} ${a.time || '00:00'}`;
    const kb = `${b.date} ${b.time || '00:00'}`;
    if (ka === kb) return sign * String(a.created_at).localeCompare(String(b.created_at));
    return ka < kb ? -sign : sign;
  });
}

/* ------------------------------------------------------------------ */
/* Balances                                                            */
/* ------------------------------------------------------------------ */

/** @returns {Map<string, number>} account_id → current balance */
export function balanceMap(db = db0()) {
  const map = new Map();
  (db?.accounts || []).forEach((a) => map.set(a.id, Number(a.opening_balance) || 0));
  txns(db).forEach((t) => {
    const amount = Number(t.amount) || 0;
    if (t.account_id && map.has(t.account_id)) {
      map.set(t.account_id, map.get(t.account_id) + accountDelta(t, t.account_id));
    } else if (t.account_id && !map.has(t.account_id)) {
      map.set(t.account_id, accountDelta(t, t.account_id));
    }
    if (t.destination_account_id && map.has(t.destination_account_id)) {
      map.set(t.destination_account_id, map.get(t.destination_account_id) + accountDelta(t, t.destination_account_id));
    } else if (t.destination_account_id && !map.has(t.destination_account_id)) {
      map.set(t.destination_account_id, accountDelta(t, t.destination_account_id));
    }
    void amount;
  });
  return map;
}

/**
 * Balance *after* each transaction, keyed by transaction id.
 *
 * Walks the whole ledger in chronological order so the ledger view can show a
 * genuine running balance (not the account's current balance repeated). When
 * `accountId` is null the figure is the liquid portfolio total, where transfers
 * cancel out by construction.
 *
 * @returns {Map<string, number>} transaction id → balance after it
 */
export function runningBalanceMap(db = db0(), { accountId = null } = {}) {
  const list = txns(db).slice().sort((a, b) => `${a.date} ${a.time || '00:00'}`.localeCompare(`${b.date} ${b.time || '00:00'}`));
  const balances = balanceMap({ ...db, transactions: [] });   // opening balances only
  const out = new Map();
  const portfolio = () => [...balances.values()].reduce((acc, v) => acc + v, 0);

  list.forEach((t) => {
    const touched = [];
    if (t.account_id && balances.has(t.account_id)) {
      balances.set(t.account_id, balances.get(t.account_id) + accountDelta(t, t.account_id));
      touched.push(t.account_id);
    }
    if (t.destination_account_id && balances.has(t.destination_account_id)) {
      balances.set(t.destination_account_id, balances.get(t.destination_account_id) + accountDelta(t, t.destination_account_id));
      touched.push(t.destination_account_id);
    }
    if (!touched.length) return;
    if (accountId) {
      if (touched.includes(accountId)) out.set(t.id, balances.get(accountId));
    } else {
      out.set(t.id, portfolio());
    }
  });
  return out;
}

export function accountBalance(db, accountId, map = null) {
  const balances = map || balanceMap(db);
  return balances.get(accountId) || 0;
}

/** Balance of an account as of `asOf` (inclusive). */
export function accountBalanceAt(db, accountId, asOf) {
  const account = (db?.accounts || []).find((a) => a.id === accountId);
  let total = Number(account?.opening_balance) || 0;
  txns(db).forEach((t) => {
    if (t.date > asOf) return;
    total += accountDelta(t, accountId);
  });
  return total;
}

export function accountSummaries(db = db0()) {
  const balances = balanceMap(db);
  const list = db.accounts.map((account) => {
    const balance = balances.get(account.id) || 0;
    const history = txns(db).filter((t) => t.account_id === account.id || t.destination_account_id === account.id);
    const last = sortTransactions(history, 'desc')[0] || null;
    return {
      account,
      balance,
      txnCount: history.length,
      lastActivity: last ? last.date : null,
      isNegative: balance < 0,
    };
  });
  const total = list.filter((x) => x.account.status !== 'archived').reduce((acc, x) => acc + x.balance, 0);
  return list.map((x) => ({ ...x, share: total ? (x.balance / total) * 100 : 0 }));
}

export function totalBalance(db = db0(), { includeArchived = false } = {}) {
  const balances = balanceMap(db);
  return (db?.accounts || [])
    .filter((a) => includeArchived || a.status !== 'archived')
    .reduce((acc, a) => acc + (balances.get(a.id) || 0), 0);
}

export function assetTotals(db = db0()) {
  const balances = balanceMap(db);
  const groups = {
    [ACCOUNT_TYPES.BANK]: 0,
    [ACCOUNT_TYPES.EWALLET]: 0,
    [ACCOUNT_TYPES.CASH]: 0,
    [ACCOUNT_TYPES.INVESTMENT]: 0,
    [ACCOUNT_TYPES.EMERGENCY_FUND]: 0,
  };
  (db?.accounts || []).filter((a) => a.status !== 'archived').forEach((a) => {
    groups[a.account_type] = (groups[a.account_type] || 0) + (balances.get(a.id) || 0);
  });
  return groups;
}

export function debtOutstanding(db = db0()) {
  return (db?.debts || []).reduce((acc, d) => acc + debtState(d, db.debtPayments).remaining, 0);
}

export function receivableOutstanding(db = db0()) {
  return (db?.receivables || []).reduce((acc, r) => acc + receivableState(r, db.receivablePayments).remaining, 0);
}

export function netWorth(db = db0()) {
  const accounts = totalBalance(db);
  const receivables = receivableOutstanding(db);
  const debts = debtOutstanding(db);
  return { assets: accounts + receivables, accounts, receivables, debts, net: accounts + receivables - debts };
}

/* ------------------------------------------------------------------ */
/* Period flows                                                        */
/* ------------------------------------------------------------------ */

/** Aggregate of one period. Income/expense are *operational* (transfers excluded). */
export function periodTotals(db = db0(), from = '1970-01-01', to = '2999-12-31') {
  const buckets = {
    income: 0, expense: 0, transfer: 0, investment: 0, emergency_fund: 0,
    debt_payment: 0, receivable_payment: 0, debt_new: 0, receivable_new: 0,
  };
  let count = 0;
  let inflow = 0;
  let outflow = 0;
  const list = txns(db).filter((t) => inRange(t.date, from, to));
  list.forEach((t) => {
    const amount = Number(t.amount) || 0;
    count += 1;
    switch (t.transaction_type) {
      case TRANSACTION_TYPES.INCOME:
        buckets.income += amount; inflow += amount; break;
      case TRANSACTION_TYPES.EXPENSE:
        buckets.expense += amount; outflow += amount; break;
      case TRANSACTION_TYPES.TRANSFER:
        buckets.transfer += amount; break;
      case TRANSACTION_TYPES.INVESTMENT:
        buckets.investment += amount; break;
      case TRANSACTION_TYPES.EMERGENCY_FUND:
        buckets.emergency_fund += amount; break;
      case TRANSACTION_TYPES.DEBT_PAYMENT:
        buckets.debt_payment += amount; outflow += amount; break;
      case TRANSACTION_TYPES.DEBT:
        buckets.debt_new += amount; inflow += amount; break;
      case TRANSACTION_TYPES.RECEIVABLE:
        buckets.receivable_new += amount; outflow += amount; break;
      case TRANSACTION_TYPES.RECEIVABLE_PAYMENT:
        buckets.receivable_payment += amount; inflow += amount; break;
      default: break;
    }
  });
  const net = buckets.income - buckets.expense;
  return {
    ...buckets,
    count,
    inflow,
    outflow,
    net,
    savingsRate: buckets.income ? (net / buckets.income) * 100 : 0,
    avgDailyExpense: 0,
    list,
  };
}

export function monthTotals(db, key = monthKey()) {
  const { year, month } = parseMonthKey(key);
  const from = toISO(new Date(year, month, 1));
  const to = toISO(new Date(year, month + 1, 0));
  return periodTotals(db, from, to);
}

export function dailySeries(db = db0(), from, to) {
  const days = [];
  const byDate = new Map();
  txns(db).forEach((t) => {
    if (!inRange(t.date, from, to)) return;
    const entry = byDate.get(t.date) || { income: 0, expense: 0, net: 0, count: 0 };
    if (t.transaction_type === TRANSACTION_TYPES.INCOME) entry.income += t.amount;
    if (t.transaction_type === TRANSACTION_TYPES.EXPENSE) entry.expense += t.amount;
    entry.net = entry.income - entry.expense;
    entry.count += 1;
    byDate.set(t.date, entry);
  });
  let cursor = from;
  let guard = 0;
  while (cursor <= to && guard < 1500) {
    const entry = byDate.get(cursor) || { income: 0, expense: 0, net: 0, count: 0 };
    days.push({ date: cursor, ...entry });
    const d = new Date(cursor);
    d.setDate(d.getDate() + 1);
    cursor = toISO(d);
    guard += 1;
  }
  return days;
}

/** Monthly buckets across [from, to] — the workhorse for charts & recaps. */
export function monthlySeries(db = db0(), from, to) {
  const map = new Map();
  const ensure = (key) => {
    if (!map.has(key)) {
      map.set(key, {
        month: key,
        income: 0, expense: 0, investment: 0, emergency_fund: 0, debt_payment: 0,
        receivable_payment: 0, debt_new: 0, receivable_new: 0, transfer: 0, net: 0, netWorth: 0, count: 0,
      });
    }
    return map.get(key);
  };
  txns(db).forEach((t) => {
    if (!inRange(t.date, from, to)) return;
    const bucket = ensure(monthKeyOfISO(t.date));
    bucket.count += 1;
    switch (t.transaction_type) {
      case TRANSACTION_TYPES.INCOME: bucket.income += t.amount; break;
      case TRANSACTION_TYPES.EXPENSE: bucket.expense += t.amount; break;
      case TRANSACTION_TYPES.INVESTMENT: bucket.investment += t.amount; break;
      case TRANSACTION_TYPES.EMERGENCY_FUND: bucket.emergency_fund += t.amount; break;
      case TRANSACTION_TYPES.DEBT_PAYMENT: bucket.debt_payment += t.amount; break;
      case TRANSACTION_TYPES.RECEIVABLE_PAYMENT: bucket.receivable_payment += t.amount; break;
      case TRANSACTION_TYPES.DEBT: bucket.debt_new += t.amount; break;
      case TRANSACTION_TYPES.RECEIVABLE: bucket.receivable_new += t.amount; break;
      case TRANSACTION_TYPES.TRANSFER: bucket.transfer += t.amount; break;
      default: break;
    }
  });
  const rows = [...map.values()].sort((a, b) => (a.month < b.month ? -1 : 1));
  // trailing net-worth per month (accounts + receivables − debts, as of month end)
  rows.forEach((row) => {
    const { year, month } = parseMonthKey(row.month);
    const end = toISO(new Date(year, month + 1, 0));
    const accountPart = db.accounts.reduce((acc, a) => acc + accountBalanceAt(db, a.id, end), 0);
    const recPart = db.receivables
      .filter((r) => r.start_date <= end)
      .reduce((acc, r) => {
        const paid = db.receivablePayments
          .filter((p) => p.receivable_id === r.id && p.date <= end)
          .reduce((s, p) => s + p.amount, 0);
        return acc + Math.max(0, Math.min(r.principal - paid, r.principal));
      }, 0);
    const debtPart = db.debts
      .filter((d) => d.start_date <= end)
      .reduce((acc, d) => {
        const paid = db.debtPayments
          .filter((p) => p.debt_id === d.id && p.date <= end)
          .reduce((s, p) => s + p.amount, 0);
        return acc + Math.max(0, Math.min(d.principal - paid, d.principal));
      }, 0);
    row.net = row.income - row.expense;
    row.netWorth = accountPart + recPart - debtPart;
    row.endingBalance = accountPart;
  });
  return rows;
}

export function availableMonths(db = db0()) {
  const keys = new Set(txns(db).map((t) => monthKeyOfISO(t.date)));
  (db?.debts || []).forEach((d) => keys.add(monthKeyOfISO(d.start_date)));
  keys.add(monthKey());
  return [...keys].filter(Boolean).sort().reverse();
}

/* ------------------------------------------------------------------ */
/* Breakdowns                                                          */
/* ------------------------------------------------------------------ */

export function categoryBreakdown(db = db0(), { from, to, kind = 'expense', limit = 0 } = {}) {
  const typeFilter = kind === 'expense'
    ? [TRANSACTION_TYPES.EXPENSE, TRANSACTION_TYPES.DEBT_PAYMENT, TRANSACTION_TYPES.RECEIVABLE]
    : [TRANSACTION_TYPES.INCOME, TRANSACTION_TYPES.RECEIVABLE_PAYMENT];
  const catMap = new Map(db.categories.map((c) => [c.id, c]));
  const rows = new Map();
  txns(db).forEach((t) => {
    if (!inRange(t.date, from, to)) return;
    if (!typeFilter.includes(t.transaction_type)) return;
    if (t.transaction_type === TRANSACTION_TYPES.DEBT_PAYMENT || t.transaction_type === TRANSACTION_TYPES.RECEIVABLE) return;
    const cat = catMap.get(t.category_id);
    const parent = cat?.parent_id ? catMap.get(cat.parent_id) : cat;
    const key = parent?.id || 'uncategorized';
    const entry = rows.get(key) || {
      category: parent || { id: 'uncategorized', name: kind === 'expense' ? 'Tanpa Kategori' : 'Tanpa Kategori', icon: 'tag', color: '#94a3b8' },
      total: 0, count: 0, subs: new Map(),
    };
    entry.total += t.amount;
    entry.count += 1;
    if (cat?.parent_id) {
      const subKey = cat.id;
      const sub = entry.subs.get(subKey) || { name: cat.name, total: 0, count: 0, id: cat.id };
      sub.total += t.amount;
      sub.count += 1;
      entry.subs.set(subKey, sub);
    }
    rows.set(key, entry);
  });
  const total = [...rows.values()].reduce((acc, r) => acc + r.total, 0);
  let list = [...rows.values()].map((r) => ({
    ...r,
    share: total ? (r.total / total) * 100 : 0,
    subs: [...r.subs.values()].sort((a, b) => b.total - a.total),
  })).sort((a, b) => b.total - a.total);
  if (limit) list = list.slice(0, limit);
  return list;
}

export function accountBreakdown(db = db0(), { from, to } = {}) {
  const rows = new Map();
  txns(db).forEach((t) => {
    if (!inRange(t.date, from, to)) return;
    const outAccount = t.account_id;
    const delta = accountDelta(t, outAccount);
    const entryOut = rows.get(outAccount) || { account_id: outAccount, in: 0, out: 0, net: 0, count: 0 };
    if (delta > 0) entryOut.in += delta; else entryOut.out += Math.abs(delta);
    entryOut.net += delta;
    entryOut.count += 1;
    rows.set(outAccount, entryOut);
    if (t.destination_account_id) {
      const d = accountDelta(t, t.destination_account_id);
      const entryDest = rows.get(t.destination_account_id) || { account_id: t.destination_account_id, in: 0, out: 0, net: 0, count: 0 };
      if (d > 0) entryDest.in += d; else entryDest.out += Math.abs(d);
      entryDest.net += d;
      entryDest.count += 1;
      rows.set(t.destination_account_id, entryDest);
    }
  });
  const accountMap = new Map(db.accounts.map((a) => [a.id, a]));
  return [...rows.values()]
    .map((r) => ({ ...r, account: accountMap.get(r.account_id) }))
    .filter((r) => r.account)
    .sort((a, b) => b.in + b.out - (a.in + a.out));
}

export function topTransactions(db = db0(), { from, to, type = 'expense', limit = 5 } = {}) {
  const types = type === 'expense'
    ? [TRANSACTION_TYPES.EXPENSE]
    : [TRANSACTION_TYPES.INCOME];
  return sortTransactions(filterTransactions(db, { from, to, types }), 'desc')
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

export function topMerchants(db = db0(), { from, to, limit = 5 } = {}) {
  const rows = new Map();
  txns(db).forEach((t) => {
    if (t.transaction_type !== TRANSACTION_TYPES.EXPENSE) return;
    if (!inRange(t.date, from, to)) return;
    const key = (t.description || 'Tanpa keterangan').trim().toLowerCase();
    const entry = rows.get(key) || { name: t.description || 'Tanpa keterangan', total: 0, count: 0, category_id: t.category_id };
    entry.total += t.amount;
    entry.count += 1;
    rows.set(key, entry);
  });
  return [...rows.values()].sort((a, b) => b.total - a.total).slice(0, limit);
}

export function spendingHeatmap(db = db0(), key = monthKey()) {
  const { year, month } = parseMonthKey(key);
  const from = toISO(new Date(year, month, 1));
  const to = toISO(new Date(year, month + 1, 0));
  const byDate = new Map();
  let max = 0;
  txns(db).forEach((t) => {
    if (t.transaction_type !== TRANSACTION_TYPES.EXPENSE) return;
    if (!inRange(t.date, from, to)) return;
    byDate.set(t.date, (byDate.get(t.date) || 0) + t.amount);
    max = Math.max(max, byDate.get(t.date));
  });
  const cells = [];
  const firstWeekday = new Date(year, month, 1).getDay();
  for (let i = 0; i < firstWeekday; i += 1) cells.push({ empty: true });
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = toISO(new Date(year, month, day));
    const value = byDate.get(iso) || 0;
    cells.push({ date: iso, day, value, intensity: max ? value / max : 0 });
  }
  return { cells, max, daysInMonth, firstWeekday };
}

/* ------------------------------------------------------------------ */
/* Debt & receivable state                                             */
/* ------------------------------------------------------------------ */

/**
 * Bunga efektif per bulan (IRR) dari jadwal cicilan:
 * pokok = Σ cicilan / (1+i)^k  →  dicari dengan bisection (deterministik).
 * Cicilan terakhir dianggap sisa pembulatan (lebih kecil).
 */
function effectiveMonthlyRate(principal, installment, total) {
  if (!(principal > 0) || !(installment > 0) || !(total > principal)) return 0;
  const full = Math.floor(total / installment + 1e-9);
  if (full < 1) return 0;
  const last = total - full * installment;
  const pv = (i) => {
    let sum = 0;
    for (let k = 1; k <= full; k += 1) sum += installment / ((1 + i) ** k);
    if (last > 0) sum += last / ((1 + i) ** (full + 1));
    return sum;
  };
  let lo = 0;
  let hi = 1; // 100 % per bulan sudah jauh di atas bunga pinjaman mana pun
  for (let iter = 0; iter < 80; iter += 1) {
    const mid = (lo + hi) / 2;
    if (pv(mid) > principal) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Rincian bunga sebuah hutang — semuanya diturunkan, bukan diketik pengguna.
 *
 *   pokok (principal)          : uang yang dipinjam            → Rp 8.000.000
 *   total pelunasan (total)    : yang harus dibayar seluruhnya → Rp 13.000.000
 *   cicilan per bulan          :                           → Rp 1.153.334
 *   → bunga total, %, tenor, bunga flat/bulan, bunga efektif/bulan & /tahun
 */
function monthsBetween(startISO, endISO) {
  if (!startISO || !endISO) return 0;
  const a = new Date(`${startISO}T00:00:00`);
  const b = new Date(`${endISO}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return 0;
  const months = ((b.getFullYear() - a.getFullYear()) * 12) + (b.getMonth() - a.getMonth())
    + (b.getDate() > a.getDate() ? 1 : 0);
  return Math.max(1, months);
}

export function debtInterest(debt) {
  const principal = Math.max(0, Number(debt?.principal) || 0);
  const total = Math.max(0, Number(debt?.total_repayment) || 0);
  let installment = Math.max(0, Number(debt?.monthly_installment) || 0);
  const obligation = total > 0 ? total : principal; // kewajiban = total bila diisi
  const interest = total > principal ? total - principal : 0;
  const interestPct = principal > 0 && total > principal ? (interest / principal) * 100 : 0;
  let tenor = installment > 0 && total > 0 ? total / installment : 0;
  let tenorSource = installment > 0 && total > 0 ? 'installment' : 'none';
  if (!tenor) {
    // cicilan belum diisi → perkirakan tenor dari rentang tanggal hutang & jatuh tempo
    const months = monthsBetween(debt?.start_date, debt?.due_date);
    if (months && total > 0) {
      tenor = months;
      installment = total / months; // jadwal angsuran rata (asumsi standar)
      tenorSource = 'dates';
    }
  }
  const tenorMonths = tenor > 0 ? Math.ceil(tenor - 1e-6) : 0;
  const flatMonthly = tenor > 0 ? interestPct / tenor : 0;
  const effectiveMonthly = effectiveMonthlyRate(principal, installment, total) * 100;
  const effectiveAnnual = effectiveMonthly > 0 ? (((1 + effectiveMonthly / 100) ** 12) - 1) * 100 : 0;
  return {
    principal,
    total,
    obligation,
    installment,
    tenorSource,
    hasTerms: total > 0,
    hasInterest: interest > 0,
    interest,
    interestPct,
    tenor,
    tenorMonths,
    flatMonthly,
    flatAnnual: flatMonthly * 12,
    effectiveMonthly,
    effectiveAnnual,
  };
}

export function debtState(debt, payments = null) {
  const db = db0();
  const list = payments || (debt?.id ? [] : []);
  const relevant = Array.isArray(payments)
    ? (debt?.id ? payments.filter((p) => p.debt_id === debt.id) : payments)
    : (db?.debtPayments || []).filter((p) => p.debt_id === debt?.id);
  void list;
  const paid = relevant.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
  const terms = debtInterest(debt);
  const principal = terms.principal;
  const obligation = terms.obligation; // total pelunasan bila diisi, selain itu pokok
  const remaining = Math.max(0, obligation - paid);
  const progress = obligation ? Math.min(100, (paid / obligation) * 100) : 0;
  const monthsLeft = terms.installment > 0 ? Math.ceil((remaining / terms.installment) - 1e-9) : 0;
  const today = todayISO();
  const daysToDue = debt?.due_date ? daysBetween(today, debt.due_date) : null;
  let status = DEBT_STATUS.ACTIVE;
  if (remaining <= 0 && obligation > 0) status = DEBT_STATUS.PAID;
  else if (paid > 0) status = DEBT_STATUS.PARTIALLY_PAID;
  if (status !== DEBT_STATUS.PAID && daysToDue !== null && daysToDue < 0) status = DEBT_STATUS.OVERDUE;
  return {
    paid, principal, obligation, terms, monthsLeft, remaining, progress, status, daysToDue,
    isOverdue: status === DEBT_STATUS.OVERDUE,
    isDueSoon: daysToDue !== null && daysToDue >= 0 && daysToDue <= 7,
    payments: relevant.sort((a, b) => (a.date < b.date ? 1 : -1)),
    lastPayment: relevant.slice().sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null,
  };
}

export function receivableState(rec, payments = null) {
  const db = db0();
  const relevant = Array.isArray(payments)
    ? (rec?.id ? payments.filter((p) => p.receivable_id === rec.id) : payments)
    : (db?.receivablePayments || []).filter((p) => p.receivable_id === rec?.id);
  const received = relevant.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
  const principal = Number(rec?.principal) || 0;
  const remaining = Math.max(0, principal - received);
  const progress = principal ? Math.min(100, (received / principal) * 100) : 0;
  const today = todayISO();
  const daysToDue = rec?.due_date ? daysBetween(today, rec.due_date) : null;
  let status = RECEIVABLE_STATUS.ACTIVE;
  if (remaining <= 0 && principal > 0) status = RECEIVABLE_STATUS.RECEIVED;
  else if (received > 0) status = RECEIVABLE_STATUS.PARTIALLY_RECEIVED;
  if (status !== RECEIVABLE_STATUS.RECEIVED && daysToDue !== null && daysToDue < 0) status = RECEIVABLE_STATUS.OVERDUE;
  return {
    received, principal, remaining, progress, status, daysToDue,
    isOverdue: status === RECEIVABLE_STATUS.OVERDUE,
    isDueSoon: daysToDue !== null && daysToDue >= 0 && daysToDue <= 7,
    payments: relevant.sort((a, b) => (a.date < b.date ? 1 : -1)),
    lastPayment: relevant.slice().sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null,
  };
}

export function debtList(db = db0(), { status = 'open' } = {}) {
  return db.debts
    .map((d) => ({ debt: d, info: debtState(d, db.debtPayments) }))
    .filter((row) => (status === 'open' ? row.info.remaining > 0 : status === 'closed' ? row.info.remaining <= 0 : true))
    .sort((a, b) => {
      if (a.info.isOverdue !== b.info.isOverdue) return a.info.isOverdue ? -1 : 1;
      const da = a.debt.due_date || '2999-12-31';
      const dbb = b.debt.due_date || '2999-12-31';
      return da < dbb ? -1 : 1;
    });
}

export function receivableList(db = db0(), { status = 'open' } = {}) {
  return db.receivables
    .map((r) => ({ receivable: r, info: receivableState(r, db.receivablePayments) }))
    .filter((row) => (status === 'open' ? row.info.remaining > 0 : status === 'closed' ? row.info.remaining <= 0 : true))
    .sort((a, b) => {
      if (a.info.isOverdue !== b.info.isOverdue) return a.info.isOverdue ? -1 : 1;
      const da = a.receivable.due_date || '2999-12-31';
      const dbb = b.receivable.due_date || '2999-12-31';
      return da < dbb ? -1 : 1;
    });
}

/* ------------------------------------------------------------------ */
/* Budgets                                                             */
/* ------------------------------------------------------------------ */

export function budgetUsage(db = db0(), period = monthKey()) {
  const { year, month } = parseMonthKey(period);
  const from = toISO(new Date(year, month, 1));
  const to = toISO(new Date(year, month + 1, 0));
  const spentByCat = new Map();
  txns(db).forEach((t) => {
    if (t.transaction_type !== TRANSACTION_TYPES.EXPENSE) return;
    if (!inRange(t.date, from, to)) return;
    spentByCat.set(t.category_id, (spentByCat.get(t.category_id) || 0) + t.amount);
  });
  const catMap = new Map(db.categories.map((c) => [c.id, c]));
  return db.budgets
    .filter((b) => b.period === period)
    .map((budget) => {
      const category = catMap.get(budget.category_id);
      let spent = spentByCat.get(budget.category_id) || 0;
      db.categories.filter((c) => c.parent_id === budget.category_id)
        .forEach((sub) => { spent += spentByCat.get(sub.id) || 0; });
      const usage = budget.amount ? (spent / budget.amount) * 100 : 0;
      let level = 'ok';
      if (usage >= 100) level = 'over';
      else if (usage >= 80) level = 'warn';
      return {
        budget, category, spent, amount: budget.amount,
        remaining: Math.max(0, budget.amount - spent),
        overspend: Math.max(0, spent - budget.amount),
        usage, level,
      };
    })
    .sort((a, b) => b.usage - a.usage);
}

/* ------------------------------------------------------------------ */
/* Statement (rekening koran)                                          */
/* ------------------------------------------------------------------ */

/**
 * Build a bank-statement style view.
 * @param {object} opts { accountId|null, from, to }
 */
export function buildStatement(db = db0(), { accountId = null, from, to } = {}) {
  const list = sortTransactions(
    filterTransactions(db, { from, to, accountId: accountId || undefined }),
    'asc',
  );

  // Opening balance = portfolio/account balance just before `from`
  const dayBefore = (() => {
    const d = new Date(from);
    d.setDate(d.getDate() - 1);
    return toISO(d);
  })();

  let opening = 0;
  if (accountId) {
    opening = accountBalanceAt(db, accountId, dayBefore);
  } else {
    opening = db.accounts
      .filter((a) => a.status !== 'archived')
      .reduce((acc, a) => acc + accountBalanceAt(db, a.id, dayBefore), 0);
  }

  let running = opening;
  let totalIn = 0;
  let totalOut = 0;
  const rows = list.map((t) => {
    let debit = 0;
    let credit = 0;
    if (accountId) {
      const delta = accountDelta(t, accountId);
      if (delta > 0) credit = delta; else debit = Math.abs(delta);
    } else {
      // portfolio view: sum deltas across all accounts (transfers net to zero)
      const ids = new Set([t.account_id, t.destination_account_id].filter(Boolean));
      let net = 0;
      ids.forEach((id) => { net += accountDelta(t, id); });
      if (net > 0) credit = net; else if (net < 0) debit = Math.abs(net);
    }
    running += credit - debit;
    totalIn += credit;
    totalOut += debit;
    return { txn: t, debit, credit, balance: running };
  });

  const account = accountId ? db.accounts.find((a) => a.id === accountId) : null;
  return {
    account,
    accountId,
    from,
    to,
    opening,
    closing: running,
    totalIn,
    totalOut,
    rows,
    count: rows.length,
  };
}

/** Cash-in / cash-out on a specific account within a range (used by account cards). */
export function accountFlow(db, accountId, from, to) {
  let inflow = 0;
  let outflow = 0;
  txns(db).forEach((t) => {
    if (!inRange(t.date, from, to)) return;
    const delta = accountDelta(t, accountId);
    if (delta > 0) inflow += delta; else if (delta < 0) outflow += Math.abs(delta);
  });
  return { inflow, outflow, net: inflow - outflow };
}

/* ------------------------------------------------------------------ */
/* Comparisons & insights                                              */
/* ------------------------------------------------------------------ */

export function periodComparison(db = db0(), from, to) {
  const start = new Date(from);
  const end = new Date(to);
  const span = Math.max(1, Math.round((end - start) / 86_400_000) + 1);
  const prevTo = (() => { const d = new Date(start); d.setDate(d.getDate() - 1); return toISO(d); })();
  const prevFrom = (() => { const d = new Date(prevTo); d.setDate(d.getDate() - span + 1); return toISO(d); })();
  const current = periodTotals(db, from, to);
  const previous = periodTotals(db, prevFrom, prevTo);
  return {
    current,
    previous,
    range: { from, to, prevFrom, prevTo, span },
    deltas: {
      income: pctDelta(current.income, previous.income),
      expense: pctDelta(current.expense, previous.expense),
      net: pctDelta(current.net, previous.net),
      savingsRate: current.savingsRate - previous.savingsRate,
    },
  };
}

export function pctDelta(current, previous) {
  if (!previous) return current ? 100 : 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** Net worth as of today vs 30 days ago, for hero delta. */
export function netWorthTrend(db = db0(), days = 30) {
  const today = todayISO();
  const then = (() => { const d = new Date(); d.setDate(d.getDate() - days); return toISO(d); })();
  const now = netWorth(db).net;
  const accountPart = db.accounts.reduce((acc, a) => acc + accountBalanceAt(db, a.id, then), 0);
  const recPart = db.receivables.reduce((acc, r) => {
    const paid = db.receivablePayments.filter((p) => p.receivable_id === r.id && p.date <= then).reduce((s, p) => s + p.amount, 0);
    const started = r.start_date <= then ? r.principal - paid : 0;
    return acc + Math.max(0, started);
  }, 0);
  const debtPart = db.debts.reduce((acc, d) => {
    const paid = db.debtPayments.filter((p) => p.debt_id === d.id && p.date <= then).reduce((s, p) => s + p.amount, 0);
    const obligation = debtInterest(d).obligation; // pokok + bunga bila total pelunasan diisi
    const started = d.start_date <= then ? obligation - paid : 0;
    return acc + Math.max(0, started);
  }, 0);
  const before = accountPart + recPart - debtPart;
  return { now, before, change: now - before, pct: before ? ((now - before) / Math.abs(before)) * 100 : 0, days };
}

const fmtRp = (v) => {
  const n = Math.round(v);
  const abs = Math.abs(n).toLocaleString('id-ID');
  return `${n < 0 ? '-' : ''}Rp ${abs}`;
};

/**
 * Data-driven insights. Returns [] while there is not enough history —
 * the UI simply hides the section in that case.
 */
export function insights(db = db0()) {
  const out = [];
  const currentKey = monthKey();
  const { year, month } = parseMonthKey(currentKey);
  const from = toISO(new Date(year, month, 1));
  const to = toISO(new Date(year, month + 1, 0));
  const prevKey = (() => { const d = new Date(year, month - 1, 1); return monthKey(d); })();
  const { year: py, month: pm } = parseMonthKey(prevKey);
  const prevFrom = toISO(new Date(py, pm, 1));
  const prevTo = toISO(new Date(py, pm + 1, 0));

  const cur = periodTotals(db, from, to);
  const prev = periodTotals(db, prevFrom, prevTo);
  const hasPrev = prev.count > 0;
  const hasCur = cur.count > 0;

  if (hasCur && hasPrev && prev.expense > 0) {
    const change = ((cur.expense - prev.expense) / prev.expense) * 100;
    if (Math.abs(change) >= 1) {
      out.push({
        tone: change > 0 ? 'warn' : 'pos',
        icon: change > 0 ? 'trending-up' : 'trending-down',
        title: `Pengeluaran ${Math.abs(change).toFixed(0)}% lebih ${change > 0 ? 'tinggi' : 'rendah'} dari bulan lalu`,
        text: `Bulan ini ${fmtRp(cur.expense)} vs ${fmtRp(prev.expense)} pada periode sebelumnya.`,
      });
    }
  }

  if (hasCur) {
    const byCat = categoryBreakdown(db, { from, to, kind: 'expense', limit: 1 });
    if (byCat.length && cur.expense > 0) {
      const top = byCat[0];
      out.push({
        tone: top.share > 40 ? 'warn' : 'brand',
        icon: top.category.icon || 'tag',
        title: `${top.category.name} menyerap ${top.share.toFixed(0)}% pengeluaran bulan ini`,
        text: `Total ${fmtRp(top.total)} dari ${top.count} transaksi.`,
      });
    }
  }

  if (hasCur && hasPrev) {
    const delta = cur.net - prev.net;
    out.push({
      tone: delta >= 0 ? 'pos' : 'neg',
      icon: delta >= 0 ? 'trending-up' : 'trending-down',
      title: `Arus kas bersih ${delta >= 0 ? 'meningkat' : 'menurun'} ${fmtRp(Math.abs(delta))}`,
      text: `Net cash flow bulan ini ${fmtRp(cur.net)} (bulan lalu ${fmtRp(prev.net)}).`,
    });
  }

  const trend = netWorthTrend(db, 30);
  if (hasCur || hasPrev) {
    out.push({
      tone: trend.change >= 0 ? 'pos' : 'neg',
      icon: 'wallet',
      title: `Kekayaan bersih ${trend.change >= 0 ? 'naik' : 'turun'} ${fmtRp(Math.abs(trend.change))} dalam 30 hari`,
      text: `Net worth saat ini ${fmtRp(trend.now)}.`,
    });
  }

  const openDebts = debtList(db, { status: 'open' });
  const overdueDebts = openDebts.filter((d) => d.info.isOverdue);
  if (overdueDebts.length) {
    out.push({
      tone: 'neg',
      icon: 'alert',
      title: `${overdueDebts.length} hutang sudah melewati jatuh tempo`,
      text: `Total ${fmtRp(overdueDebts.reduce((acc, d) => acc + d.info.remaining, 0))} perlu segera diselesaikan.`,
    });
  } else if (openDebts.length) {
    const dueSoon = openDebts.filter((d) => d.info.isDueSoon);
    out.push({
      tone: dueSoon.length ? 'warn' : 'brand',
      icon: 'hand-coins',
      title: dueSoon.length ? `${dueSoon.length} hutang jatuh tempo dalam 7 hari` : `Hutang aktif ${fmtRp(debtOutstanding(db))}`,
      text: dueSoon.length
        ? `Siapkan dana untuk ${dueSoon.map((d) => d.debt.counterparty).join(', ')}.`
        : `${openDebts.length} hutang berjalan dengan total sisa ${fmtRp(debtOutstanding(db))}.`,
    });
  }

  const openRec = receivableList(db, { status: 'open' });
  if (openRec.length) {
    const soon = openRec.filter((r) => r.info.isDueSoon || r.info.isOverdue);
    out.push({
      tone: soon.length ? 'warn' : 'brand',
      icon: 'file-text',
      title: `Piutang berjalan ${fmtRp(receivableOutstanding(db))}`,
      text: soon.length
        ? `${soon.length} piutang mendekati/melewati jatuh tempo — kirim pengingat ke ${soon.map((r) => r.receivable.counterparty).join(', ')}.`
        : `${openRec.length} piutang aktif, semuanya masih dalam tenggat.`,
    });
  }

  // recurring expense detection (≥3 distinct months with same description)
  const merchantMonths = new Map();
  txns(db).forEach((t) => {
    if (t.transaction_type !== TRANSACTION_TYPES.EXPENSE) return;
    const key = (t.description || '').trim().toLowerCase();
    if (!key) return;
    if (!merchantMonths.has(key)) merchantMonths.set(key, { name: t.description, months: new Set(), total: 0 });
    const entry = merchantMonths.get(key);
    entry.months.add(monthKeyOfISO(t.date));
    entry.total += t.amount;
  });
  const recurring = [...merchantMonths.values()].filter((m) => m.months.size >= 3).sort((a, b) => b.months.size - a.months.size)[0];
  if (recurring) {
    out.push({
      tone: 'brand',
      icon: 'repeat',
      title: 'Pengeluaran rutin terdeteksi',
      text: `"${recurring.name}" muncul di ${recurring.months.size} bulan berbeda dengan total ${fmtRp(recurring.total)}.`,
    });
  }

  const rate = cur.savingsRate;
  if (hasCur && cur.income > 0) {
    out.push({
      tone: rate >= 20 ? 'pos' : rate >= 0 ? 'warn' : 'neg',
      icon: 'target',
      title: `Savings rate bulan ini ${rate.toFixed(0)}%`,
      text: rate >= 20
        ? 'Bagus — di atas 20% dari pemasukan berhasil disimpan.'
        : rate >= 0
          ? 'Coba tekan pengeluaran tidak esensial agar rasio tabungan naik ke 20%.'
          : 'Pengeluaran bulan ini melebihi pemasukan.',
    });
  }

  const ef = assetTotals(db)[ACCOUNT_TYPES.EMERGENCY_FUND] || 0;
  if (ef > 0 && hasCur) {
    const months = cur.expense > 0 ? ef / cur.expense : 0;
    out.push({
      tone: months >= 3 ? 'pos' : 'warn',
      icon: 'shield',
      title: `Dana darurat setara ${months.toFixed(1)} bulan pengeluaran`,
      text: months >= 3 ? 'Sudah di atas standar 3 bulan. Pertahankan.' : 'Target minimal 3 bulan pengeluaran untuk keamanan finansial.',
    });
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Global search                                                       */
/* ------------------------------------------------------------------ */

export function searchAll(db = db0(), query, limit = 8) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return { transactions: [], accounts: [], debts: [], receivables: [], categories: [] };
  const catMap = new Map(db.categories.map((c) => [c.id, c]));
  const matches = (text) => String(text || '').toLowerCase().includes(q);

  const transactions = sortTransactions(txns(db).filter((t) => {
    const cat = catMap.get(t.category_id);
    return matches(t.description) || matches(t.notes) || matches(t.counterparty)
      || matches(cat?.name) || matches(t.amount) || matches(String(t.amount).replace(/\B(?=(\d{3})+(?!\d))/g, '.'));
  }), 'desc').slice(0, limit);

  const accounts = db.accounts.filter((a) => matches(a.name) || matches(a.institution)
    || matches(String(a.account_number).replace(/\s/g, ''))).slice(0, limit);

  const debts = db.debts.filter((d) => matches(d.counterparty) || matches(d.notes)).slice(0, limit);
  const receivables = db.receivables.filter((r) => matches(r.counterparty) || matches(r.notes)).slice(0, limit);
  const categories = db.categories.filter((c) => matches(c.name)).slice(0, limit);

  return { transactions, accounts, debts, receivables, categories };
}

/* ------------------------------------------------------------------ */
/* Recurring / projections                                             */
/* ------------------------------------------------------------------ */

/** Average monthly expense over the last N complete months (excluding current). */
export function averageMonthlyExpense(db = db0(), months = 3) {
  const rows = [];
  for (let i = 1; i <= months; i += 1) {
    const d = new Date();
    d.setMonth(d.getMonth() - i, 1);
    rows.push(monthTotals(db, monthKey(d)));
  }
  const valid = rows.filter((r) => r.count > 0);
  if (!valid.length) return 0;
  return valid.reduce((acc, r) => acc + r.expense, 0) / valid.length;
}

/** Runway: how many months current liquid assets can cover at avg burn. */
export function runwayMonths(db = db0()) {
  const burn = averageMonthlyExpense(db, 3);
  if (burn <= 0) return null;
  const liquid = totalBalance(db);
  return liquid / burn;
}

export function dashboardSummary(db = db0()) {
  const key = monthKey();
  const { year, month } = parseMonthKey(key);
  const from = toISO(new Date(year, month, 1));
  const to = toISO(new Date(year, month + 1, 0));
  const month_ = periodTotals(db, from, to);
  const prevD = new Date(year, month - 1, 1);
  const prevKey = monthKey(prevD);
  const prev = monthTotals(db, prevKey);
  const worth = netWorth(db);
  const trend = netWorthTrend(db, 30);
  return {
    monthKey: key,
    monthTotals: month_,
    previousTotals: prev,
    worth,
    trend,
    accounts: accountSummaries(db),
    assets: assetTotals(db),
    debts: debtList(db, { status: 'open' }),
    receivables: receivableList(db, { status: 'open' }),
    budgets: budgetUsage(db, key),
    recent: sortTransactions(txns(db), 'desc').slice(0, 8),
    insights: insights(db),
    incomeDelta: pctDelta(month_.income, prev.income),
    expenseDelta: pctDelta(month_.expense, prev.expense),
    netDelta: pctDelta(month_.net, prev.net),
    savingsPrev: prev.savingsRate,
    range: { from, to },
  };
}

export { TRANSFER_LIKE, TRANSACTION_TYPES, ACCOUNT_TYPES };
