/**
 * Default master data + deterministic demo dataset.
 * Demo data uses a seeded PRNG so a fresh install always looks identical
 * (great for screenshots/QA) and can be wiped from Settings.
 */

import {
  ACCOUNT_TYPES, TRANSACTION_TYPES, makeAccount, makeBudget, makeCategory,
  makeDebt, makePayment, makeReceivable, makeTransaction, monthKey, toISODate,
} from '../types/models.js';
import { addDays, addMonths, todayISO } from '../utils/date.js';
import { uid } from '../utils/id.js';

/* ------------------------------------------------------------------ */
/* Master data                                                         */
/* ------------------------------------------------------------------ */

export const EXPENSE_CATEGORIES = [
  { name: 'Food', icon: 'utensils', color: '#f97316' },
  { name: 'Transportation', icon: 'car', color: '#3b82f6' },
  { name: 'Bills', icon: 'receipt', color: '#8b5cf6' },
  { name: 'Electricity', icon: 'zap', color: '#eab308' },
  { name: 'Internet', icon: 'wifi', color: '#06b6d4' },
  { name: 'Phone', icon: 'smartphone', color: '#14b8a6' },
  { name: 'Health', icon: 'heart', color: '#ef4444' },
  { name: 'Personal Care', icon: 'sparkles', color: '#ec4899' },
  { name: 'Shopping', icon: 'bag', color: '#a855f7' },
  { name: 'Entertainment', icon: 'gamepad', color: '#f43f5e' },
  { name: 'Education', icon: 'book', color: '#0ea5e9' },
  { name: 'Family', icon: 'users', color: '#22c55e' },
  { name: 'Social', icon: 'heart-handshake', color: '#fb7185' },
  { name: 'Travel', icon: 'plane', color: '#2dd4bf' },
  { name: 'Subscription', icon: 'repeat', color: '#6366f1' },
  { name: 'Other', icon: 'tag', color: '#64748b' },
];

export const INCOME_CATEGORIES = [
  { name: 'Salary', icon: 'briefcase', color: '#16a34a' },
  { name: 'Freelance', icon: 'laptop', color: '#0ea5e9' },
  { name: 'Business', icon: 'store', color: '#8b5cf6' },
  { name: 'Bonus', icon: 'gift', color: '#f59e0b' },
  { name: 'Interest', icon: 'percent', color: '#14b8a6' },
  { name: 'Investment', icon: 'chart', color: '#6366f1' },
  { name: 'Other', icon: 'tag', color: '#64748b' },
];

export const SUBCATEGORY_SEEDS = {
  Food: ['Groceries', 'Restaurant', 'Coffee', 'Delivery'],
  Transportation: ['Fuel', 'Public Transport', 'Ride Hailing', 'Parking', 'Toll'],
  Bills: ['Water', 'Waste', 'Rent', 'Insurance'],
  Entertainment: ['Streaming', 'Cinema', 'Games', 'Hangout'],
  Shopping: ['Clothing', 'Electronics', 'Home'],
  Health: ['Medicine', 'Doctor', 'Gym'],
};

export const INSTITUTION_PRESETS = {
  bank: [
    { name: 'BCA', color: '#1d4ed8', icon: 'bank' },
    { name: 'Mandiri', color: '#0f3d91', icon: 'bank' },
    { name: 'BNI', color: '#ea580c', icon: 'bank' },
    { name: 'BRI', color: '#1e40af', icon: 'bank' },
    { name: 'BSI', color: '#0f766e', icon: 'bank' },
    { name: 'CIMB Niaga', color: '#b91c1c', icon: 'bank' },
    { name: 'SeaBank', color: '#f97316', icon: 'bank' },
    { name: 'Blu', color: '#2563eb', icon: 'bank' },
    { name: 'Other Bank', color: '#475569', icon: 'bank' },
  ],
  ewallet: [
    { name: 'DANA', color: '#0ea5e9', icon: 'wallet' },
    { name: 'OVO', color: '#7c3aed', icon: 'wallet' },
    { name: 'GoPay', color: '#0ea5e9', icon: 'wallet' },
    { name: 'ShopeePay', color: '#f97316', icon: 'wallet' },
    { name: 'Other E-Wallet', color: '#475569', icon: 'wallet' },
  ],
  cash: [
    { name: 'Cash Wallet', color: '#16a34a', icon: 'cash' },
    { name: 'Home Cash', color: '#15803d', icon: 'cash' },
    { name: 'Other Cash', color: '#475569', icon: 'cash' },
  ],
  investment: [
    { name: 'Reksadana', color: '#6366f1', icon: 'chart' },
    { name: 'Saham', color: '#4f46e5', icon: 'chart' },
    { name: 'Emas Digital', color: '#d97706', icon: 'chart' },
    { name: 'Deposito', color: '#0ea5e9', icon: 'chart' },
  ],
  emergency_fund: [
    { name: 'Dana Darurat', color: '#0d9488', icon: 'shield' },
  ],
};

