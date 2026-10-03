/**
 * AD-Finance — Domain model & enums (single source of truth).
 * Pure data definitions + accounting rules. No DOM, no storage.
 *
 * Amount convention: integer minor units of the profile currency.
 * For IDR (default) 1 unit = Rp 1 → Rp 1.000.000 is stored as 1000000.
 */

/* ------------------------------------------------------------------ */
/* Enums                                                               */
/* ------------------------------------------------------------------ */

export const TRANSACTION_TYPES = {
  INCOME: 'income',
  EXPENSE: 'expense',
  TRANSFER: 'transfer',
  DEBT: 'debt',
  RECEIVABLE: 'receivable',
  DEBT_PAYMENT: 'debt_payment',
  RECEIVABLE_PAYMENT: 'receivable_payment',
  INVESTMENT: 'investment',
  EMERGENCY_FUND: 'emergency_fund',
};

export const TRANSACTION_TYPE_META = {
  [TRANSACTION_TYPES.INCOME]: {
    label: 'Pemasukan', short: 'Income', icon: 'trending-up', tone: 'positive',
    moneyIn: true, hint: 'Uang masuk ke salah satu akun',
  },
  [TRANSACTION_TYPES.EXPENSE]: {
    label: 'Pengeluaran', short: 'Expense', icon: 'trending-down', tone: 'negative',
    moneyOut: true, hint: 'Uang keluar dari salah satu akun',
  },
  [TRANSACTION_TYPES.TRANSFER]: {
    label: 'Transfer', short: 'Transfer', icon: 'switch', tone: 'neutral',
    moneyOut: true, moneyIn: true, needsDestination: true,
    hint: 'Pindah dana antar akun — bukan income / expense',
  },
  [TRANSACTION_TYPES.DEBT]: {
    label: 'Hutang Baru', short: 'Debt', icon: 'hand-coins', tone: 'warning',
    moneyIn: true, needsCounterparty: true, link: 'debt',
    hint: 'Menerima pinjaman → saldo akun bertambah, hutang bertambah',
  },
  [TRANSACTION_TYPES.RECEIVABLE]: {
    label: 'Piutang Baru', short: 'Receivable', icon: 'file-text', tone: 'warning',
    moneyOut: true, needsCounterparty: true, link: 'receivable',
    hint: 'Meminjamkan uang → saldo akun berkurang, piutang bertambah',
  },
  [TRANSACTION_TYPES.DEBT_PAYMENT]: {
    label: 'Bayar Hutang', short: 'Debt Payment', icon: 'circle-check', tone: 'warning',
    moneyOut: true, link: 'debt',
    hint: 'Bayar hutang → saldo akun berkurang, sisa hutang berkurang',
  },
  [TRANSACTION_TYPES.RECEIVABLE_PAYMENT]: {
    label: 'Terima Piutang', short: 'Receivable Payment', icon: 'circle-check', tone: 'positive',
    moneyIn: true, link: 'receivable',
    hint: 'Terima pembayaran → saldo akun bertambah, sisa piutang berkurang',
  },
  [TRANSACTION_TYPES.INVESTMENT]: {
    label: 'Investasi', short: 'Investment', icon: 'chart', tone: 'accent',
    moneyOut: true, moneyIn: true, needsDestination: true, destinationType: 'investment',
    hint: 'Alokasi dana ke portofolio investasi',
  },
  [TRANSACTION_TYPES.EMERGENCY_FUND]: {
    label: 'Dana Darurat', short: 'Emergency Fund', icon: 'shield', tone: 'accent',
    moneyOut: true, moneyIn: true, needsDestination: true, destinationType: 'emergency_fund',
    hint: 'Sisihkan dana ke rekening dana darurat',
  },
};

/** Transfer-like types move money between two accounts and never change net worth. */
export const TRANSFER_LIKE = [
  TRANSACTION_TYPES.TRANSFER,
  TRANSACTION_TYPES.INVESTMENT,
  TRANSACTION_TYPES.EMERGENCY_FUND,
];

export const ACCOUNT_TYPES = {
  BANK: 'bank',
  EWALLET: 'ewallet',
  CASH: 'cash',
  INVESTMENT: 'investment',
  EMERGENCY_FUND: 'emergency_fund',
};

