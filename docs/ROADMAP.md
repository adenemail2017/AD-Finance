# Roadmap & status

Dikerjakan bertahap sesuai 12 fase yang diminta; setiap fase menjaga kompatibilitas dengan fase sebelumnya (tidak ada fitur lama yang rusak — dijaga oleh 154 pemeriksaan otomatis).

| # | Fase | Status | Bukti |
|---|---|---|---|
| 1 | Design system · layout · navigasi | ✅ | `design-system.css`, `components.css`, `app.css`, shell + bottom nav + FAB |
| 2 | Dashboard | ✅ | kartu Total Saldo/Income/Expense/Net Cash Flow, akun, hutang, piutang, grafik arus kas, transaksi terbaru, insight |
| 3 | Transactions (rekening koran) | ✅ | ledger ber-running balance, filter periode/akun/kategori/tipe, pencarian, detail sheet, ekspor |
| 4 | Accounts | ✅ | CRUD akun 5 tipe, saldo berjalan, nomor termask, riwayat per akun |
| 5 | Hutang & Piutang | ✅ | counterparty, bunga, jatuh tempo, progres, pembayaran sebagian, status derive, pengingat |
| 6 | Rekening koran digital | ✅ | periode, opening/closing, kolom debit/kredit/saldo, header cetak **PERSONAL FINANCIAL STATEMENT** |
| 7 | Laporan bulanan | ✅ | ringkasan + breakdown + **Rekap Bulanan** lintas bulan |
| 8 | Analytics | ✅ | 11 grafik, rentang 7D/30D/3M/6M/1Y/Semua/Custom |
| 9 | Budget & notifikasi | ✅ | budget per kategori, ambang 80%/100%, 6 jenis notifikasi turunan |
| 10 | PWA & offline | ✅ | manifest, service worker 41 entri precache, outbox + auto-sync, install prompt, splash |
| 11 | Auth & keamanan | ✅ | PIN lock (salted SHA-256 ×120), isolasi data per user di API + RLS, masking nomor rekening |
| 12 | Testing · bugfix · performa | ✅ | 39 unit/integration + 103 smoke + 12 sandbox + pemeriksa integritas |

## Bug nyata yang ditemukan test dan sudah diperbaiki

1. `scrollIntoView` tidak tersedia di sebagian lingkungan → mematikan inisialisasi form transaksi (kini dibungkus try/catch + optional call).
2. Handler pembayaran hutang membaca field catatan yang tidak ada di markup → `TypeError` dan pembayaran tidak pernah tersimpan.
3. Perubahan PIN memakai nilai yang sama untuk "PIN lama" dan "PIN baru" → PIN yang benar selalu ditolak.
4. `percent()` memanggil `abs()` yang tidak ada → angka persentase bisa salah di data negatif.
5. `on()` hanya mendukung handler terdelegasi → pemanggilan langsung (mis. klik dokumen) melempar error.
6. Notifikasi tidak muncul pada boot pertama (turunan tidak dihitung saat start).
7. ~20 nama ikon dipakai tapi tidak terdaftar → semua jatuh ke ikon `tag` secara diam-diam (kini ada pemeriksa otomatis).
8. Mode penyimpanan dihitung sebelum probe async selesai → Settings bisa melaporkan "IndexedDB" padahal memori.
9. `openAdaptive` dipanggil dengan opsi `content`/`close` yang salah → konten form kategori kosong.
10. Duplikat transaksi bisa lolos di API karena server hanya memeriksa fingerprint bila klien mengirimkannya.
11. Sinkronisasi tidak idempotent di mode in-memory → mengirim ulang batch menggandakan transaksi.
12. `header`/format `type` akun tidak konsisten antar endpoint (`account_type` vs `type`) → klien salah memilih akun.

## Iterasi 2 — rebranding & UI chrome (permintaan pengguna)

| Perubahan | Detail |
|---|---|
| Nama aplikasi | **Personal Finance OS → AD-Finance** di judul dokumen, manifest, header aplikasi, splash, notifikasi, laporan cetak, dan API. |
| Logo baru | Monogram "AD" pada squircle gradien; dirender di dalam aplikasi (SVG) dan sebagai berkas ikon 192/512/maskable/apple-touch/favicon/screenshot. |
| Navbar | Sidebar menjadi panel membulat mengambang; item aktif memakai pil gradien. |
| Header | Disederhanakan menjadi satu pulau membulat: judul + pencarian + pill status + klaster aksi. |
| Kartu saldo | Tampilan kartu ATM/e-wallet dengan chip, contactless, nomor ter-mask, nama pemegang, Member Since, serta tilt 3D dan kilau mengikuti kursor. |


## Iterasi 3 — merapikan halaman Transaksi & Laporan (permintaan pengguna)

