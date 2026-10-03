/**
 * Accounting-invariant tests — the ledger must never lie.
 *   node --test tests/
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDemoDataset, buildDefaultCategories } from '../src/database/seed.js';
import {
  accountBalance, accountBalanceAt, balanceMap, buildStatement, budgetUsage, categoryBreakdown,
  debtInterest, debtState, insights, monthlySeries, netWorth, periodTotals, receivableState, totalBalance,
} from '../src/services/finance.js';
import {
  TRANSACTION_TYPES, accountDelta, makeTransaction, transactionFingerprint, isIncome, isExpense,
} from '../src/types/models.js';
import { parseMoneyInput, formatAmountTyping, money, maskAccountNumber } from '../src/utils/format.js';
import { addDays, monthKey, todayISO, toISO } from '../src/utils/date.js';

const dataset = buildDemoDataset('test-user');
const db = {
  profile: { id: 'test-user', currency: 'IDR', locale: 'id-ID' },
  ...dataset,
  notifications: [],
  settings: {},
};

const openingTotal = dataset.accounts.reduce((acc, a) => acc + a.opening_balance, 0);

/* ------------------------------------------------------------------ */
/* Core rules                                                          */
/* ------------------------------------------------------------------ */

test('accountDelta implements double-entry rules for every transaction type', () => {
  const acc = 'A';
  const dest = 'B';
  const cases = [
    [TRANSACTION_TYPES.INCOME, acc, 100, acc, +100],
    [TRANSACTION_TYPES.INCOME, acc, 100, dest, 0],
    [TRANSACTION_TYPES.EXPENSE, acc, 100, acc, -100],
    [TRANSACTION_TYPES.DEBT, acc, 100, acc, +100],
    [TRANSACTION_TYPES.RECEIVABLE, acc, 100, acc, -100],
    [TRANSACTION_TYPES.DEBT_PAYMENT, acc, 100, acc, -100],
    [TRANSACTION_TYPES.RECEIVABLE_PAYMENT, acc, 100, acc, +100],
    [TRANSACTION_TYPES.TRANSFER, acc, 100, acc, -100],
    [TRANSACTION_TYPES.TRANSFER, acc, 100, dest, +100],
    [TRANSACTION_TYPES.INVESTMENT, acc, 100, acc, -100],
    [TRANSACTION_TYPES.INVESTMENT, acc, 100, dest, +100],
    [TRANSACTION_TYPES.EMERGENCY_FUND, acc, 100, dest, +100],
  ];
  const transferLike = [TRANSACTION_TYPES.TRANSFER, TRANSACTION_TYPES.INVESTMENT, TRANSACTION_TYPES.EMERGENCY_FUND];
  cases.forEach(([type, source, amount, probe, expected]) => {
    const txn = makeTransaction({ transaction_type: type, amount, account_id: source, destination_account_id: transferLike.includes(type) ? dest : null });
    assert.equal(accountDelta(txn, probe), expected, `${type} on ${probe}`);
  });
});

test('transfers are neither income nor expense and never change net worth', () => {
  const before = netWorth(db).net;
  const transfer = makeTransaction({
    transaction_type: TRANSACTION_TYPES.TRANSFER,
    amount: 500_000,
    account_id: db.accounts[0].id,
    destination_account_id: db.accounts[4].id,
    date: todayISO(),
  });
  assert.equal(isIncome(transfer), false);
  assert.equal(isExpense(transfer), false);

  const withTransfer = { ...db, transactions: [...db.transactions, transfer] };
  assert.equal(netWorth(withTransfer).net, before, 'net worth must be identical after a transfer');

  const balancesBefore = balanceMap(db);
  const balancesAfter = balanceMap(withTransfer);
  assert.equal(balancesAfter.get(db.accounts[0].id), balancesBefore.get(db.accounts[0].id) - 500_000);
  assert.equal(balancesAfter.get(db.accounts[4].id), balancesBefore.get(db.accounts[4].id) + 500_000);
});

test('net worth change equals income minus expense across the whole ledger', () => {
  const totals = periodTotals(db, '1970-01-01', '2999-12-31');
  const now = netWorth(db).net;
  const expected = openingTotal + totals.income - totals.expense;
  assert.ok(Math.abs(now - expected) < 1, `net worth ${now} should equal ${expected}`);
});

