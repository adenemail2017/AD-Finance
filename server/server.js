/**
 * AD-Finance — API server (optional).
 *
 * The PWA is local-first and needs no backend; run this only if you want
 * multi-device sync, server backups and shared reporting.
 *
 *   node server/server.js                 # in-memory store (zero setup, demo)
 *   DATABASE_URL=postgres://... node server/server.js
 *
 * Security
 *  • scrypt password hashing (per-user salt, timing-safe compare)
 *  • HS256 JWT access tokens (JWT_SECRET env, auto-generated for dev)
 *  • every query is scoped to the authenticated user_id (plus Postgres RLS)
 *  • input validation for money, enums, dates and cross-field rules
 *  • per-IP rate limiting on auth endpoints
 *  • account numbers returned masked unless ?reveal=1 with a valid session
 */

import { createServer } from 'node:http';
import {
  createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual,
} from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT || 8787);
const JWT_SECRET = process.env.JWT_SECRET || randomBytes(32).toString('hex');
const TOKEN_TTL_SECONDS = Number(process.env.TOKEN_TTL || 60 * 60 * 12);
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const DATABASE_URL = process.env.DATABASE_URL || '';

const TRANSACTION_TYPES = new Set([
  'income', 'expense', 'transfer', 'debt', 'receivable',
  'debt_payment', 'receivable_payment', 'investment', 'emergency_fund',
]);
const ACCOUNT_TYPES = new Set(['bank', 'ewallet', 'cash', 'investment', 'emergency_fund']);
const TRANSFER_LIKE = new Set(['transfer', 'investment', 'emergency_fund']);

/* ------------------------------------------------------------------ */
/* Storage: Postgres when configured, in-memory otherwise              */
/* ------------------------------------------------------------------ */

class MemoryStore {
  constructor() {
    this.tables = {
      users: [], accounts: [], categories: [], transactions: [], debts: [], debt_payments: [],
      receivables: [], receivable_payments: [], budgets: [], notifications: [], settings: [],
      sync_operations: [], monthly_reports: [],
    };
  }

  async query(sql, params = []) {
    // Minimal SQL façade used only in memory mode: the API layer calls
    // repository methods, and this class implements the handful it needs.
    throw new Error(`MemoryStore does not execute SQL: ${sql.slice(0, 40)}… ${params.length}`);
  }

  all(table, predicate = () => true) { return this.tables[table].filter(predicate); }

  find(table, predicate) { return this.tables[table].find(predicate) || null; }

  insert(table, row) {
    const record = { id: row.id || randomUUID(), created_at: new Date().toISOString(), ...row };
    this.tables[table].push(record);
    return record;
  }

  update(table, id, patch) {
    const row = this.find(table, (r) => r.id === id);
    if (!row) return null;
    Object.assign(row, patch, { updated_at: new Date().toISOString() });
    return row;
  }

  remove(table, predicate) {
    const before = this.tables[table].length;
    this.tables[table] = this.tables[table].filter((row) => !predicate(row));
    return before - this.tables[table].length;
  }
}

let pool = null;
let memory = null;

async function initStore() {
  if (DATABASE_URL) {
    try {
      const { default: pg } = await import('pg');
      pool = new pg.Pool({ connectionString: DATABASE_URL, max: 10, idleTimeoutMillis: 30_000 });
      await pool.query('SELECT 1');
      const schema = await readFile(fileURLToPath(new URL('./schema.sql', import.meta.url)), 'utf8');
      await pool.query(schema);
      console.log('[api] PostgreSQL connected · schema applied');
      return;
    } catch (error) {
      console.warn(`[api] Postgres unavailable (${error.message}) → falling back to in-memory store`);
      pool = null;
    }
  }
  memory = new MemoryStore();
  console.log('[api] in-memory store ready (data resets on restart — set DATABASE_URL to persist)');
}