export const ACCOUNT_TYPE_META = {
  [ACCOUNT_TYPES.BANK]: { label: 'Bank', icon: 'bank', asset: true },
  [ACCOUNT_TYPES.EWALLET]: { label: 'E-Wallet', icon: 'wallet', asset: true },
  [ACCOUNT_TYPES.CASH]: { label: 'Cash', icon: 'cash', asset: true },
  [ACCOUNT_TYPES.INVESTMENT]: { label: 'Investasi', icon: 'chart', asset: true },
  [ACCOUNT_TYPES.EMERGENCY_FUND]: { label: 'Dana Darurat', icon: 'shield', asset: true },
};

export const DEBT_STATUS = {
  ACTIVE: 'active',
  PARTIALLY_PAID: 'partially_paid',
  PAID: 'paid',
  OVERDUE: 'overdue',
};

export const RECEIVABLE_STATUS = {
  ACTIVE: 'active',
  PARTIALLY_RECEIVED: 'partially_received',
  RECEIVED: 'received',
  OVERDUE: 'overdue',
};

export const STATUS_META = {
  active: { label: 'Aktif', tone: 'info' },
  partially_paid: { label: 'Dibayar Sebagian', tone: 'warning' },
  partially_received: { label: 'Diterima Sebagian', tone: 'warning' },
  paid: { label: 'Lunas', tone: 'positive' },
  received: { label: 'Selesai', tone: 'positive' },
  overdue: { label: 'Jatuh Tempo', tone: 'negative' },
};

export const THEME_MODES = { SYSTEM: 'system', LIGHT: 'light', DARK: 'dark' };

/* ------------------------------------------------------------------ */
/* Accounting rules                                                    */
/* ------------------------------------------------------------------ */

/**
 * Signed delta of a transaction on ONE account.
 * Positive = money in, negative = money out.
 * @returns {number}
 */
export function accountDelta(txn, accountId) {
  const amount = Math.abs(Number(txn.amount) || 0);
  if (!accountId) return 0;
  switch (txn.transaction_type) {
    case TRANSACTION_TYPES.INCOME:
    case TRANSACTION_TYPES.DEBT:
    case TRANSACTION_TYPES.RECEIVABLE_PAYMENT:
      return txn.account_id === accountId ? amount : 0;
    case TRANSACTION_TYPES.EXPENSE:
    case TRANSACTION_TYPES.RECEIVABLE:
    case TRANSACTION_TYPES.DEBT_PAYMENT:
      return txn.account_id === accountId ? -amount : 0;
    case TRANSACTION_TYPES.TRANSFER:
    case TRANSACTION_TYPES.INVESTMENT:
    case TRANSACTION_TYPES.EMERGENCY_FUND:
      if (txn.account_id === accountId) return -amount;
      if (txn.destination_account_id === accountId) return amount;
      return 0;
    default:
      return 0;
  }
}

/** Does this transaction type participate in "Income" totals? */
export function isIncome(txn) {
  return txn.transaction_type === TRANSACTION_TYPES.INCOME
    || txn.transaction_type === TRANSACTION_TYPES.RECEIVABLE_PAYMENT
    || txn.transaction_type === TRANSACTION_TYPES.DEBT;
}

/** Does this transaction type participate in "Expense" totals? */
export function isExpense(txn) {
  return txn.transaction_type === TRANSACTION_TYPES.EXPENSE
    || txn.transaction_type === TRANSACTION_TYPES.DEBT_PAYMENT
    || txn.transaction_type === TRANSACTION_TYPES.RECEIVABLE;
}

/** Cash-flow relevant amount (signed), ignoring internal transfers. */
export function cashflowAmount(txn) {
  const amount = Math.abs(Number(txn.amount) || 0);
  if (isIncome(txn)) return amount;
  if (isExpense(txn)) return -amount;
  return 0; // transfer-like = neutral
}

/** Human label for a transaction direction, e.g. for statements. */
export function directionOf(txn, accountId) {
  const d = accountDelta(txn, accountId);
  if (d === 0) return 'none';
  return d > 0 ? 'credit' : 'debit';
}

/* ------------------------------------------------------------------ */
/* Factories (defaults for every entity)                               */
/* ------------------------------------------------------------------ */