test('new debt and new receivable are balance-sheet neutral', () => {
  const clean = {
    ...db, transactions: [], debts: [], debtPayments: [], receivables: [], receivablePayments: [],
  };
  const baseline = netWorth(clean).net;
  const accountId = clean.accounts[0].id;

  const debtTxn = makeTransaction({
    transaction_type: TRANSACTION_TYPES.DEBT, amount: 1_000_000, account_id: accountId, date: todayISO(),
  });
  const debt = { id: 'd1', counterparty: 'Test', principal: 1_000_000, start_date: todayISO(), account_id: accountId, due_date: null, notes: '' };
  const recTxn = makeTransaction({
    transaction_type: TRANSACTION_TYPES.RECEIVABLE, amount: 1_000_000, account_id: accountId, date: todayISO(),
  });
  const rec = { id: 'r1', counterparty: 'Test', principal: 1_000_000, start_date: todayISO(), account_id: accountId, due_date: null, notes: '' };

  const withDebt = { ...clean, transactions: [debtTxn], debts: [debt] };
  const withRec = { ...clean, transactions: [recTxn], receivables: [rec] };
  assert.equal(netWorth(withDebt).net, baseline, 'taking a loan must not change net worth');
  assert.equal(netWorth(withRec).net, baseline, 'lending money must not change net worth');

  // repaying and receiving must also be neutral
  const repayTxn = makeTransaction({ transaction_type: TRANSACTION_TYPES.DEBT_PAYMENT, amount: 400_000, account_id: accountId, date: todayISO() });
  const withRepay = {
    ...withDebt,
    transactions: [debtTxn, repayTxn],
    debtPayments: [{ id: 'p', debt_id: 'd1', amount: 400_000, date: todayISO() }],
  };
  assert.equal(netWorth(withRepay).net, baseline, 'repaying a loan must not change net worth');
  assert.equal(debtState(debt, withRepay.debtPayments).remaining, 600_000);
});

/* ------------------------------------------------------------------ */
/* Balances & statements                                               */
/* ------------------------------------------------------------------ */

test('balanceMap equals opening balance + sum of signed deltas', () => {
  const map = balanceMap(db);
  dataset.accounts.forEach((account) => {
    const expected = account.opening_balance + dataset.transactions
      .reduce((acc, t) => acc + accountDelta(t, account.id), 0);
    assert.equal(map.get(account.id), expected, `${account.name} balance`);
  });
  assert.equal(totalBalance(db), [...map.values()].reduce((a, b) => a + b, 0));
});

test('statement satisfies opening + credits − debits = closing', () => {
  const from = `${monthKey()}-01`;
  const to = addDays(todayISO(), 1);
  const statement = buildStatement(db, { from, to });
  assert.equal(
    statement.closing,
    statement.opening + statement.totalIn - statement.totalOut,
    'running balance must reconcile',
  );
  // running balance column must be internally consistent too
  let running = statement.opening;
  statement.rows.forEach((row) => {
    running += row.credit - row.debit;
    assert.equal(row.balance, running);
  });
  assert.equal(statement.closing, running);
});

test('per-account statement closing matches accountBalanceAt', () => {
  const from = `${monthKey()}-01`;
  const to = addDays(todayISO(), 1);
  dataset.accounts.forEach((account) => {
    const statement = buildStatement(db, { accountId: account.id, from, to });
    assert.equal(statement.closing, accountBalanceAt(db, account.id, to), `${account.name}`);
  });
});

test('category breakdown reconciles with period totals', () => {
  const from = '1970-01-01';
  const to = '2999-12-31';
  const breakdown = categoryBreakdown(db, { from, to, kind: 'expense' });
  const breakdownTotal = breakdown.reduce((acc, row) => acc + row.total, 0);
  const expenseTotal = periodTotals(db, from, to).expense;
  assert.ok(Math.abs(breakdownTotal - expenseTotal) < 1, `${breakdownTotal} ≈ ${expenseTotal}`);

  const uncategorized = breakdown.find((row) => row.category.id === 'uncategorized');
  assert.ok(!uncategorized || uncategorized.total > 0);
});

/* ------------------------------------------------------------------ */
/* Debt & receivables                                                  */
/* ------------------------------------------------------------------ */