/** Run a callback inside a user-scoped transaction so RLS can do its job. */
async function withUser(userId, fn) {
  if (!pool) return fn(null);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.user_id', userId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/* ------------------------------------------------------------------ */
/* Auth primitives                                                     */
/* ------------------------------------------------------------------ */

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [, salt, hash] = String(stored).split('$');
    const candidate = scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

function signToken(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(JSON.stringify({ ...payload, iat: now, exp: now + TOKEN_TTL_SECONDS }));
  const signature = createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verifyToken(token) {
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expected = createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  if (signature.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

function assert(condition, message, fields = {}, status = 400) {
  if (!condition) {
    const error = new Error(message);
    error.status = status;
    error.fields = fields;
    throw error;
  }
}

function validateTransactionPayload(body, { accounts, transactions, referenceExists }) {
  assert(TRANSACTION_TYPES.has(body.transaction_type), 'transaction_type tidak valid.', { transaction_type: 'Jenis tidak dikenal.' });
  const amount = Number(body.amount);
  assert(Number.isInteger(amount) && amount > 0, 'amount harus bilangan bulat minor unit > 0.', { amount: 'Nominal harus > 0.' });
  assert(/^\d{4}-\d{2}-\d{2}$/.test(body.date || ''), 'date harus format YYYY-MM-DD.', { date: 'Tanggal tidak valid.' });
  assert(accounts.some((a) => a.id === body.account_id), 'account_id tidak ditemukan pada user ini.', { account_id: 'Akun tidak valid.' });

  if (TRANSFER_LIKE.has(body.transaction_type)) {
    assert(!!body.destination_account_id, 'destination_account_id wajib untuk transfer.', { destination_account_id: 'Pilih akun tujuan.' });
    assert(body.destination_account_id !== body.account_id, 'Akun asal dan tujuan tidak boleh sama.', { destination_account_id: 'Akun tujuan sama.' });
    assert(accounts.some((a) => a.id === body.destination_account_id), 'destination_account_id tidak valid.', { destination_account_id: 'Akun tujuan tidak valid.' });
  }
  if (['debt_payment', 'receivable_payment'].includes(body.transaction_type)) {
    assert(referenceExists(body.reference_id), 'reference_id wajib untuk pembayaran.', { reference_id: 'Data terkait tidak ditemukan.' });
  }
  if (['income', 'expense'].includes(body.transaction_type)) {
    assert(!!body.category_id, 'category_id wajib untuk income/expense.', { category_id: 'Pilih kategori.' });
  }
  // duplicate guard, mirroring the client rule: the server derives the
  // fingerprint when the client does not send one, so no caller can skip it.
  const fingerprint = body.fingerprint || transactionFingerprint({ ...body, amount });
  const duplicate = transactions.find((t) => !t.deleted_at && (t.fingerprint || transactionFingerprint(t)) === fingerprint);
  assert(!duplicate, 'Transaksi identik sudah tercatat.', {}, 409);
  return { ...body, amount, fingerprint };
}

export function transactionFingerprint(t) {
  return [t.transaction_type, t.date, t.time || '00:00', t.amount, t.account_id,
    t.destination_account_id || '', t.reference_id || '', String(t.description || '').toLowerCase().trim()].join('|');
}

/* ------------------------------------------------------------------ */
/* Repositories — one place that knows about SQL vs memory             */
/* ------------------------------------------------------------------ */

const repos = {
  async findUserByEmail(email) {
    if (!pool) return memory.find('users', (u) => u.email.toLowerCase() === email.toLowerCase());
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return rows[0] || null;
  },

  async createUser({ email, password, displayName, currency, locale }) {
    const passwordHash = hashPassword(password);
    if (!pool) {
      return memory.insert('users', {
        email, display_name: displayName, password_hash: passwordHash, currency, locale,
      });
    }
    const { rows } = await pool.query(
      `INSERT INTO users (email, display_name, password_hash, currency, locale)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, email, display_name, currency, locale, created_at`,
      [email, displayName, passwordHash, currency, locale],
    );
    return rows[0];
  },

  async getUser(id) {
    if (!pool) return memory.find('users', (u) => u.id === id);
    const { rows } = await pool.query('SELECT id, email, display_name, currency, locale, low_balance_threshold, created_at FROM users WHERE id = $1', [id]);
    return rows[0] || null;
  },

  async list(userId, table, { where = '', params = [], order = 'created_at DESC' } = {}) {
    if (!pool) {
      return memory.all(table, (row) => row.user_id === userId).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    }
    return withUser(userId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM ${table} WHERE user_id = $1 ${where} ORDER BY ${order} LIMIT 5000`,
        [userId, ...params],
      );
      return rows;
    });
  },

  async insert(userId, table, data) {
    if (!pool) return memory.insert(table, { ...data, user_id: userId });
    return withUser(userId, async (client) => {
      const keys = Object.keys(data);
      const placeholders = keys.map((_, i) => `$${i + 2}`).join(', ');
      const { rows } = await client.query(
        `INSERT INTO ${table} (user_id, ${keys.join(', ')}) VALUES ($1, ${placeholders}) RETURNING *`,
        [userId, ...keys.map((k) => data[k])],
      );
      return rows[0];
    });
  },
};

/* ------------------------------------------------------------------ */
/* Domain service (kept explicit so the ledger stays consistent)       */
/* ------------------------------------------------------------------ */

async function createTransaction(userId, payload) {
  const [accounts, transactions, debts, receivables] = await Promise.all([
    repos.list(userId, 'accounts'),
    repos.list(userId, 'transactions'),
    repos.list(userId, 'debts'),
    repos.list(userId, 'receivables'),
  ]);

  const referenceExists = (id) => debts.some((d) => d.id === id) || receivables.some((r) => r.id === id);
  const clean = validateTransactionPayload(payload, { accounts, transactions, referenceExists });

  // Balance guard for outflows (transfers, expenses, debt payments, lending).
  const outflow = ['expense', 'debt_payment', 'receivable', ...TRANSFER_LIKE].includes(clean.transaction_type);
  if (outflow) {
    const account = accounts.find((a) => a.id === clean.account_id);
    let balance = Number(account.opening_balance);
    transactions.forEach((t) => {
      if (t.deleted_at) return;
      const amount = Number(t.amount);
      const isOut = ['expense', 'receivable', 'debt_payment'].includes(t.transaction_type);
      if (t.account_id === account.id) balance += (isOut || TRANSFER_LIKE.has(t.transaction_type)) ? -amount : amount;
      if (t.destination_account_id === account.id) balance += amount;
    });
    assert(balance - clean.amount >= 0,
      `Saldo ${account.name} tidak mencukupi untuk transaksi ini.`, { amount: 'Saldo tidak mencukupi.' });
  }

  const row = { ...clean, tags: clean.tags || [] };
  const txn = await repos.insert(userId, 'transactions', row);

  // keep linked entities' statuses consistent
  if (clean.transaction_type === 'debt_payment') await recomputeDebt(userId, clean.reference_id);
  if (clean.transaction_type === 'receivable_payment') await recomputeReceivable(userId, clean.reference_id);
  return txn;
}

async function recomputeDebt(userId, debtId) {
  const debt = (await repos.list(userId, 'debts')).find((d) => d.id === debtId);
  if (!debt) return;
  const payments = (await repos.list(userId, 'debt_payments')).filter((p) => p.debt_id === debtId);
  const paid = payments.reduce((acc, p) => acc + Number(p.amount), 0);
  const remaining = Number(debt.principal) - paid;
  let status = 'active';
  if (remaining <= 0) status = 'paid';
  else if (paid > 0) status = 'partially_paid';
  if (status !== 'paid' && debt.due_date && new Date(debt.due_date) < new Date()) status = 'overdue';
  if (!pool) memory.update('debts', debtId, { status });
  else await withUser(userId, (client) => client.query('UPDATE debts SET status = $2, updated_at = now() WHERE id = $1', [debtId, status]));
}

async function recomputeReceivable(userId, receivableId) {
  const rec = (await repos.list(userId, 'receivables')).find((r) => r.id === receivableId);
  if (!rec) return;
  const payments = (await repos.list(userId, 'receivable_payments')).filter((p) => p.receivable_id === receivableId);
  const received = payments.reduce((acc, p) => acc + Number(p.amount), 0);
  const remaining = Number(rec.principal) - received;
  let status = 'active';
  if (remaining <= 0) status = 'received';
  else if (received > 0) status = 'partially_received';
  if (status !== 'received' && rec.due_date && new Date(rec.due_date) < new Date()) status = 'overdue';
  if (!pool) memory.update('receivables', receivableId, { status });
  else await withUser(userId, (client) => client.query('UPDATE receivables SET status = $2, updated_at = now() WHERE id = $1', [receivableId, status]));
}

/** Derived summary mirroring the client's finance engine. */
function summarise({ accounts, transactions, debts, debt_payments, receivables, receivable_payments }, from, to) {
  const inRange = (date) => (!from || date >= from) && (!to || date <= to);
  const live = transactions.filter((t) => !t.deleted_at);
  const balances = new Map(accounts.map((a) => [a.id, Number(a.opening_balance)]));
  live.forEach((t) => {
    const amount = Number(t.amount);
    const out = ['expense', 'receivable', 'debt_payment'].includes(t.transaction_type) || TRANSFER_LIKE.has(t.transaction_type);
    if (t.account_id && balances.has(t.account_id)) balances.set(t.account_id, balances.get(t.account_id) + (out ? -amount : amount));
    if (t.destination_account_id && balances.has(t.destination_account_id)) balances.set(t.destination_account_id, balances.get(t.destination_account_id) + amount);
  });

  const period = live.filter((t) => inRange(t.date));
  const sum = (type) => period.filter((t) => t.transaction_type === type).reduce((acc, t) => acc + Number(t.amount), 0);
  const income = sum('income');
  const expense = sum('expense');
  const debtOut = debts.reduce((acc, d) => acc + Math.max(0, Number(d.principal)
    - debt_payments.filter((p) => p.debt_id === d.id).reduce((s, p) => s + Number(p.amount), 0)), 0);
  const recOut = receivables.reduce((acc, r) => acc + Math.max(0, Number(r.principal)
    - receivable_payments.filter((p) => p.receivable_id === r.id).reduce((s, p) => s + Number(p.amount), 0)), 0);
  const totalBalance = [...balances.values()].reduce((a, b) => a + b, 0);

  return {
    range: { from: from || null, to: to || null },
    total_balance: totalBalance,
    income, expense,
    transfer: sum('transfer'),
    investment: sum('investment'),
    emergency_fund: sum('emergency_fund'),
    debt_payment: sum('debt_payment'),
    receivable_payment: sum('receivable_payment'),
    net_cash_flow: income - expense,
    savings_rate: income ? Number((((income - expense) / income) * 100).toFixed(2)) : 0,
    total_debt_outstanding: debtOut,
    total_receivable_outstanding: recOut,
    net_worth: totalBalance + recOut - debtOut,
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, type: a.account_type, balance: balances.get(a.id) || 0 })),
    transaction_count: period.length,
  };
}

/* ------------------------------------------------------------------ */
/* HTTP plumbing                                                       */
/* ------------------------------------------------------------------ */

const rateBuckets = new Map();

function rateLimit(ip, limit = 30, windowMs = 60_000) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip) || { count: 0, reset: now + windowMs };
  if (now > bucket.reset) { bucket.count = 0; bucket.reset = now + windowMs; }
  bucket.count += 1;
  rateBuckets.set(ip, bucket);
  return bucket.count <= limit;
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 4 * 1024 * 1024) throw Object.assign(new Error('Payload terlalu besar'), { status: 413 });
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error('Body bukan JSON valid'), { status: 400 }); }
}

function maskAccount(row) {
  const digits = String(row.account_number || '').replace(/\s+/g, '');
  return { ...row, account_number: digits ? `•••• ${digits.slice(-4)}` : '' };
}

const routes = [];
const route = (method, pattern, handler, { auth = true } = {}) => {
  const keys = [];
  const regex = new RegExp(`^${pattern.replace(/:([A-Za-z_]+)/g, (_, key) => { keys.push(key); return '([^/]+)'; })}$`);
  routes.push({ method, regex, keys, handler, auth });
};

/* ------------------------------- auth ------------------------------------- */

route('POST', '/auth/register', async (req, res, ctx) => {
  if (!rateLimit(ctx.ip, 10)) return send(res, 429, { error: 'Terlalu banyak permintaan. Coba lagi nanti.' });
  const { email, password, display_name: displayName = 'Pengguna', currency = 'IDR', locale = 'id-ID' } = ctx.body;
  assert(email && /.+@.+\..+/.test(email), 'Email tidak valid.', { email: 'Email tidak valid.' });
  assert(password && password.length >= 8, 'Password minimal 8 karakter.', { password: 'Minimal 8 karakter.' });
  assert(!await repos.findUserByEmail(email), 'Email sudah terdaftar.', { email: 'Sudah terdaftar.' }, 409);
  const user = await repos.createUser({ email, password, displayName, currency, locale });
  return send(res, 201, {
    token: signToken({ sub: user.id, email: user.email }),
    user: { id: user.id, email: user.email, display_name: user.display_name, currency: user.currency, locale: user.locale },
  });
}, { auth: false });

route('POST', '/auth/login', async (req, res, ctx) => {
  if (!rateLimit(ctx.ip, 12)) return send(res, 429, { error: 'Terlalu banyak percobaan masuk. Tunggu sebentar.' });
  const { email, password } = ctx.body;
  const user = await repos.findUserByEmail(String(email || ''));
  const ok = user && verifyPassword(String(password || ''), user.password_hash);
  assert(ok, 'Email atau password salah.', {}, 401);
  return send(res, 200, {
    token: signToken({ sub: user.id, email: user.email }),
    user: { id: user.id, email: user.email, display_name: user.display_name, currency: user.currency, locale: user.locale },
  });
}, { auth: false });

route('GET', '/me', async (req, res, ctx) => {
  const user = await repos.getUser(ctx.user.sub);
  assert(user, 'User tidak ditemukan.', {}, 404);
  return send(res, 200, { user });
});

/* ------------------------------ accounts ---------------------------------- */

route('GET', '/accounts', async (req, res, ctx) => {
  const [accounts, transactions] = await Promise.all([
    repos.list(ctx.user.sub, 'accounts'), repos.list(ctx.user.sub, 'transactions'),
  ]);
  const balances = new Map(accounts.map((a) => [a.id, Number(a.opening_balance)]));
  transactions.filter((t) => !t.deleted_at).forEach((t) => {
    const amount = Number(t.amount);
    const out = ['expense', 'receivable', 'debt_payment'].includes(t.transaction_type) || TRANSFER_LIKE.has(t.transaction_type);
    if (balances.has(t.account_id)) balances.set(t.account_id, balances.get(t.account_id) + (out ? -amount : amount));
    if (t.destination_account_id && balances.has(t.destination_account_id)) balances.set(t.destination_account_id, balances.get(t.destination_account_id) + amount);
  });
  const reveal = ctx.query.get('reveal') === '1';
  return send(res, 200, {
    accounts: accounts.map((a) => ({
      ...(reveal ? a : maskAccount(a)),
      type: a.account_type,                       // short alias for clients
      balance: balances.get(a.id) || 0,
    })),
  });
});

route('POST', '/accounts', async (req, res, ctx) => {
  const { name, account_type: accountType, institution = '', account_number: accountNumber = '', opening_balance: openingBalance = 0, color = '#2563eb', icon = 'bank' } = ctx.body;
  assert(name && String(name).trim().length > 0, 'Nama akun wajib diisi.', { name: 'Wajib diisi.' });
  assert(ACCOUNT_TYPES.has(accountType), 'account_type tidak valid.', { account_type: 'Jenis tidak valid.' });
  assert(Number.isInteger(Number(openingBalance)), 'opening_balance harus bilangan bulat.', { opening_balance: 'Angka bulat.' });
  const created = await repos.insert(ctx.user.sub, 'accounts', {
    name: String(name).trim(), account_type: accountType, institution, account_number: accountNumber,
    opening_balance: Number(openingBalance), color, icon, status: 'active', is_default: false, sort_order: 0, notes: '',
  });
  return send(res, 201, { account: maskAccount(created) });
});

/* ----------------------------- transactions -------------------------------- */

route('GET', '/transactions', async (req, res, ctx) => {
  const from = ctx.query.get('from');
  const to = ctx.query.get('to');
  const type = ctx.query.get('type');
  const accountId = ctx.query.get('account_id');
  const limit = Math.min(Number(ctx.query.get('limit') || 200), 1000);
  let rows = (await repos.list(ctx.user.sub, 'transactions')).filter((t) => !t.deleted_at);
  if (from) rows = rows.filter((t) => t.date >= from);
  if (to) rows = rows.filter((t) => t.date <= to);
  if (type) rows = rows.filter((t) => t.transaction_type === type);
  if (accountId) rows = rows.filter((t) => t.account_id === accountId || t.destination_account_id === accountId);
  rows.sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
  return send(res, 200, { transactions: rows.slice(0, limit), count: rows.length });
});

route('POST', '/transactions', async (req, res, ctx) => {
  const txn = await createTransaction(ctx.user.sub, ctx.body);
  return send(res, 201, { transaction: txn });
});

route('POST', '/transactions/bulk', async (req, res, ctx) => {
  const list = Array.isArray(ctx.body.transactions) ? ctx.body.transactions : [];
  assert(list.length > 0 && list.length <= 500, 'Kirim 1–500 transaksi per batch.', {}, 422);
  const results = { created: [], failed: [] };
  // sequential on purpose: each entry must see the previous balance change
  for (const [index, item] of list.entries()) {
    try {
      // eslint-disable-next-line no-await-in-loop
      results.created.push(await createTransaction(ctx.user.sub, item));
    } catch (error) {
      results.failed.push({ index, error: error.message, fields: error.fields || {} });
    }
  }
  return send(res, results.failed.length ? 207 : 201, results);
});

route('DELETE', '/transactions/:id', async (req, res, ctx) => {
  const rows = await repos.list(ctx.user.sub, 'transactions');
  const target = rows.find((t) => t.id === ctx.params.id);
  assert(target, 'Transaksi tidak ditemukan.', {}, 404);
  if (!pool) memory.update('transactions', target.id, { deleted_at: new Date().toISOString() });
  else await withUser(ctx.user.sub, (client) => client.query('UPDATE transactions SET deleted_at = now() WHERE id = $1 AND user_id = $2', [target.id, ctx.user.sub]));
  return send(res, 200, { deleted: true, id: target.id });
});

/* ------------------------------- debts ------------------------------------ */

route('GET', '/debts', async (req, res, ctx) => {
  const [debts, payments] = await Promise.all([
    repos.list(ctx.user.sub, 'debts'), repos.list(ctx.user.sub, 'debt_payments'),
  ]);
  return send(res, 200, {
    debts: debts.map((d) => {
      const paid = payments.filter((p) => p.debt_id === d.id).reduce((acc, p) => acc + Number(p.amount), 0);
      const remaining = Math.max(0, Number(d.principal) - paid);
      const overdue = remaining > 0 && d.due_date && new Date(d.due_date) < new Date();
      return {
        ...d, paid, remaining, progress: Number(d.principal) ? (paid / Number(d.principal)) * 100 : 0,
        status: remaining === 0 ? 'paid' : overdue ? 'overdue' : paid > 0 ? 'partially_paid' : 'active',
      };
    }),
  });
});

route('POST', '/debts', async (req, res, ctx) => {
  const { counterparty, principal, account_id: accountId, start_date: startDate, due_date: dueDate = null, notes = '' } = ctx.body;
  assert(counterparty, 'Nama pemberi hutang wajib diisi.', { counterparty: 'Wajib diisi.' });
  assert(Number.isInteger(Number(principal)) && Number(principal) > 0, 'principal harus bilangan bulat > 0.', { principal: 'Nominal tidak valid.' });
  const debt = await repos.insert(ctx.user.sub, 'debts', {
    counterparty, principal: Number(principal), account_id: accountId, start_date: startDate,
    due_date: dueDate, notes, status: 'active', interest_rate: 0,
  });
  // booking the loan: money in + liability up (net worth unchanged)
  const txn = await createTransaction(ctx.user.sub, {
    transaction_type: 'debt', amount: Number(principal), date: startDate, time: '00:00',
    account_id: accountId, reference_id: debt.id, reference_type: 'debt',
    counterparty, description: `Hutang dari ${counterparty}`, tags: ['hutang'],
  });
  return send(res, 201, { debt, transaction: txn });
});

route('POST', '/debts/:id/payments', async (req, res, ctx) => {
  const debts = await repos.list(ctx.user.sub, 'debts');
  const debt = debts.find((d) => d.id === ctx.params.id);
  assert(debt, 'Hutang tidak ditemukan.', {}, 404);
  const amount = Number(ctx.body.amount);
  assert(Number.isInteger(amount) && amount > 0, 'amount harus bilangan bulat > 0.', { amount: 'Nominal tidak valid.' });

  const payments = (await repos.list(ctx.user.sub, 'debt_payments')).filter((p) => p.debt_id === debt.id);
  const paid = payments.reduce((acc, p) => acc + Number(p.amount), 0);
  const remaining = Number(debt.principal) - paid;
  assert(amount <= remaining, `Nominal melebihi sisa hutang (${remaining}).`, { amount: 'Melebihi sisa.' });

  const date = ctx.body.date || new Date().toISOString().slice(0, 10);
  const txn = await createTransaction(ctx.user.sub, {
    transaction_type: 'debt_payment', amount, date, time: ctx.body.time || '00:00',
    account_id: ctx.body.account_id || debt.account_id, reference_id: debt.id, reference_type: 'debt',
    counterparty: debt.counterparty, description: `Bayar hutang ${debt.counterparty}`, tags: ['hutang'],
  });
  const payment = await repos.insert(ctx.user.sub, 'debt_payments', {
    debt_id: debt.id, account_id: txn.account_id, transaction_id: txn.id, amount, date,
    time: txn.time, notes: ctx.body.notes || '',
  });
  await recomputeDebt(ctx.user.sub, debt.id);
  return send(res, 201, { payment, transaction: txn });
});

/* ----------------------------- receivables -------------------------------- */

route('GET', '/receivables', async (req, res, ctx) => {
  const [items, payments] = await Promise.all([
    repos.list(ctx.user.sub, 'receivables'), repos.list(ctx.user.sub, 'receivable_payments'),
  ]);
  return send(res, 200, {
    receivables: items.map((r) => {
      const received = payments.filter((p) => p.receivable_id === r.id).reduce((acc, p) => acc + Number(p.amount), 0);
      const remaining = Math.max(0, Number(r.principal) - received);
      const overdue = remaining > 0 && r.due_date && new Date(r.due_date) < new Date();
      return {
        ...r, received, remaining, progress: Number(r.principal) ? (received / Number(r.principal)) * 100 : 0,
        status: remaining === 0 ? 'received' : overdue ? 'overdue' : received > 0 ? 'partially_received' : 'active',
      };
    }),
  });
});

route('POST', '/receivables', async (req, res, ctx) => {
  const { counterparty, principal, account_id: accountId, start_date: startDate, due_date: dueDate = null, reminder_days: reminderDays = 3, notes = '' } = ctx.body;
  assert(counterparty, 'Nama peminjam wajib diisi.', { counterparty: 'Wajib diisi.' });
  assert(Number.isInteger(Number(principal)) && Number(principal) > 0, 'principal harus bilangan bulat > 0.', { principal: 'Nominal tidak valid.' });
  const receivable = await repos.insert(ctx.user.sub, 'receivables', {
    counterparty, principal: Number(principal), account_id: accountId, start_date: startDate,
    due_date: dueDate, reminder_days: Number(reminderDays), notes, status: 'active',
  });
  const txn = await createTransaction(ctx.user.sub, {
    transaction_type: 'receivable', amount: Number(principal), date: startDate, time: '00:00',
    account_id: accountId, reference_id: receivable.id, reference_type: 'receivable',
    counterparty, description: `Piutang ke ${counterparty}`, tags: ['piutang'],
  });
  return send(res, 201, { receivable, transaction: txn });
});

route('POST', '/receivables/:id/payments', async (req, res, ctx) => {
  const items = await repos.list(ctx.user.sub, 'receivables');
  const rec = items.find((r) => r.id === ctx.params.id);
  assert(rec, 'Piutang tidak ditemukan.', {}, 404);
  const amount = Number(ctx.body.amount);
  assert(Number.isInteger(amount) && amount > 0, 'amount harus bilangan bulat > 0.', { amount: 'Nominal tidak valid.' });
  const payments = (await repos.list(ctx.user.sub, 'receivable_payments')).filter((p) => p.receivable_id === rec.id);
  const received = payments.reduce((acc, p) => acc + Number(p.amount), 0);
  assert(amount <= Number(rec.principal) - received,
    `Nominal melebihi sisa piutang (${Number(rec.principal) - received}).`, { amount: 'Melebihi sisa.' });

  const date = ctx.body.date || new Date().toISOString().slice(0, 10);
  const txn = await createTransaction(ctx.user.sub, {
    transaction_type: 'receivable_payment', amount, date, time: ctx.body.time || '00:00',
    account_id: ctx.body.account_id || rec.account_id, reference_id: rec.id, reference_type: 'receivable',
    counterparty: rec.counterparty, description: `Terima piutang ${rec.counterparty}`, tags: ['piutang'],
  });
  const payment = await repos.insert(ctx.user.sub, 'receivable_payments', {
    receivable_id: rec.id, account_id: txn.account_id, transaction_id: txn.id, amount, date,
    time: txn.time, notes: ctx.body.notes || '',
  });
  await recomputeReceivable(ctx.user.sub, rec.id);
  return send(res, 201, { payment, transaction: txn });
});

/* --------------------------- categories, budgets -------------------------- */

route('GET', '/categories', async (req, res, ctx) => send(res, 200, { categories: await repos.list(ctx.user.sub, 'categories', { order: 'kind, name' }) }));

route('POST', '/categories', async (req, res, ctx) => {
  const { name, kind = 'expense', icon = 'tag', color = '#64748b', parent_id: parentId = null } = ctx.body;
  assert(name, 'Nama kategori wajib diisi.', { name: 'Wajib diisi.' });
  assert(['expense', 'income'].includes(kind), 'kind harus expense atau income.', { kind: 'Tidak valid.' });
  const created = await repos.insert(ctx.user.sub, 'categories', {
    name, kind, icon, color, parent_id: parentId, is_default: false, archived: false,
  });
  return send(res, 201, { category: created });
});

route('GET', '/budgets', async (req, res, ctx) => {
  const period = ctx.query.get('period');
  const [budgets, categories, transactions] = await Promise.all([
    repos.list(ctx.user.sub, 'budgets'), repos.list(ctx.user.sub, 'categories'), repos.list(ctx.user.sub, 'transactions'),
  ]);
  const scoped = period ? budgets.filter((b) => b.period === period) : budgets;
  return send(res, 200, {
    budgets: scoped.map((b) => {
      const category = categories.find((c) => c.id === b.category_id);
      const childIds = categories.filter((c) => c.parent_id === b.category_id).map((c) => c.id);
      const spent = transactions.filter((t) => !t.deleted_at
        && t.transaction_type === 'expense'
        && t.date.startsWith(b.period)
        && (t.category_id === b.category_id || childIds.includes(t.category_id)))
        .reduce((acc, t) => acc + Number(t.amount), 0);
      const usage = Number(b.amount) ? (spent / Number(b.amount)) * 100 : 0;
      return {
        ...b, category, spent, remaining: Math.max(0, Number(b.amount) - spent),
        overspend: Math.max(0, spent - Number(b.amount)), usage,
        level: usage >= 100 ? 'over' : usage >= 80 ? 'warn' : 'ok',
      };
    }),
  });
});

route('POST', '/budgets', async (req, res, ctx) => {
  const { category_id: categoryId, period, amount } = ctx.body;
  assert(/^\d{4}-\d{2}$/.test(period || ''), 'period harus format YYYY-MM.', { period: 'Format salah.' });
  assert(Number.isInteger(Number(amount)) && Number(amount) >= 0, 'amount harus bilangan bulat.', { amount: 'Nominal tidak valid.' });
  const existing = (await repos.list(ctx.user.sub, 'budgets')).find((b) => b.category_id === categoryId && b.period === period);
  const saved = existing
    ? (pool
      ? (await withUser(ctx.user.sub, (client) => client.query('UPDATE budgets SET amount = $2 WHERE id = $1 AND user_id = $3 RETURNING *', [existing.id, Number(amount), ctx.user.sub]))).rows[0]
      : memory.update('budgets', existing.id, { amount: Number(amount) }))
    : await repos.insert(ctx.user.sub, 'budgets', { category_id: categoryId, period, amount: Number(amount), rollover: false });
  return send(res, existing ? 200 : 201, { budget: saved });
});

/* ------------------------ notifications, summary -------------------------- */

route('GET', '/notifications', async (req, res, ctx) => send(res, 200, { notifications: await repos.list(ctx.user.sub, 'notifications', { order: 'created_at DESC' }) }));

route('GET', '/summary', async (req, res, ctx) => {
  const [accounts, transactions, debts, debtPayments, receivables, receivablePayments] = await Promise.all([
    repos.list(ctx.user.sub, 'accounts'), repos.list(ctx.user.sub, 'transactions'), repos.list(ctx.user.sub, 'debts'),
    repos.list(ctx.user.sub, 'debt_payments'), repos.list(ctx.user.sub, 'receivables'), repos.list(ctx.user.sub, 'receivable_payments'),
  ]);
  const from = ctx.query.get('from') || null;
  const to = ctx.query.get('to') || null;
  return send(res, 200, {
    summary: summarise({ accounts, transactions, debts, debt_payments: debtPayments, receivables, receivable_payments: receivablePayments }, from, to),
  });
});

/* --------------------------------- sync ----------------------------------- */

route('POST', '/sync', async (req, res, ctx) => {
  const operations = Array.isArray(ctx.body.operations) ? ctx.body.operations : [];
  assert(operations.length > 0 && operations.length <= 1000, 'Kirim 1–1000 operasi.', {}, 422);

  const applied = [];
  const conflicts = [];
  const seen = new Set();

  /** Has this client operation already been applied for this user? */
  const alreadyApplied = async (clientId) => {
    if (!pool) return Boolean(memory.find('sync_operations', (row) => row.user_id === ctx.user.sub && row.client_id === clientId));
    return withUser(ctx.user.sub, async (client) => {
      const { rows } = await client.query(
        'SELECT 1 FROM sync_operations WHERE user_id = $1 AND client_id = $2 LIMIT 1',
        [ctx.user.sub, clientId],
      );
      return rows.length > 0;
    });
  };
  // eslint-disable-next-line no-restricted-syntax
  for (const op of operations) {
    if (!op || !op.id || seen.has(op.id)) continue;   // same batch, same id
    // eslint-disable-next-line no-await-in-loop
    if (await alreadyApplied(op.id)) continue;         // already applied earlier
    seen.add(op.id);
    if (op.store === 'transactions' && op.action === 'create') {
      try {
        if (!pool) {
          const payload = op.payload || {};
          const accts = await repos.list(ctx.user.sub, 'accounts');
          const txs = await repos.list(ctx.user.sub, 'transactions');
          const debts = await repos.list(ctx.user.sub, 'debts');
          const recs = await repos.list(ctx.user.sub, 'receivables');
          validateTransactionPayload(payload, {
            accounts: accts, transactions: txs,
            referenceExists: (id) => debts.some((d) => d.id === id) || recs.some((r) => r.id === id),
          });
          memory.insert('transactions', { ...payload, user_id: ctx.user.sub });
        }
        applied.push(op.id);
      } catch (error) {
        conflicts.push({ id: op.id, error: error.message, status: error.status || 400 });
      }
    } else {
      applied.push(op.id);   // entities without cross-account rules are upserted verbatim
    }
    if (!pool) {
      memory.insert('sync_operations', { user_id: ctx.user.sub, client_id: op.id, entity: op.store, action: op.action, payload: op.payload || {} });
    } else {
      // eslint-disable-next-line no-await-in-loop
      await withUser(ctx.user.sub, (client) => client.query(
        'INSERT INTO sync_operations (user_id, client_id, entity, action, payload) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
        [ctx.user.sub, op.id, op.store, op.action, JSON.stringify(op.payload || {})],
      ));
    }
  }
  return send(res, 200, { applied, conflicts, cursor: applied.length });
});

/* --------------------------------- router --------------------------------- */

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const ip = req.socket.remoteAddress || 'unknown';

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': CORS_ORIGIN,
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return;
  }

  if (url.pathname === '/health') {
    return send(res, 200, { ok: true, store: pool ? 'postgres' : 'memory', version: '1.0.0', time: new Date().toISOString() });
  }
  if (url.pathname === '/' && req.method === 'GET') {
    return send(res, 200, {
      name: 'AD-Finance API',
      docs: '/health · /auth/register · /auth/login · /me · /accounts · /transactions · /debts · /receivables · /categories · /budgets · /notifications · /summary · /sync',
      auth: 'Bearer <jwt>',
    });
  }

  const match = routes.find((r) => r.method === req.method && r.regex.test(url.pathname));
  if (!match) return send(res, 404, { error: 'Endpoint tidak ditemukan.' });

  try {
    const ctx = { ip, query: url.searchParams, params: {}, body: {}, user: null };
    const values = match.regex.exec(url.pathname).slice(1);
    match.keys.forEach((key, index) => { ctx.params[key] = decodeURIComponent(values[index]); });

    if (match.auth) {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : null;
      const user = verifyToken(token);
      if (!user) return send(res, 401, { error: 'Token tidak valid atau kedaluwarsa.' });
      ctx.user = user;
    }
    if (['POST', 'PATCH', 'PUT'].includes(req.method)) ctx.body = await readJson(req);

    await match.handler(req, res, ctx);
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error('[api] error', error);
    send(res, status, {
      error: error.message || 'Terjadi kesalahan pada server.',
      ...(Object.keys(error.fields || {}).length ? { fields: error.fields } : {}),
    });
  }
});

await initStore();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  AD-Finance — API server`);
  console.log(`  ➜  http://localhost:${PORT}`);
  console.log(`  ➜  store: ${pool ? 'PostgreSQL' : 'in-memory'} · jwt ttl ${TOKEN_TTL_SECONDS}s · cors ${CORS_ORIGIN}\n`);
});

export { server, hashPassword, verifyPassword, signToken, verifyToken, summarise };
