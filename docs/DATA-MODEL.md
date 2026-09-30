# Model data

Uang disimpan sebagai **integer rupiah** (minor unit). Tidak ada `float` di jalur uang mana pun.

## Penyimpanan lokal (IndexedDB `pfos`, v1)

Key path `id` kecuali `settings`, `outbox`, `meta` yang memakai `key`.

| Store | Isi | Catatan |
|---|---|---|
| `users` / `profiles` | identitas lokal (nama, mata uang, locale, tema, ambang saldo rendah) | satu profil per perangkat |
| `accounts` | bank · e-wallet · cash · investment · emergency_fund | `opening_balance`, warna, ikon, status, nomor (selalu dimask di UI) |
| `transactions` | buku besar — sumber kebenaran uang | lihat skema di bawah |
| `categories` | kategori **dan** subkategori dalam satu store | `parent_id === null` → kategori; `kind` ∈ `expense`/`income` |
| `debts` / `debt_payments` | hutang + riwayat pembayaran | pembayaran menaut `transaction_id` |
| `receivables` / `receivable_payments` | piutang + riwayat penerimaan | idem |
| `budgets` | anggaran bulanan per kategori | unik per `(category_id, period)` |
| `notifications` | notifikasi turunan dengan `key` stabil | dedupe lewat `key` |
| `settings` | preferensi key/value | `pin_hash`, `pin_salt`, `sync_endpoint`, `theme` |
| `outbox` | antrian operasi offline | di-flush ke `POST /sync` saat online |
| `meta` | versi skema, seed, dll | |

## Skema `transactions`

```js
{
  id: 'txn_…',
  user_id: 'local',
  transaction_type: 'income'|'expense'|'transfer'|'debt'|'receivable'
                  |'debt_payment'|'receivable_payment'|'investment'|'emergency_fund',
  date: '2026-09-30',            // YYYY-MM-DD
  time: '14:05',                 // HH:MM
  amount: 250000,                // integer, selalu > 0
  category_id: 'cat_…' | null,
  subcategory_id: 'sub_…' | null,
  account_id: 'acc_…',           // akun sumber (atau akun tujuan untuk income)
  destination_account_id: 'acc_…' | null,  // wajib untuk transfer/investasi/dana darurat
  reference_id: 'debt_…' | 'recv_…' | null, // dedupe & tautan pembayaran
  reference_type: 'debt' | 'receivable' | null,
  counterparty: '',              // pihak lawan (hutang/piutang)
  description: 'Makan siang',
  notes: '', attachment: null, tags: [],
  fingerprint: 'expense|2026-09-30|14:05|250000|acc_…|||makan siang',
  sync_status: 'pending' | 'synced',
  created_at: '…', updated_at: '…'
}
```

`fingerprint` = kunci anti-dobel: satu kombinasi tipe+tanggal+jam+nominal+akun+referensi+deskripsi hanya boleh ada sekali. Pengguna dapat memaksa (`force: true`) bila memang transaksi berulang.

## Relasi

```
accounts ──1:N──► transactions ──N:1──► categories ──1:N──► categories (subkategori)
   ▲                  │
   │                  ├── reference_id ──► debts ──1:N──► debt_payments
   │                  │                     └─ transaction_id ► transactions
   │                  └── reference_id ──► receivables ──1:N──► receivable_payments
   │                                          └─ transaction_id ► transactions
   └── budgets.category_id ──► categories
```

## Turunan yang tidak disimpan

Nilai ini **tidak** dipersistensi agar tidak pernah basi — selalu dihitung di `services/finance.js`:

- saldo akun (`accountBalance`, `accountSummaries`), total kekayaan, net worth
- status hutang/piutang (`debtState`/`receivableState`): `active` → `partially_*` → `paid`/`received`, dan `overdue` bila lewat jatuh tempo dan masih ada sisa
- pemakaian budget (`budgetUsage`) dengan level `ok` / `warn` (≥80%) / `over` (≥100%)
- notifikasi (jatuh tempo, budget, saldo rendah, laporan bulanan siap)
- angka rekening koran (`buildStatement`) dan rekap bulanan (`monthlySeries`)

> Catatan penting: field `status` yang tersimpan di dataset demo bisa sudah usang. Selalu derive lewat `debtState`/`receivableState` (sudah dilakukan di seluruh halaman).

## Skema server (PostgreSQL)

`server/schema.sql` memakai nama kolom yang identik dengan model klien 1:1 sehingga sinkronisasi = `INSERT … ON CONFLICT (id) DO UPDATE`.

- 13 tabel: `users, accounts, categories, transactions, debts, debt_payments, receivables, receivable_payments, budgets, monthly_reports, notifications, settings, sync_operations`
- `transactions` punya CHECK constraint yang **menolak di level database**: transfer tanpa akun tujuan berbeda, dan pembayaran tanpa `reference_id`
- unique index `(user_id, fingerprint)` → jaminan anti-dobel juga di server
- view: `account_balances`, `debt_outstanding`, `receivable_outstanding`, `monthly_totals`
- **Row-Level Security** aktif di 11 tabel, policy `user_id = current_setting('app.user_id')`, dan API menjalankan `SET LOCAL app.user_id` di tiap request

## Kapasitas

Data pribadi berukuran kecil: dataset demo (±5 bulan) berisi 227 transaksi / 10 akun / 4 entitas hutang-piutang. IndexedDB lokal aman untuk puluhan tahun riwayat; `storageEstimate()` di Settings menampilkan pemakaian nyata, dan `navigator.storage.persist()` diminta agar browser tidak membersihkan data.