test('debt/пayment state derives paid, remaining, progress and status', () => {
  const debt = { id: 'dx', counterparty: 'Andi', principal: 5_000_000, account_id: 'a', start_date: addDays(todayISO(), -30), due_date: addDays(todayISO(), 5) };
  const payments = [
    { id: 'p1', debt_id: 'dx', amount: 1_000_000, date: addDays(todayISO(), -10) },
    { id: 'p2', debt_id: 'dx', amount: 1_000_000, date: addDays(todayISO(), -2) },
  ];
  const info = debtState(debt, payments);
  assert.equal(info.paid, 2_000_000);
  assert.equal(info.remaining, 3_000_000);
  assert.equal(Math.round(info.progress), 40);
  assert.equal(info.status, 'partially_paid');
  assert.equal(info.isDueSoon, true);

  const overdue = debtState({ ...debt, due_date: addDays(todayISO(), -3) }, payments);
  assert.equal(overdue.status, 'overdue');

  const settled = debtState(debt, [...payments, { id: 'p3', debt_id: 'dx', amount: 3_000_000, date: todayISO() }]);
  assert.equal(settled.status, 'paid');
  assert.equal(settled.remaining, 0);
  assert.equal(settled.progress, 100);
});

test('bunga hutang dihitung otomatis dari pokok, total pelunasan, dan cicilan', () => {
  // kasus nyata pengguna: pinjam 8 jt, harus dilunasi 13 jt, cicilan 1.153.334
  const t = debtInterest({ principal: 8_000_000, total_repayment: 13_000_000, monthly_installment: 1_153_334 });
  assert.equal(t.interest, 5_000_000);
  assert.equal(t.interestPct, 62.5);
  assert.equal(t.obligation, 13_000_000);
  assert.equal(t.tenorMonths, 12);          // 13.000.000 / 1.153.334 = 11,27 → 12 angsuran
  assert.equal(Math.round(t.tenor), 11);
  assert.equal(t.flatMonthly.toFixed(2), '5.54');   // 62,5 % / 11,27 bulan
  assert.equal(t.flatAnnual.toFixed(1), '66.5');
  assert.ok(t.effectiveMonthly > t.flatMonthly, 'bunga efektif selalu lebih tinggi dari flat');
  assert.equal(t.effectiveMonthly.toFixed(2), '8.90');

  // tanpa bunga: kewajiban = pokok
  const plain = debtInterest({ principal: 2_000_000 });
  assert.equal(plain.hasInterest, false);
  assert.equal(plain.obligation, 2_000_000);
  assert.equal(plain.interestPct, 0);

  // cicilan belum diisi → tenor diperkirakan dari tanggal hutang & jatuh tempo
  const byDate = debtInterest({
    principal: 8_000_000, total_repayment: 13_000_000,
    start_date: addDays(todayISO(), -300), due_date: todayISO(),
  });
  assert.equal(byDate.tenorSource, 'dates');
  assert.ok(byDate.tenorMonths >= 9 && byDate.tenorMonths <= 11, `tenor ${byDate.tenorMonths}`);
  assert.ok(byDate.installment > 0);
});

test('sisa & progress hutang mengikuti total pelunasan, bukan hanya pokok', () => {
  const debt = {
    id: 'd-int', counterparty: 'Koperasi', principal: 8_000_000, total_repayment: 13_000_000,
    monthly_installment: 1_153_334, start_date: addDays(todayISO(), -60), due_date: addDays(todayISO(), 300),
  };
  const unpaid = debtState(debt, []);
  assert.equal(unpaid.obligation, 13_000_000);
  assert.equal(unpaid.remaining, 13_000_000);
  assert.equal(unpaid.monthsLeft, 12);

  const half = debtState(debt, [{ id: 'p', debt_id: 'd-int', amount: 6_500_000, date: todayISO() }]);
  assert.equal(half.remaining, 6_500_000);
  assert.equal(Math.round(half.progress), 50);
  assert.equal(half.monthsLeft, 6);

  const paid = debtState(debt, [{ id: 'p2', debt_id: 'd-int', amount: 13_000_000, date: todayISO() }]);
  assert.equal(paid.remaining, 0);
  assert.equal(paid.status, 'paid');
});

test('receivable state mirrors debt semantics', () => {
  const rec = { id: 'rx', counterparty: 'Budi', principal: 3_000_000, start_date: addDays(todayISO(), -20), due_date: addDays(todayISO(), 2), reminder_days: 3 };
  const info = receivableState(rec, [{ id: 'q1', receivable_id: 'rx', amount: 1_000_000, date: todayISO() }]);
  assert.equal(info.received, 1_000_000);
  assert.equal(info.remaining, 2_000_000);
  assert.equal(info.status, 'partially_received');
  assert.equal(info.isDueSoon, true);
});

