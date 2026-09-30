/**
 * API integration tests — boots the real server (in-memory store) and drives it
 * over HTTP. Covers auth, the full transaction type matrix, accounting
 * integrity, validation guards, user isolation and sync idempotency.
 *
 *   node --test tests/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 8791;
const BASE = `http://127.0.0.1:${PORT}`;

let child;
let tokenA;
let tokenB;

const api = async (method, url, body, token) => {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, body: json };
};

test.before(async () => {
  child = spawn(process.execPath, ['server/server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DATABASE_URL: '', JWT_SECRET: 'test-secret' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write(`[api:err] ${d}`));
  // wait for the port
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) break;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('API server did not start');
    await new Promise((r) => setTimeout(r, 150));
  }
});

test.after(() => { child?.kill('SIGTERM'); });

test('health endpoint reports the store in use', async () => {
  const { status, body } = await api('GET', '/health');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.store, 'memory');
});

test('register rejects weak password and bad email', async () => {
  const weak = await api('POST', '/auth/register', { email: 'a@b.co', password: 'short' });
  assert.equal(weak.status, 400);
  assert.match(weak.body.error, /minimal 8 karakter/i);
  const bad = await api('POST', '/auth/register', { email: 'nope', password: 'longenough1' });
  assert.equal(bad.status, 400);
});

test('register → login → /me works and duplicates are refused', async () => {
  const reg = await api('POST', '/auth/register', { email: 'budi@example.com', password: 'rahasia123', display_name: 'Budi' });
  assert.equal(reg.status, 201);
  assert.ok(reg.body.token);
  tokenA = reg.body.token;

  const dupe = await api('POST', '/auth/register', { email: 'budi@example.com', password: 'rahasia123' });
  assert.equal(dupe.status, 409);

  const badLogin = await api('POST', '/auth/login', { email: 'budi@example.com', password: 'salahbanget' });
  assert.equal(badLogin.status, 401);
  assert.match(badLogin.body.error, /salah/i);

  const login = await api('POST', '/auth/login', { email: 'budi@example.com', password: 'rahasia123' });
  assert.equal(login.status, 200);

  const me = await api('GET', '/me', undefined, tokenA);
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, 'budi@example.com');

  const noToken = await api('GET', '/accounts');
  assert.equal(noToken.status, 401);
});

test('account numbers are masked unless explicitly revealed', async () => {
  const bca = await api('POST', '/accounts', {
    name: 'BCA', account_type: 'bank', institution: 'BCA',
    account_number: '1234567890', opening_balance: 10_000_000,
  }, tokenA);
  assert.equal(bca.status, 201);

  const masked = await api('GET', '/accounts', undefined, tokenA);
  const row = masked.body.accounts.find((a) => a.name === 'BCA');
  assert.equal(row.account_number, '•••• 7890');
  assert.equal(row.balance, 10_000_000);

  const revealed = await api('GET', '/accounts?reveal=1', undefined, tokenA);
  assert.equal(revealed.body.accounts.find((a) => a.name === 'BCA').account_number, '1234567890');
});

test('income adds, expense subtracts, both keep the ledger consistent', async () => {
  await api('POST', '/transactions', {
    transaction_type: 'income', date: '2026-09-01', time: '08:00', amount: 5_000_000,
    account_id: (await api('GET', '/accounts', undefined, tokenA)).body.accounts[0].id,
    category_id: 'cat_salary', description: 'Gaji September',
  }, tokenA);
  const afterIncome = await api('GET', '/summary', undefined, tokenA);
  assert.equal(afterIncome.body.summary.total_balance, 15_000_000);
  assert.equal(afterIncome.body.summary.income, 5_000_000);
  assert.equal(afterIncome.body.summary.net_cash_flow, 5_000_000);

  await api('POST', '/transactions', {
    transaction_type: 'expense', date: '2026-09-02', amount: 1_500_000,
    account_id: 'acc_x', category_id: 'cat_food',
  }, tokenA).then(async (res) => {
    // unknown account must be rejected before any write
    assert.equal(res.status, 400);
    assert.ok(res.body.fields.account_id);
  });
});

test('transfer moves money without touching income, expense or net worth', async () => {
  const accounts = (await api('GET', '/accounts', undefined, tokenA)).body.accounts;
  const source = accounts[0];
  const dest = (await api('POST', '/accounts', {
    name: 'GoPay', account_type: 'ewallet', opening_balance: 0,
  }, tokenA)).body.account;

  const before = (await api('GET', '/summary', undefined, tokenA)).body.summary;
  const txn = await api('POST', '/transactions', {
    transaction_type: 'transfer', date: '2026-09-03', amount: 2_000_000,
    account_id: source.id, destination_account_id: dest.id, description: 'Top up GoPay',
  }, tokenA);
  assert.equal(txn.status, 201);

  const after = (await api('GET', '/summary', undefined, tokenA)).body.summary;
  assert.equal(after.income, before.income, 'transfer must not count as income');
  assert.equal(after.expense, before.expense, 'transfer must not count as expense');
  assert.equal(after.net_worth, before.net_worth, 'transfer must not change net worth');
  assert.equal(after.accounts.find((a) => a.id === dest.id).balance, 2_000_000);
  assert.equal(after.accounts.find((a) => a.id === source.id).balance, before.accounts.find((a) => a.id === source.id).balance - 2_000_000);
});

test('transfer requires a distinct destination account', async () => {
  const accounts = (await api('GET', '/accounts', undefined, tokenA)).body.accounts;
  const same = await api('POST', '/transactions', {
    transaction_type: 'transfer', date: '2026-09-04', amount: 100_000,
    account_id: accounts[0].id, destination_account_id: accounts[0].id,
  }, tokenA);
  assert.equal(same.status, 400);
  assert.match(same.body.error, /tidak boleh sama/i);

  const missing = await api('POST', '/transactions', {
    transaction_type: 'transfer', date: '2026-09-04', amount: 100_000, account_id: accounts[0].id,
  }, tokenA);
  assert.equal(missing.status, 400);
});

test('insufficient balance is blocked with a friendly message', async () => {
  const accounts = (await api('GET', '/accounts', undefined, tokenA)).body.accounts;
  const cash = accounts.find((a) => a.type === 'ewallet');
  const res = await api('POST', '/transactions', {
    transaction_type: 'expense', date: '2026-09-05', amount: 999_000_000,
    account_id: cash.id, category_id: 'cat_shopping',
  }, tokenA);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /tidak mencukupi/i);
  assert.match(res.body.error, /GoPay/);
});

test('debt booking and repayment follow the integrity rules', async () => {
  const accounts = (await api('GET', '/accounts', undefined, tokenA)).body.accounts;
  const account = accounts[0];
  const before = (await api('GET', '/summary', undefined, tokenA)).body.summary;

  const debt = await api('POST', '/debts', {
    counterparty: 'Andi', principal: 3_000_000, account_id: account.id,
    start_date: '2026-09-06', due_date: '2026-12-06',
  }, tokenA);
  assert.equal(debt.status, 201);

  const afterLoan = (await api('GET', '/summary', undefined, tokenA)).body.summary;
  assert.equal(afterLoan.total_balance, before.total_balance + 3_000_000, 'loan credits the account');
  assert.equal(afterLoan.total_debt_outstanding, before.total_debt_outstanding + 3_000_000, 'liability rises');
  assert.equal(afterLoan.net_worth, before.net_worth, 'borrowing does not create wealth');
  assert.equal(afterLoan.income, before.income, 'borrowing is not income');

  const overpay = await api('POST', `/debts/${debt.body.debt.id}/payments`, { amount: 9_000_000, date: '2026-09-10', account_id: account.id }, tokenA);
  assert.equal(overpay.status, 400);
  assert.match(overpay.body.error, /melebihi sisa/i);

  const pay = await api('POST', `/debts/${debt.body.debt.id}/payments`, { amount: 1_000_000, date: '2026-09-10', account_id: account.id }, tokenA);
  assert.equal(pay.status, 201);
  assert.equal(pay.body.transaction.transaction_type, 'debt_payment');
  assert.equal(pay.body.transaction.reference_id, debt.body.debt.id);

  const debts = (await api('GET', '/debts', undefined, tokenA)).body.debts;
  const row = debts.find((d) => d.id === debt.body.debt.id);
  assert.equal(row.remaining, 2_000_000);
  assert.equal(row.paid, 1_000_000);
  assert.equal(row.status, 'partially_paid');

  const afterPay = (await api('GET', '/summary', undefined, tokenA)).body.summary;
  assert.equal(afterPay.expense, afterLoan.expense, 'debt payment is not an expense');
  assert.equal(afterPay.net_worth, before.net_worth, 'repaying restores the pre-loan net worth');
});

test('receivable lends out, then coming back restores net worth', async () => {
  const accounts = (await api('GET', '/accounts', undefined, tokenA)).body.accounts;
  const account = accounts[0];
  const before = (await api('GET', '/summary', undefined, tokenA)).body.summary;

  const rec = await api('POST', '/receivables', {
    counterparty: 'Sari', principal: 500_000, account_id: account.id, start_date: '2026-09-07', due_date: '2026-10-07',
  }, tokenA);
  assert.equal(rec.status, 201);

  const afterLend = (await api('GET', '/summary', undefined, tokenA)).body.summary;
  assert.equal(afterLend.total_balance, before.total_balance - 500_000);
  assert.equal(afterLend.total_receivable_outstanding, before.total_receivable_outstanding + 500_000);
  assert.equal(afterLend.net_worth, before.net_worth, 'lending converts cash into a receivable, not a loss');
  assert.equal(afterLend.expense, before.expense, 'lending is not an expense');

  const got = await api('POST', `/receivables/${rec.body.receivable.id}/payments`, { amount: 500_000, date: '2026-09-20', account_id: account.id }, tokenA);
  assert.equal(got.status, 201);

  const final = (await api('GET', '/summary', undefined, tokenA)).body.summary;
  assert.equal(final.total_balance, before.total_balance, 'money returns to the account');
  assert.equal(final.net_worth, before.net_worth);
  assert.equal(final.income, before.income, 'receiving a repayment is not income');
  const row = (await api('GET', '/receivables', undefined, tokenA)).body.receivables.find((r) => r.id === rec.body.receivable.id);
  assert.equal(row.status, 'received');
  assert.equal(row.remaining, 0);
});

test('duplicate transactions are refused unless the payload differs', async () => {
  const accounts = (await api('GET', '/accounts', undefined, tokenA)).body.accounts;
  const payload = {
    transaction_type: 'expense', date: '2026-09-08', time: '12:30', amount: 250_000,
    account_id: accounts[0].id, category_id: 'cat_food', description: 'Makan siang',
  };
  const first = await api('POST', '/transactions', payload, tokenA);
  assert.equal(first.status, 201);
  const second = await api('POST', '/transactions', payload, tokenA);
  assert.equal(second.status, 409);
  assert.match(second.body.error, /sudah tercatat/i);
  const third = await api('POST', '/transactions', { ...payload, description: 'Makan malam' }, tokenA);
  assert.equal(third.status, 201);
});

test('budgets compute usage and warn above 80%', async () => {
  const accounts = (await api('GET', '/accounts', undefined, tokenA)).body.accounts;
  const created = await api('POST', '/budgets', { category_id: 'cat_food', period: '2026-09', amount: 300_000 }, tokenA);
  assert.equal(created.status, 201);

  await api('POST', '/transactions', {
    transaction_type: 'expense', date: '2026-09-15', amount: 260_000, account_id: accounts[0].id, category_id: 'cat_food',
  }, tokenA);

  const budgets = (await api('GET', '/budgets?period=2026-09', undefined, tokenA)).body.budgets;
  const food = budgets.find((b) => b.category_id === 'cat_food');
  assert.equal(food.spent, 760_000);          // 250k + 250k (duplicate test) + 260k above
  assert.equal(food.level, 'over');
  assert.equal(food.usage > 100, true);
});

test('user isolation: another user sees none of this data', async () => {
  const reg = await api('POST', '/auth/register', { email: 'siti@example.com', password: 'rahasia456' });
  tokenB = reg.body.token;

  assert.equal((await api('GET', '/accounts', undefined, tokenB)).body.accounts.length, 0);
  assert.equal((await api('GET', '/transactions', undefined, tokenB)).body.transactions.length, 0);
  assert.equal((await api('GET', '/debts', undefined, tokenB)).body.debts.length, 0);
  const other = (await api('GET', '/summary', undefined, tokenB)).body.summary;
  assert.equal(other.total_balance, 0);
  assert.equal(other.net_worth, 0);

  // and cannot delete someone else's transaction
  const mine = (await api('GET', '/transactions?limit=1', undefined, tokenA)).body.transactions[0];
  const del = await api('DELETE', `/transactions/${mine.id}`, undefined, tokenB);
  assert.equal(del.status, 404);
});

test('bulk upload reports per-row failures instead of failing the batch', async () => {
  const accounts = (await api('GET', '/accounts', undefined, tokenA)).body.accounts;
  const res = await api('POST', '/transactions/bulk', {
    transactions: [
      { transaction_type: 'expense', date: '2026-09-21', amount: 50_000, account_id: accounts[0].id, category_id: 'cat_food', description: 'Kopi pagi' },
      { transaction_type: 'expense', date: '2026-09-21', amount: -10, account_id: accounts[0].id, category_id: 'cat_food' },
      { transaction_type: 'nonsense', date: '2026-09-21', amount: 1_000, account_id: accounts[0].id },
    ],
  }, tokenA);
  assert.equal(res.status, 207);
  assert.equal(res.body.created.length, 1);
  assert.equal(res.body.failed.length, 2);
});

test('sync is idempotent — replaying the same client ids changes nothing', async () => {
  const accounts = (await api('GET', '/accounts', undefined, tokenA)).body.accounts;
  const operations = [{
    id: 'op-123', store: 'transactions', action: 'create',
    payload: {
      transaction_type: 'expense', date: '2026-09-22', time: '19:00', amount: 75_000,
      account_id: accounts[0].id, category_id: 'cat_transport', description: 'Ojek online',
    },
  }];
  const first = await api('POST', '/sync', { operations }, tokenA);
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.applied, ['op-123']);

  const countBefore = (await api('GET', '/transactions?limit=1000', undefined, tokenA)).body.count;
  const replay = await api('POST', '/sync', { operations }, tokenA);
  assert.equal(replay.status, 200);
  const countAfter = (await api('GET', '/transactions?limit=1000', undefined, tokenA)).body.count;
  assert.equal(countAfter, countBefore, 'replayed operation must not duplicate the entry');
});

test('unknown endpoints and malformed bodies return clean JSON errors', async () => {
  const missing = await api('GET', '/does-not-exist', undefined, tokenA);
  assert.equal(missing.status, 404);
  assert.ok(missing.body.error);

  const res = await fetch(`${BASE}/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: '{not json',
  });
  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.match(payload.error, /JSON/i);
});