/* ------------------------------------------------------------------ */
/* Profile scaffolding                                                 */
/* ------------------------------------------------------------------ */

export function buildDefaultCategories(userId) {
  const out = [];
  const push = (cat, kind) => {
    const id = uid('cat');
    out.push(makeCategory({ ...cat, id, user_id: userId, kind, is_default: true }));
    (SUBCATEGORY_SEEDS[cat.name] || []).forEach((sub) => {
      out.push(makeCategory({
        id: uid('sub'),
        user_id: userId,
        name: sub,
        kind,
        parent_id: id,
        icon: cat.icon,
        color: cat.color,
        is_default: true,
      }));
    });
  };
  EXPENSE_CATEGORIES.forEach((c) => push(c, 'expense'));
  INCOME_CATEGORIES.forEach((c) => push(c, 'income'));
  return out;
}

export function categoryIdByName(categories, name, kind = 'expense') {
  const found = categories.find((c) => !c.parent_id && c.kind === kind && c.name.toLowerCase() === String(name).toLowerCase());
  return found ? found.id : null;
}

/* ------------------------------------------------------------------ */
/* Demo dataset (deterministic)                                        */
/* ------------------------------------------------------------------ */

function mulberry32(seed) {
  let a = seed;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEMO_ACCOUNTS = [
  { name: 'BCA', type: 'bank', institution: 'BCA', number: '8820 114 778', color: '#1d4ed8', icon: 'bank', opening: 12_500_000, primary: true },
  { name: 'Mandiri', type: 'bank', institution: 'Mandiri', number: '1370 0099 4412', color: '#0f3d91', icon: 'bank', opening: 4_250_000 },
  { name: 'BNI', type: 'bank', institution: 'BNI', number: '0998 7761 20', color: '#ea580c', icon: 'bank', opening: 1_800_000 },
  { name: 'Cash Wallet', type: 'cash', institution: 'Cash', color: '#16a34a', icon: 'cash', opening: 650_000 },
  { name: 'DANA', type: 'ewallet', institution: 'DANA', number: '0812 8899 1100', color: '#0ea5e9', icon: 'wallet', opening: 1_120_000 },
  { name: 'OVO', type: 'ewallet', institution: 'OVO', number: '0812 8899 1100', color: '#7c3aed', icon: 'wallet', opening: 540_000 },
  { name: 'GoPay', type: 'ewallet', institution: 'GoPay', number: '0812 8899 1100', color: '#0891b2', icon: 'wallet', opening: 285_000 },
  { name: 'ShopeePay', type: 'ewallet', institution: 'ShopeePay', number: '0812 8899 1100', color: '#f97316', icon: 'wallet', opening: 175_000 },
  { name: 'Reksadana', type: 'investment', institution: 'Reksadana', color: '#6366f1', icon: 'chart', opening: 8_000_000 },
  { name: 'Dana Darurat', type: 'emergency_fund', institution: 'Dana Darurat', color: '#0d9488', icon: 'shield', opening: 6_000_000 },
];

const MERCHANT_POOL = {
  Food: ['Makan Siang Kantor', 'Kopi Kenangan', 'Warung Tekko', 'Belanja Bulanan Superindo', 'GoFood Dinner', 'Bakso Pak Kumis', 'Groceries Indomaret'],
  Transportation: ['Isi Bensin Pertalite', 'Gojek ke Kantor', 'Grab Bandara', 'Tarif Tol Jagorawi', 'Parkir Mall', 'KRL Commuter'],
  Bills: ['Tagihan Air PDAM', 'Iuran Keamanan', 'Asuransi Kesehatan'],
  Electricity: ['Token Listrik PLN'],
  Internet: ['IndiHome Fiber'],
  Phone: ['Paket Data Telkomsel'],
  Health: ['Vitamin & Suplemen', 'Konsultasi Dokter', 'Membership Gym'],
  'Personal Care': ['Potong Rambut', 'Skincare Serum'],
  Shopping: ['Kaos Uniqlo', 'Kabel USB-C', 'Lampu Meja'],
  Entertainment: ['Netflix', 'Spotify Premium', 'Bioskop XXI', 'Top Up Game'],
  Education: ['Kursus Online', 'Buku Teknik'],
  Family: ['Kirim ke Orang Tua', 'Kado Ulang Tahun'],
  Social: ['Nongkrong Bareng', 'Kondangan Teman'],
  Travel: ['Tiket Kereta', 'Hotel Staycation'],
  Subscription: ['iCloud Storage', 'Notion Plus'],
  Other: ['Biaya Admin', 'Donasi'],
};

const INCOME_POOL = {
  Salary: ['Gaji Bulanan', 'Gaji Bulanan', 'Gaji Bulanan'],
  Freelance: ['Proyek Web Client', 'Desain Logo UMKM'],
  Business: ['Penjualan Toko Online'],
  Bonus: ['Bonus Proyek', 'THR'],
  Interest: ['Bunga Deposito'],
  Investment: ['Dividen Saham', 'Reksadana Naik'],
  Other: ['Cashback', 'Refund Toko'],
};

function pick(prng, arr) {
  return arr[Math.floor(prng() * arr.length)];
}

function roundTo(n, step = 1000) {
  return Math.round(n / step) * step;
}

/**
 * Build a realistic ~5 month ledger.
 * @returns {{accounts: Array, categories: Array, transactions: Array, debts: Array,
 *            debtPayments: Array, receivables: Array, receivablePayments: Array, budgets: Array}}
 */
export function buildDemoDataset(userId) {
  const prng = mulberry32(20260930);
  const categories = buildDefaultCategories(userId);
  const catId = (name, kind = 'expense') => categoryIdByName(categories, name, kind);
  const subId = (parent, name) => {
    const parentId = catId(parent);
    const sub = categories.find((c) => c.parent_id === parentId && c.name === name);
    return sub ? sub.id : null;
  };

  const accounts = DEMO_ACCOUNTS.map((a, i) => makeAccount({
    id: uid('acc'),
    user_id: userId,
    name: a.name,
    account_type: a.type,
    institution: a.institution,
    account_number: a.number || '',
    opening_balance: a.opening,
    color: a.color,
    icon: a.icon,
    is_default: !!a.primary,
    sort_order: i,
  }));

  const acc = (name) => accounts.find((a) => a.name === name).id;

  const transactions = [];
  const debts = [];
  const debtPayments = [];
  const receivables = [];
  const receivablePayments = [];

  const today = todayISO();
  const startKey = addMonths(monthKey(), -4); // 5 months of history incl. current
  const startDate = `${startKey}-01`;
  const totalDays = Math.max(1, Math.round((new Date(today) - new Date(startDate)) / 86_400_000));

  const addTxn = (input) => {
    transactions.push(makeTransaction({
      id: uid('trx'),
      user_id: userId,
      ...input,
    }));
  };

  // --- recurring monthly salary + fixed bills -------------------------
  for (let m = -4; m <= 0; m += 1) {
    const mk = addMonths(monthKey(), m);
    const day = m === 0 ? Math.min(25, new Date().getDate()) : 25;
    const date = `${mk}-${String(day).padStart(2, '0')}`;
    if (date > today) continue;
    addTxn({
      transaction_type: TRANSACTION_TYPES.INCOME,
      date, time: '08:15',
      amount: 8_500_000,
      category_id: catId('Salary', 'income'),
      account_id: acc('BCA'),
      description: 'Gaji Bulanan',
      tags: ['rutin'],
    });
    addTxn({
      transaction_type: TRANSACTION_TYPES.EXPENSE,
      date: `${mk}-03`, time: '09:20',
      amount: 450_000,
      category_id: catId('Internet'),
      subcategory_id: null,
      account_id: acc('BCA'),
      description: 'IndiHome Fiber',
      tags: ['rutin'],
    });
    addTxn({
      transaction_type: TRANSACTION_TYPES.EXPENSE,
      date: `${mk}-05`, time: '10:05',
      amount: roundTo(280_000 + prng() * 220_000, 5000),
      category_id: catId('Electricity'),
      account_id: acc('DANA'),
      description: 'Token Listrik PLN',
      tags: ['rutin'],
    });
    addTxn({
      transaction_type: TRANSACTION_TYPES.EMERGENCY_FUND,
      date: `${mk}-26`, time: '07:40',
      amount: 1_000_000,
      account_id: acc('BCA'),
      destination_account_id: acc('Dana Darurat'),
      category_id: catId('Other'),
      description: 'Setoran Dana Darurat',
      tags: ['rutin', 'saving'],
    });
    addTxn({
      transaction_type: TRANSACTION_TYPES.INVESTMENT,
      date: `${mk}-27`, time: '08:00',
      amount: 1_500_000,
      account_id: acc('BCA'),
      destination_account_id: acc('Reksadana'),
      category_id: catId('Investment', 'income'),
      description: 'Top Up Reksadana',
      tags: ['rutin', 'investasi'],
    });
  }

  // --- daily-ish variable spending ------------------------------------
  let cursor = startDate;
  let guard = 0;
  while (cursor <= today && guard < 4000) {
    guard += 1;
    const d = new Date(cursor);
    const dow = d.getDay();
    const dayOfMonth = d.getDate();
    const isWeekend = dow === 0 || dow === 6;
    const entries = isWeekend ? 1 + Math.floor(prng() * 3) : (prng() > 0.35 ? 1 + Math.floor(prng() * 2) : 0);
    for (let i = 0; i < entries; i += 1) {
      const catName = pick(prng, Object.keys(MERCHANT_POOL));
      const merchants = MERCHANT_POOL[catName];
      const base = { Food: 45_000, Transportation: 65_000, Bills: 300_000, Electricity: 250_000, Internet: 420_000, Phone: 100_000, Health: 320_000, 'Personal Care': 150_000, Shopping: 380_000, Entertainment: 120_000, Education: 250_000, Family: 700_000, Social: 180_000, Travel: 600_000, Subscription: 90_000, Other: 60_000 }[catName] || 60_000;
      const amount = roundTo(base * (0.55 + prng() * 1.35), 1000);
      const accountChoice = prng();
      const accountId = accountChoice > 0.55 ? acc('BCA')
        : accountChoice > 0.4 ? acc('DANA')
          : accountChoice > 0.28 ? acc('Cash Wallet')
            : accountChoice > 0.18 ? acc('OVO')
              : accountChoice > 0.1 ? acc('GoPay') : acc('ShopeePay');
      addTxn({
        transaction_type: TRANSACTION_TYPES.EXPENSE,
        date: cursor,
        time: `${String(7 + Math.floor(prng() * 14)).padStart(2, '0')}:${String(Math.floor(prng() * 60)).padStart(2, '0')}`,
        amount,
        category_id: catId(catName),
        account_id: accountId,
        description: pick(prng, merchants),
        tags: dayOfMonth < 5 ? ['awal-bulan'] : [],
      });
    }
    cursor = addDays(cursor, 1);
  }

  // --- transfers, side income, debts, receivables ----------------------
  const sideIncomeMonths = [-3, -2, -1];
  sideIncomeMonths.forEach((m, i) => {
    const mk = addMonths(monthKey(), m);
    const date = `${mk}-${String(12 + i).padStart(2, '0')}`;
    if (date > today) return;
    addTxn({
      transaction_type: TRANSACTION_TYPES.INCOME,
      date, time: '14:30',
      amount: roundTo(1_500_000 + prng() * 2_500_000, 50_000),
      category_id: catId('Freelance', 'income'),
      account_id: acc('BCA'),
      description: pick(prng, INCOME_POOL.Freelance),
      tags: ['side-income'],
    });
  });

  addTxn({
    transaction_type: TRANSACTION_TYPES.TRANSFER,
    date: addDays(today, -6), time: '16:10', amount: 500_000,
    account_id: acc('BCA'), destination_account_id: acc('DANA'),
    description: 'Top up DANA',
  });
  addTxn({
    transaction_type: TRANSACTION_TYPES.TRANSFER,
    date: addDays(today, -3), time: '18:25', amount: 300_000,
    account_id: acc('BCA'), destination_account_id: acc('GoPay'),
    description: 'Top up GoPay',
  });

  // Debt: pinjaman dari Andi (partially paid)
  const debtAndi = makeDebt({
    id: uid('debt'), user_id: userId, counterparty: 'Andi',
    principal: 5_000_000, account_id: acc('BCA'),
    start_date: addDays(today, -68), due_date: addDays(today, 12),
    notes: 'Pinjaman tanpa bunga untuk renovasi kamar',
  });
  debts.push(debtAndi);
  addTxn({
    transaction_type: TRANSACTION_TYPES.DEBT, date: debtAndi.start_date, time: '11:00',
    amount: 5_000_000, account_id: acc('BCA'), reference_id: debtAndi.id, reference_type: 'debt',
    counterparty: 'Andi', description: 'Pinjaman dari Andi', tags: ['hutang'],
  });
  const p1 = makePayment({
    id: uid('dp'), user_id: userId, debt_id: debtAndi.id, account_id: acc('BCA'),
    amount: 2_000_000, date: addDays(today, -20), notes: 'Angsuran 1',
  });
  debtPayments.push(p1);
  addTxn({
    transaction_type: TRANSACTION_TYPES.DEBT_PAYMENT, date: p1.date, time: '09:35',
    amount: p1.amount, account_id: acc('BCA'), reference_id: debtAndi.id, reference_type: 'debt',
    counterparty: 'Andi', description: 'Bayar Hutang Andi (1/2)', tags: ['hutang'],
  });

  // Debt: cicilan motor (overdue)
  const debtMotor = makeDebt({
    id: uid('debt'), user_id: userId, counterparty: 'Koperasi Karyawan',
    principal: 3_600_000, account_id: acc('Mandiri'),
    start_date: addDays(today, -50), due_date: addDays(today, -4),
    notes: 'Cicilan motor 6x',
  });
  debts.push(debtMotor);
  addTxn({
    transaction_type: TRANSACTION_TYPES.DEBT, date: debtMotor.start_date, time: '13:15',
    amount: 3_600_000, account_id: acc('Mandiri'), reference_id: debtMotor.id, reference_type: 'debt',
    counterparty: 'Koperasi Karyawan', description: 'Cicilan motor (pokok)', tags: ['hutang'],
  });

  // Receivable: Budi (partially received)
  const recBudi = makeReceivable({
    id: uid('rec'), user_id: userId, counterparty: 'Budi',
    principal: 3_000_000, account_id: acc('BCA'),
    start_date: addDays(today, -40), due_date: addDays(today, 5),
    reminder_days: 3, notes: 'Pinjaman singkat, dijanjikan akhir bulan',
  });
  receivables.push(recBudi);
  addTxn({
    transaction_type: TRANSACTION_TYPES.RECEIVABLE, date: recBudi.start_date, time: '10:20',
    amount: 3_000_000, account_id: acc('BCA'), reference_id: recBudi.id, reference_type: 'receivable',
    counterparty: 'Budi', description: 'Pinjamkan ke Budi', tags: ['piutang'],
  });
  const rp1 = makePayment({
    id: uid('rp'), user_id: userId, receivable_id: recBudi.id, account_id: acc('BCA'),
    amount: 1_000_000, date: addDays(today, -12), notes: 'Bayar sebagian',
  });
  receivablePayments.push(rp1);
  addTxn({
    transaction_type: TRANSACTION_TYPES.RECEIVABLE_PAYMENT, date: rp1.date, time: '15:45',
    amount: rp1.amount, account_id: acc('BCA'), reference_id: recBudi.id, reference_type: 'receivable',
    counterparty: 'Budi', description: 'Terima piutang Budi (1/3)', tags: ['piutang'],
  });

  // Receivable: Sinta (active, due soon)
  const recSinta = makeReceivable({
    id: uid('rec'), user_id: userId, counterparty: 'Sinta',
    principal: 750_000, account_id: acc('DANA'),
    start_date: addDays(today, -9), due_date: addDays(today, 2), reminder_days: 3,
    notes: 'Talang untuk titip beli tiket',
  });
  receivables.push(recSinta);
  addTxn({
    transaction_type: TRANSACTION_TYPES.RECEIVABLE, date: recSinta.start_date, time: '19:05',
    amount: 750_000, account_id: acc('DANA'), reference_id: recSinta.id, reference_type: 'receivable',
    counterparty: 'Sinta', description: 'Titip beli tiket Sinta', tags: ['piutang'],
  });

  // --- budgets ---------------------------------------------------------
  const currentMonth = monthKey();
  const budgetPlan = [['Food', 2_500_000], ['Transportation', 1_200_000], ['Entertainment', 700_000],
    ['Shopping', 900_000], ['Bills', 800_000], ['Health', 500_000]];
  const budgets = budgetPlan.map(([name, amount]) => makeBudget({
    id: uid('bud'), user_id: userId, category_id: catId(name), period: currentMonth, amount,
  }));

  return {
    accounts, categories, transactions, debts, debtPayments, receivables, receivablePayments, budgets,
  };
}

export const DEMO_SEED_HINT = 'Demo dataset: 5 bulan riwayat, 10 akun, 2 hutang, 2 piutang, 6 budget.';
