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

## Iterasi 4 — perbaikan tata letak desktop & mobile (keluhan pengguna)

Keluhan: *"Kalau dibuka di desktop tampilannya hancur banget, dan di mobile halaman Transaksi & Laporan masih berantakan."*
Pelajaran: seluruh test DOM (jsdom) buta terhadap tata letak — jsdom tidak punya mesin layout. Perbaikan dilakukan dengan membuka aplikasi di Chromium headless dan mengukur hasilnya.

| Bug nyata | Akar masalah | Perbaikan |
|---|---|---|
| **Desktop hancur**: sidebar melebar penuh (1182 px) dan konten terjepit 258 px | `.sidebar-scrim` (elemen drawer) tidak punya aturan di desktop sehingga ikut menempati sel grid pertama — auto-placement menggeser `.sidebar` ke kolom 2 dan `.app-main` ke kolom 1 | Penempatan grid dibuat **eksplisit** (`.sidebar { grid-column: 1 }`, `.app-main { grid-column: 2 }`), `.sidebar-scrim { display: none }` di desktop, dan scrim dikembalikan `display: block` hanya di dalam drawer mobile |
| **Mobile**: 41 nominal transaksi terpotong ("−Rp 161.0…") | `.ledger`/`.ledger-day` memakai `display: grid` tanpa `grid-template-columns`, sehingga kolom memakai ukuran *min-content* (401 px > kartu 364 px) | `grid-template-columns: minmax(0, 1fr)` pada kedua elemen |
| **Mobile Laporan**: tab "Rekap Bulanan" terpotong (strip 415 px > 330 px) | `.segmented` tiga tab hanya bisa di-scroll; pengguna tidak tahu masih ada tab lain | Di ≤760 px tab menjadi **grid 3 kolom** dengan label membungkus (ikon di atas teks) |
| **Mobile**: toast menutupi bottom nav + FAB | `.toast-stack` selalu `bottom: 20px` | Di mobile toast dinaikkan di atas bottom nav (`calc(var(--bottomnav-h) + 30px)`) dan melebar mengikuti layar |
| **Mobile**: header island dua baris | `.topbar-eyebrow` ("LAPORAN & REKENING KORAN") membungkus | eyebrow dipotong dengan ellipsis (`max-width: 46vw`) — judul halaman tetap utuh |
| **Mobile**: hero rekening koran mendorong kartu angka ke bawah lipatan | periode diulang tiga kali (toolbar, hero, judul) | `.sh-period` disembunyikan di mobile + padding hero diringkas |
| **Mobile Laporan**: pill "expense" melar seperti kolom input; baris "—" memakan satu baris | `.table-stack td` grid stretch; sel kosong tetap dirender | `.badge { justify-self: start }` dan sel kosong ditandai `data-empty` lalu disembunyikan di mobile |
| **Mobile Transaksi**: baris ledger terasa sesak | aksi Saldo berjalan/Terbaru di kepala daftar | Ritme `stack-*` dirapatkan, aksi baris penuh, `.txn-side` jadi baris kedua dengan `padding-left: 54px` agar sejajar teks |

**Alat baru:**
- `tools/audit-layout.mjs` — membuka aplikasi di Chromium dan mengukur 5 viewport × 5 halaman; mendeteksi scroll horizontal, elemen keluar tepi, *min-content blowout*, dan konten yang tidak memakai lebar penuh. Bisa menyimpan screenshot (`--shots dir`).
- `tools/check.mjs` — **8 invariant tata letak** yang menjaga perbaikan di atas tidak kembali rusak (ledger berkolom eksplisit, shell berposisi eksplisit, scrim mati di desktop, tabel tanpa min-width di layar kecil, toast di atas bottom nav, tab 3 kolom, `.txn-side`, eyebrow dipotong).

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

## Iterasi 5 — mode privasi saldo + tata letak mobile (Transaksi, Laporan, Detail, Form)

**Permintaan:** (1) "Tambahkan fitur mata untuk menyembunyikan Total Saldo yang ada di halaman Home";
(2) rapikan tampilan mobile **Transaksi**, **Laporan**, **Detail Transaksi**, **Edit Transaksi**, **Transaksi Baru**.

**Apa yang dikerjakan**