Keluhan: *"Halaman Transaksi dan Laporan sangat berantakan dan jelek banget."*
Prinsip perbaikan: **satu toolbar, hierarki angka yang jelas, seksi berjudul, tabel yang tidak memaksa scroll samping.**

| Perubahan | Detail |
|---|---|
| Toolbar Transaksi | Satu kartu: pencarian + tombol Filter + strip periode yang bisa di-scroll. Akun/kategori/jenis pindah ke *Filter sheet*, dan setiap filter aktif muncul sebagai **chip yang bisa dihapus** (`data-clear`) + tombol "Hapus semua". Tidak ada lagi daftar filter panjang yang membanjiri halaman. |
| Ringkasan daftar | Strip angka **Masuk / Keluar / Net / Periode / Jumlah** di kepala daftar, plus tombol "Saldo berjalan" dan urutan Terbaru/Terlama di sisi kanan. |
| Saldo berjalan asli | `runningBalanceMap()` menghitung saldo **setelah** tiap transaksi secara kronologis (portofolio bila semua akun, atau per akun) — bukan saldo akhir akun yang diulang. |
| Daftar panjang | Ledger dipaginasi 60 baris dengan tombol "Tampilkan 60 lagi · sisa N" sehingga ribuan transaksi tidak membanjiri halaman. |
| Toolbar Laporan | Tab, pemilih akun, dan pemilih bulan dalam **satu kartu yang tidak berubah posisinya** saat berganti tab. |
| Rekening koran | Hero saldo akhir → 4 kartu ringkas (Opening, Credit, Debit, Transfer) → strip rekonsiliasi "Seimbang" → tabel **Tanggal / Keterangan / Jenis / Debit / Credit / Saldo** + baris total di kaki tabel. |
| Laporan bulanan | Dipisah dengan *section divider*: **Financial Summary** (7 stat tile), **Arus Kas** (harian + donut), **Rincian** (income, akun, top pengeluaran, merchant, heatmap), **Budget vs Realisasi**. |
| Rekap bulanan | 4 stat tile → tabel 9 kolom dengan baris total → blok **Tren** (net worth + net cash flow). |
| Tabel mobile | `table.data` tidak lagi dipaksa `min-width: 640px` di semua ukuran; di bawah 860 px tabel berubah menjadi kartu bertumpuk memakai `data-label` tiap sel (`table-stack`). Tidak ada scroll horizontal di ponsel. |
| Komponen baru | `statTile()`, `filterChip()`, `sectionDivider()` di `components/ui.js` + kelas `.stat-grid/.stat-tile/.tool-card/.filter-chip/.list-head/.ledger-more/.table-stack`. |
| Pengujian | +25 pemeriksaan smoke (total **140**): struktur toolbar, chip filter yang benar-benar mempersempit daftar, paginasi, empty state, seksi laporan, baris total, dan label tabel mobile. |

## Bug nyata lain (ditemukan CI dua-versi Node)

| Gejala | Akar masalah | Perbaikan |
|---|---|---|
| CI merah di job **Node 22** sementara Node 20 hijau: `Cannot find module '.../tests'` | Node 22 tidak lagi menerima *direktori* sebagai argumen posisi `node --test`; argumen diperlakukan sebagai modul | `tools/run-tests.mjs` menemukan berkas `tests/*.test.mjs` sendiri lalu memanggil test runner dengan daftar eksplisit — portabel untuk Node 20/22, Linux/macOS/Windows |

## Sisa / berikutnya (tidak memblokir)

- **Bulk edit & split transaksi** (satu struk beberapa kategori).
- **Rekonsiliasi impor CSV bank** dengan pemetaan kolom otomatis dan penanda baris yang sudah ada.
- **Aturan berulang** (auto-post langganan bulanan) dengan konfirmasi sebelum mencatat.
- **Tujuan menabung (goal)** per akun investasi/dana darurat dengan target tanggal.
- **Widget beranda** (streak mencatat, ringkasan mingguan) dan pengingat harian opsional via Notification API.
- **Mode multi-profil lokal** (keluarga) di luar isolasi per user server.
- **Grafik perbandingan tahun-ke-tahun** dan deteksi anomali pengeluaran.
- **Sinkronisasi dua arah dengan resolusi konflik** (versi `updated_at` + merge per field) — saat ini server menang per operasi.
- **Ekspor PDF langsung** (saat ini lewat dialog cetak browser — tanpa dependensi, hasil sama).

## Prinsip untuk perubahan berikutnya

1. Jangan rusak invarian akuntansi (`docs/ACCOUNTING.md`).
2. Jangan tambahkan dependensi runtime.
3. Jalankan `npm run check && npm test && npm run test:smoke` sebelum menandai selesai.
4. Modul baru wajib masuk daftar precache `sw.js` (pemeriksa akan menolak bila lupa).
5. Nama ikon baru wajib terdaftar di `src/components/icons.js` (juga diperiksa otomatis).