export function makeTransaction(input = {}) {
  const now = new Date();
  const type = input.transaction_type || TRANSACTION_TYPES.EXPENSE;
  return {
    id: input.id || null,
    user_id: input.user_id || 'local',
    transaction_type: type,
    date: input.date || toISODate(now),
    time: input.time || toISOTime(now),
    amount: Math.abs(Number(input.amount) || 0),
    category_id: input.category_id || null,
    subcategory_id: input.subcategory_id || null,
    account_id: input.account_id || null,
    destination_account_id: input.destination_account_id || null,
    reference_id: input.reference_id || null,
    reference_type: input.reference_type || null,
    counterparty: input.counterparty || '',
    description: (input.description || '').trim(),
    notes: input.notes || '',
    attachment: input.attachment || null,
    tags: Array.isArray(input.tags) ? input.tags : [],
    created_at: input.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    sync_status: input.sync_status || 'pending',
    deleted_at: null,
  };
}

/** Stable dedupe key — prevents one real-world event being recorded twice. */
export function transactionFingerprint(txn) {
  return [
    txn.transaction_type, txn.date, txn.time, txn.amount,
    txn.account_id, txn.destination_account_id, txn.reference_id || '',
    (txn.description || '').toLowerCase().trim(),
  ].join('|');
}

export function makeAccount(input = {}) {
  return {
    id: input.id || null,
    user_id: input.user_id || 'local',
    name: input.name || 'Akun Baru',
    account_type: input.account_type || ACCOUNT_TYPES.BANK,
    institution: input.institution || '',
    account_number: input.account_number || '',
    opening_balance: Number(input.opening_balance) || 0,
    color: input.color || '#2563eb',
    icon: input.icon || 'bank',
    status: input.status || 'active',
    is_default: !!input.is_default,
    sort_order: Number(input.sort_order) || 0,
    notes: input.notes || '',
    created_at: input.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    sync_status: 'pending',
  };
}

export function makeCategory(input = {}) {
  return {
    id: input.id || null,
    user_id: input.user_id || 'local',
    name: input.name || 'Kategori',
    kind: input.kind || 'expense', // expense | income
    icon: input.icon || 'tag',
    color: input.color || '#64748b',
    parent_id: input.parent_id || null, // subcategory when set
    is_default: !!input.is_default,
    archived: !!input.archived,
    created_at: input.created_at || new Date().toISOString(),
  };
}

export function makeBudget(input = {}) {
  return {
    id: input.id || null,
    user_id: input.user_id || 'local',
    category_id: input.category_id || null,
    period: input.period || monthKey(new Date()),
    amount: Number(input.amount) || 0,
    rollover: !!input.rollover,
    created_at: input.created_at || new Date().toISOString(),
  };
}

export function makeDebt(input = {}) {
  return {
    id: input.id || null,
    user_id: input.user_id || 'local',
    counterparty: input.counterparty || 'Tanpa Nama',
    principal: Math.abs(Number(input.principal) || 0),
    total_repayment: Math.abs(Number(input.total_repayment) || 0),
    monthly_installment: Math.abs(Number(input.monthly_installment) || 0),
    account_id: input.account_id || null,
    start_date: input.start_date || toISODate(new Date()),
    due_date: input.due_date || null,
    interest_rate: Number(input.interest_rate) || 0,
    notes: input.notes || '',
    status: input.status || DEBT_STATUS.ACTIVE,
    created_at: input.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    sync_status: 'pending',
  };
}

export function makeReceivable(input = {}) {
  return {
    id: input.id || null,
    user_id: input.user_id || 'local',
    counterparty: input.counterparty || 'Tanpa Nama',
    principal: Math.abs(Number(input.principal) || 0),
    account_id: input.account_id || null,
    start_date: input.start_date || toISODate(new Date()),
    due_date: input.due_date || null,
    reminder_days: Number(input.reminder_days) || 3,
    notes: input.notes || '',
    status: input.status || RECEIVABLE_STATUS.ACTIVE,
    created_at: input.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    sync_status: 'pending',
  };
}

export function makePayment(input = {}) {
  return {
    id: input.id || null,
    user_id: input.user_id || 'local',
    debt_id: input.debt_id || null,
    receivable_id: input.receivable_id || null,
    account_id: input.account_id || null,
    amount: Math.abs(Number(input.amount) || 0),
    date: input.date || toISODate(new Date()),
    time: input.time || toISOTime(new Date()),
    notes: input.notes || '',
    transaction_id: input.transaction_id || null,
    created_at: input.created_at || new Date().toISOString(),
    sync_status: 'pending',
  };
}

/* ------------------------------------------------------------------ */
/* Small date helpers used by factories (kept dependency-free)         */
/* ------------------------------------------------------------------ */

export function toISODate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function toISOTime(d = new Date()) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