| Area | Sebelum | Sesudah |
|---|---|---|
| Kartu Total Saldo | nominal selalu terbaca | ada **tombol mata** (`aria-pressed`, ikon `eye` ⇄ `eye-off`); sekali klik → `••••••`, setelan `hide_balance` tersimpan lewat `setSetting` |
| Kebocoran nominal Home | — | metrik, saldo akun, transaksi terbaru, hutang/piutang, ringkasan grafik, **label sumbu SVG**, dan `title`/`aria-label` ikut disensor oleh `maskMoneyInDom()` (jaring pengaman, jadi komponen baru otomatis aman) |
| Strip ringkasan Transaksi | 5 figur bertumpuk 246 px | dua nominal sebagai ubin + sisanya baris label–nilai berpenyangga putus-putus ≈ 150 px |
| Blok atas Transaksi | ledger baru mulai y≈715 px | header, alat, dan ringkasan dipadatkan → ledger mulai ≈ 480 px |
| Form Transaksi Baru/Edit | footer meluber, tombol utama terpotong di tepi kanan | **tombol utama satu baris penuh** (46 px) + dua aksi sekunder; jenjang jenis transaksi & nominal cepat jadi grid; kategori 2 kolom dengan gulir internal; tanggal & waktu tetap berdampingan; input 16 px (anti zoom iOS) |
| Detail Transaksi | nominal + tanggal berdesakan di satu baris, kv melebar 445 px | tanggal turun ke baris sendiri, kv tetap **dua kolom** dengan `minmax(0,1fr)` + `overflow-wrap:anywhere` sehingga token panjang (no. referensi) tidak melebarkan sheet |
| Rekap Bulanan | tiap baris 232 px (2 kolom) | `.table-stack.is-dense` → 3 kolom per baris, label & nilai sebaris: 232 px → **173 px** |
| Kartu angka Laporan | label panjang membungkus bebas | label maksimal dua baris (`-webkit-line-clamp`), padding & font dipadatkan |
| Bug ditemukan | "Savings Rate" tampil **-Rp 26** | `animateCounters()` selalu memformat uang → kini menghormati `data-format="percent"`; kartu menampilkan **-26.0%** |

**Alat verifikasi:** invariant tata letak `tools/check.mjs` bertambah 5 (total **13**) dan smoke DOM bertambah 15 (total **156**) — termasuk klik tombol mata, penyensoran saldo akun/transaksi/metrik, dan unit `maskMoneyInDom`.

**Catatan operasional:** modul baru `src/utils/privacy.js` masuk daftar precache `sw.js` (pemeriksa statis menolak bila lupa) dan versi cache dinaikkan ke `adfinance-v2.1.0` agar PWA lama mengambil berkas baru.

## Iterasi 6 — Catat Cepat, popup Hutang/Piutang & Akun, identitas aplikasi

**Permintaan:** (1) tombol tambah di navbar berubah menjadi **X** dan bisa menutup menu **CATAT CEPAT**;
(2) UI Catat Cepat terlalu banyak makan ruang; (3) popup kartu **Hutang** dan popup kartu **Account** berantakan;
(4) perbarui versi di **Settings → Tentang Aplikasi** dan tambahkan "Developer Ade Nurrahman".

| Area | Sebelum | Sesudah |
|---|---|---|
| Tombol tambah (navbar) | ikon plus diam saja; klik kedua tidak menutup menu | toggle: plus → **X**, `aria-expanded`, klik kedua / tombol tutup / ESC / scrim menutup menu |
| Menu Catat Cepat | daftar 7 baris + separator, 232×**532 px**, menutupi hampir seluruh layar | grid 4 kolom ubin ikon + label, 366×**277 px**, judul ringkas, aksi "Form lengkap" satu baris |
| Popup Hutang / Piutang | tiga `.grid-3` menumpuk jadi 1 kolom (≈300 px hanya untuk angka) lalu diskrol | satu **hero** ringkas: sisa + progress + total/dibayar/jatuh tempo dalam satu kartu, `.kv-tight` dua kolom |
| Popup Akun | kartu 30-hari panjang membuat "Transaksi terakhir" tenggelam; nominal panjang memutus baris | tiga kartu sebaris dengan angka ringkas (`Rp 9.5 jt`), grafik 170 → 134 px, ledger `max-height` 320 → 240 px |
| Footer sheet | 3–4 tombol dalam flex-wrap: tombol terakhir terpotong & menggantung | grid 2 kolom; aksi utama (Bayar Hutang / Terima / Simpan / Transaksi) selebar baris; tombol "Pengingat" pindah ke dalam body |
| Notifikasi melayang | banner demo (z 300) menutupi isi sheet & menu (z 200) | `body.has-overlay` / `body.fab-open` menyembunyikan toast stack |
| Tentang Aplikasi | menampilkan `state.version` = **v1** (itu versi skema penyimpanan, bukan versi rilis) | **v2.2.0** dari satu sumber `APP_VERSION` (sw-client.js) + baris **Developer: Ade Nurrahman** |

**Bukti:** `preview/perbaikan-iterasi6.png` (sebelum/sesudah 5 permukaan), `preview/shots/{n1..n6,o1,o2}-*.png`.
**Verifikasi:** invariant `tools/check.mjs` bertambah 6 (total **19**), smoke DOM bertambah 19 (total **175**), `audit:layout` 25/25 bersih, footer sheet diukur di browser (semua tombol utuh, overflow 0 px).

## Prinsip untuk perubahan berikutnya

1. Jangan rusak invarian akuntansi (`docs/ACCOUNTING.md`).
2. Jangan tambahkan dependensi runtime.
3. Jalankan `npm run check && npm test && npm run test:smoke` sebelum menandai selesai.
4. Modul baru wajib masuk daftar precache `sw.js` (pemeriksa akan menolak bila lupa).
5. Nama ikon baru wajib terdaftar di `src/components/icons.js` (juga diperiksa otomatis).
