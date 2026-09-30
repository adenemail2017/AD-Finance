# Aturan akuntansi

Halaman ini adalah kontrak: **integritas angka tidak boleh dilanggar oleh perubahan fitur apa pun.** Setiap aturan di bawah punya test otomatis.

## 1. Efek setiap tipe transaksi

| Tipe | Akun sumber | Akun tujuan | Hutang | Piutang | Income/Expense | Net worth |
|---|---|---|---|---|---|---|
| `income` | **+amount** | — | — | — | income | naik |
| `expense` | **−amount** | — | — | — | expense | turun |
| `transfer` | **−amount** | **+amount** | — | — | tidak | **tetap** |
| `investment` | **−amount** | **+amount** | — | — | tidak | **tetap** |
| `emergency_fund` | **−amount** | **+amount** | — | — | tidak | **tetap** |
| `debt` | **+amount** | — | **+amount** | — | tidak | **tetap** |
| `debt_payment` | **−amount** | — | **−amount** | — | tidak | **tetap** |
| `receivable` | **−amount** | — | — | **+amount** | tidak | **tetap** |
| `receivable_payment` | **+amount** | — | — | **−amount** | tidak | **tetap** |

Contoh uji nyata (`tests/accounting.test.mjs`): meminjam Rp 3.000.000 lalu mencicil Rp 1.000.000 mengembalikan net worth **tepat** ke angka sebelum peminjaman, sementara saldo kas naik Rp 2.000.000 dan sisa hutang Rp 2.000.000.

## 2. Net worth

```
net worth = (saldo semua akun aset + piutang outstanding) − hutang outstanding
          = bank + cash + e-wallet + investasi + dana darurat + piutang − hutang
```

Konsekuensinya: memindahkan uang antar akun, membeli instrumen investasi, mengisi dana darurat, memberi pinjaman, atau membayar hutang **tidak boleh** mengubah net worth. Yang mengubah net worth hanya `income` (naik) dan `expense` (turun).

## 3. Anti pencatatan ganda

1. **`fingerprint`** — `tipe|tanggal|jam|nominal|akun|akun tujuan|referensi|deskripsi`. Menyimpan kombinasi identik → `AppError { code:'duplicate' }` dengan pesan *"Transaksi identik sudah tercatat."* Pengguna dapat menekan **"Tetap simpan"** untuk memaksa (`force: true`).
2. **`reference_id`** — setiap pembayaran hutang/piutang menyimpan id entitasnya, sehingga laporan bisa mengaitkan baris ledger dengan kewajiban tanpa menduplikasi nilainya.
3. **`client_id` pada outbox** — server menyimpan `sync_operations` dengan unique `(user_id, client_id)`; mengirim ulang batch yang sama tidak menghasilkan transaksi baru (diuji di `tests/api.test.mjs` → *"sync is idempotent"*).

## 4. Validasi sebelum menulis

`validateTransaction()` menolak dengan pesan ramah pengguna (bukan error teknis):

| Kondisi | Pesan |
|---|---|
| nominal ≤ 0 | "Nominal harus lebih dari nol." |
| kategori belum dipilih (income/expense) | "Pilih kategori terlebih dahulu." |
| akun tujuan sama dengan akun sumber | "Akun tujuan tidak boleh sama dengan akun sumber." |
| saldo tidak cukup | "Saldo **BCA** tidak mencukupi untuk transaksi ini." |
| pembayaran > sisa hutang | "Nominal melebihi sisa hutang (Rp 2.000.000)." |
| duplikat | "Transaksi identik sudah tercatat." (dengan opsi paksa) |

Saldo diperiksa untuk semua arus keluar: `expense`, `debt_payment`, `receivable`, `transfer`, `investment`, `emergency_fund`.

## 5. Rekening koran (statement)

```
closing = opening + totalIn − totalOut
```

- `opening` = saldo akun sebelum `from`
- `totalIn`/`totalOut` = jumlah kredit/debit pada rentang
- kolom **Saldo Berjalan** dihitung berurutan dari baris tertua
- menyaring satu akun menunjukkan perpindahan transfer; menyaring **semua akun** membuat transfer saling menghapus (netto nol) sehingga tidak pernah menggelembungkan kekayaan

Diuji di `tests/accounting.test.mjs` (rekonsiliasi) dan `tests/smoke.dom.mjs` (halaman statement + header cetak).

## 6. Periode & laporan

- `periodTotals()` memisahkan arus **operasional** (income/expense) dari arus **alokasi** (transfer, investasi, dana darurat) dan **pembayaran kewajiban** (debt_payment, receivable_payment) serta **pembentukan** kewajiban (debt_new, receivable_new). Savings rate memakai `(income − expense) / income`.
- Rekap bulanan (`monthlySeries`) menampilkan income, expense, investasi, dana darurat, pembayaran hutang, piutang, net cash flow, dan saldo akhir per bulan.

## 7. Budget

`budgetUsage()` menghitung pemakaian per kategori **termasuk subkategorinya**, lalu menetapkan level:

| Pemakaian | Level | Perilaku UI |
|---|---|---|
| < 80% | `ok` | progress biru |
| ≥ 80% | `warn` | progress amber + notifikasi "mendekati limit" |
| ≥ 100% | `over` | progress merah + notifikasi "melebihi budget" |

## 8. Aturan yang tidak boleh dilanggar saat menambah fitur

1. Jangan pernah menghitung ulang saldo di komponen UI.
2. Jangan menulis transaksi tanpa lewat `store` (validasi + fingerprint + outbox ada di sana).
3. Transfer/investasi/dana darurat tidak boleh masuk bucket income/expense.
4. Jangan memakai field `status` tersimpan untuk hutang/piutang — gunakan `debtState`/`receivableState`.
5. Setiap perubahan aturan wajib menambah test di `tests/accounting.test.mjs`.