test('demo dataset contains the promised entities', () => {
  assert.equal(dataset.accounts.length, 10);
  assert.ok(dataset.transactions.length > 100, `expected a rich ledger, got ${dataset.transactions.length}`);
  assert.equal(dataset.debts.length, 2);
  assert.equal(dataset.receivables.length, 2);
  assert.equal(dataset.budgets.length, 6);
  const derived = dataset.debts.map((d) => debtState(d, dataset.debtPayments));
  assert.ok(derived.some((info) => info.isOverdue), 'one demo debt should be overdue once derived');
  assert.ok(derived.some((info) => info.status === 'partially_paid'), 'one demo debt should be partially paid');
  assert.ok(dataset.categories.every((c) => c.user_id === 'test-user'));
});

test('budget usage detects over/warn levels', () => {
  const usage = budgetUsage(db, monthKey());
  usage.forEach((row) => {
    if (row.usage >= 100) assert.equal(row.level, 'over');
    else if (row.usage >= 80) assert.equal(row.level, 'warn');
    else assert.equal(row.level, 'ok');
    assert.ok(row.spent >= 0 && row.amount > 0);
  });
});

test('insights are data-driven and return nothing without history', () => {
  const empty = {
    profile: { id: 'u' }, accounts: [], transactions: [], categories: [], debts: [], debtPayments: [],
    receivables: [], receivablePayments: [], budgets: [], notifications: [], settings: {},
  };
  assert.equal(insights(empty).length, 0, 'no data → no insights');
  assert.ok(insights(db).length >= 3, 'rich data → insights');
  insights(db).forEach((row) => {
    assert.ok(row.title && row.text && typeof row.title === 'string');
    assert.ok(!/Rp NaN|undefined/.test(row.title + row.text), 'insights must not leak NaN/undefined');
  });
});

test('monthly series computes ending balance and net worth monotonically per month', () => {
  const rows = monthlySeries(db, '2020-01-01', '2999-12-31');
  assert.ok(rows.length > 0);
  rows.forEach((row) => {
    assert.equal(row.net, row.income - row.expense);
    assert.equal(typeof row.endingBalance, 'number');
    assert.ok(Number.isFinite(row.netWorth));
  });
});

/* ------------------------------------------------------------------ */
/* Formatting & integrity guards                                       */
/* ------------------------------------------------------------------ */

test('IDR currency formatting and parsing round-trip', () => {
  assert.equal(money(1_250_000).replace(/\u00a0/g, ' '), 'Rp 1.250.000');
  assert.equal(money(0).replace(/\u00a0/g, ' '), 'Rp 0');
  assert.equal(formatAmountTyping(1250000), '1.250.000');
  assert.equal(parseMoneyInput('1.250.000'), 1_250_000);
  assert.equal(parseMoneyInput('Rp 1.250.000'), 1_250_000);
  assert.equal(parseMoneyInput('2jt'), 2_000_000);
  assert.equal(parseMoneyInput('150rb'), 150_000);
  assert.equal(parseMoneyInput(''), 0);
});

test('account numbers are masked by default', () => {
  assert.equal(maskAccountNumber('8820114778'), '•••• 4778');
  assert.equal(maskAccountNumber(''), '');
});

test('transaction fingerprints detect duplicates but keep distinct entries apart', () => {
  const base = { transaction_type: 'expense', date: '2026-09-30', time: '10:00', amount: 50_000, account_id: 'a', description: 'Kopi' };
  const copy = { ...base };
  const differentAmount = { ...base, amount: 50_001 };
  const differentDay = { ...base, date: '2026-10-01' };
  assert.equal(transactionFingerprint(base), transactionFingerprint(copy));
  assert.notEqual(transactionFingerprint(base), transactionFingerprint(differentAmount));
  assert.notEqual(transactionFingerprint(base), transactionFingerprint(differentDay));
});

test('default categories always ship subcategories wired to parents', () => {
  const categories = buildDefaultCategories('u1');
  const parents = categories.filter((c) => !c.parent_id);
  const children = categories.filter((c) => c.parent_id);
  assert.ok(parents.length === 23, `expected 16 expense + 7 income parents, got ${parents.length}`);
  assert.ok(children.length > 10);
  children.forEach((child) => {
    assert.ok(parents.some((p) => p.id === child.parent_id), 'subcategory parent exists');
    assert.ok(child.kind === 'expense', 'subcategories currently belong to expense categories');
  });
  assert.ok(new Set(categories.map((c) => c.id)).size === categories.length, 'category ids unique');
});

test('decimal amounts stay integral (no floating point drift)', () => {
  const amounts = dataset.transactions.map((t) => t.amount);
  assert.ok(amounts.every((a) => Number.isInteger(a)), 'every stored amount is an integer minor unit');
  const sum = amounts.reduce((a, b) => a + b, 0);
  assert.ok(Number.isInteger(sum));
  void toISO;
});
