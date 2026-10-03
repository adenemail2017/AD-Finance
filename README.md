# AD-Finance

**Live:** <https://ad-finance-phi.vercel.app> · **Repo:** <https://github.com/adenemail2017/AD-Finance>

![CI](https://github.com/adenemail2017/AD-Finance/actions/workflows/ci.yml/badge.svg)

**E-wallet + buku besar keuangan digital + rekening koran pribadi** — aplikasi PWA nyata (bukan mockup) untuk mencatat, mengaudit, dan memahami seluruh uang Anda.

Dibangun sebagai *local-first PWA*: seluruh data tersimpan di perangkat Anda (IndexedDB), bekerja penuh saat offline, dan tidak mengirim apa pun ke server kecuali Anda sendiri yang menyalakan sinkronisasi.

```
npm start          # → http://localhost:4173
```

> Tidak ada bundler, tidak ada CDN, tidak ada dependensi runtime. Buka `index.html` lewat server statis apa pun, atau install sebagai aplikasi dari browser.

---

## 1. Apa yang bisa dijawab aplikasi ini dalam < 5 detik

| Pertanyaan | Di mana |
|---|---|
| Uang saya sekarang berapa? | Dashboard → **Total Saldo** (+ delta bulan ini) |
| Uangnya ada di mana? | Dashboard → kartu **Saldo Akun** (baris pertama, di samping kartu saldo) |
| Pemasukan bulan ini? | Dashboard → **Total Pemasukan** |
| Pengeluaran bulan ini? | Dashboard → **Total Pengeluaran** |
| Pengeluaran terbesar? | Dashboard → **Insight** + Analytics → **Top Pengeluaran** |
| Hutang saya berapa? | Dashboard → **Hutang** (total, aktif, jatuh tempo terdekat) |
| Piutang saya berapa? | Dashboard → **Piutang** (total, aktif, jatuh tempo terdekat) |
| Cash flow saya sehat? | Dashboard → **Net Cash Flow** + grafik arus kas |
| Kekayaan bersih (net worth)? | Analytics → **Net Worth** = (bank + cash + e-wallet + investasi + piutang) − hutang |
| Bulan ini vs bulan lalu? | Dashboard → delta % pada setiap kartu |
| Sedang ada orang lain di dekat saya? | Dashboard → tombol **mata** di kartu Total Saldo (mode privasi) |

---

## 2. Menjalankan

```bash
# 1. Aplikasi (PWA statis, tanpa dependensi)
npm start                 # atau: node server/dev-server.js 4173
                          # buka http://localhost:4173

# 2. API opsional (multi-device sync, backup server)
npm run api               # in-memory, langsung jalan
DATABASE_URL=postgres://user:pass@host/db npm run api   # dengan PostgreSQL

# 3. Verifikasi
npm test                  # 39 unit + integration test (node:test)
npm run test:smoke        # 196 pemeriksaan DOM end-to-end + 12 pemeriksaan sandbox (JSDOM)
npm run check             # integritas statis: import/export, SW, manifest, ikon
npm run verify            # jalankan semuanya sekaligus (39 unit + 196 DOM + 12 sandbox)
```

`npm test` membutuhkan Node ≥ 18. Untuk smoke test, install sekali: `npm install --no-save jsdom`.

### Mode penyimpanan

Aplikasi **selalu** jalan, apa pun kondisi penyimpanan — dan selalu jujur soal itu:

| Mode | Kapan | Perilaku |
|---|---|---|
| `indexeddb` | normal | permanen di perangkat |
| `local` | IndexedDB diblokir (mode privat) | permanen via localStorage |
| `memory` | semua penyimpanan diblokir (iframe sandbox) | hanya selama tab terbuka — Settings menampilkan peringatan |

---

## 3. Struktur proyek

```
personal-finance-os/
├── index.html                  # shell + splash screen + meta PWA
├── manifest.webmanifest         # installability, shortcut, icon
├── sw.js                        # service worker: precache, offline, outbox flush
├── src/
│   ├── app.js                   # shell, hash router, topbar, bottom nav, FAB, shortcut
│   ├── sw-client.js             # registrasi SW, update, status standalone/offline
│   ├── types/models.js          # enum, meta tipe transaksi, accountDelta, fingerprint
│   ├── utils/                   # format · date · dom · id · csv · xlsx
│   ├── database/                # idb.js (IndexedDB + fallback) · seed.js (kategori & demo)
│   ├── services/                # store · finance · notifications · security
│   ├── components/              # icons · ui · cards · charts · ledger · category-manager
│   ├── pages/                   # dashboard · transactions · accounts · debts · budgets
│   │                            # reports · analytics · settings · search
│   └── styles/                  # design-system.css · components.css · app.css
├── server/
│   ├── dev-server.js            # static + SPA fallback, tanpa dependensi
│   ├── server.js                # API REST + JWT + scoping per user
│   └── schema.sql               # skema PostgreSQL + view + row-level security
├── assets/icons/                # 8 file ikon + screenshot PWA
├── tests/                       # accounting · xlsx · api · smoke.dom · sandbox.dom
├── tools/                       # check.mjs (integritas) · make-icons.py (generator ikon)
└── docs/                        # ARCHITECTURE · DATA-MODEL · DESIGN-SYSTEM · ACCOUNTING · ROADMAP
```

Aturan arsitektur: **satu modul, satu tanggung jawab**. Halaman tidak pernah menghitung uang — semua angka berasal dari `services/finance.js`. Semua mutasi lewat `services/store.js` sebagai satu-satunya sumber kebenaran. `tools/check.mjs` menjaga aturan itu (batas 1400 baris/modul, import/export harus benar-benar ada, ikon harus terdaftar).

---

## 4. Mesin akuntansi (inti kepercayaan aplikasi)

Uang disimpan sebagai **integer rupiah** — tidak ada float, tidak ada pembulatan yang bocor.

| Tipe transaksi | Saldo akun | Kewajiban/Piutang | Income/Expense? | Net worth |
|---|---|---|---|---|
| `income` | + | — | ya (income) | + |
| `expense` | − | — | ya (expense) | − |
| `transfer` | asal −, tujuan + | — | **tidak** | **tidak berubah** |
| `investment` | asal −, tujuan + | — | **tidak** | **tidak berubah** |
| `emergency_fund` | asal −, tujuan + | — | **tidak** | **tidak berubah** |
| `debt` | + | hutang + | tidak | **tidak berubah** (kas naik, kewajiban naik) |
| `debt_payment` | − | hutang − | tidak | **tidak berubah** |
| `receivable` | − | piutang + | tidak | **tidak berubah** (kas → piutang) |
| `receivable_payment` | + | piutang − | tidak | **tidak berubah** |

Setiap pembayaran otomatis membuat **baris transaksi** + **entri rekening koran** dengan `reference_id` ke hutang/piutang, sehingga tidak pernah tercatat dua kali. `transactionFingerprint()` menolak duplikat; pengguna bisa menimpanya secara sadar (`force`).

Aturan ini diverifikasi otomatis: `tests/accounting.test.mjs` (unit) dan `tests/api.test.mjs` (endpoint server).

---

## 5. Membuat transaksi < 10 detik

FAB **+ Transaksi** → bottom sheet: 9 tipe transaksi, **keypad numerik** dengan format `Rp 1.000.000` saat mengetik, tanggal & jam otomatis, kategori terakhir yang dipakai muncul lebih dulu (`localStorage pfos:recent`), saldo akun tampil di daftar pilihan, chip cepat (jumlah umum, "Lunasi sisa", "Sesuaikan ke saldo akun"), dan validasi ramah seperti *"Saldo BCA tidak mencukupi untuk transaksi ini."*

Shortcut: `N` transaksi baru · `⌘/Ctrl + K` pencarian global · `1`–`8` navigasi · `D` mode gelap · `Esc` tutup.

---

## 6. Laporan & ekspor

- **Tata letak Transaksi & Laporan (iterasi 3)** — satu kartu alat per halaman (pencarian + Filter sheet + strip periode), filter aktif tampil sebagai chip yang bisa dihapus, strip angka Masuk/Keluar/Net, saldo berjalan sungguhan per baris (`runningBalanceMap`), dan paginasi 60 baris. Di Laporan: satu toolbar yang tidak bergeser antar tab dan tiap tab dibagi menjadi seksi berjudul (Financial Summary, Arus Kas, Rincian, Budget vs Realisasi, Tren). Tabel berubah jadi kartu bertumpuk di layar < 860 px memakai label sel — **tanpa scroll horizontal** di ponsel.
- **Rekening koran digital** — periode, saldo awal, total masuk/keluar, **saldo berjalan** per baris; `closing = opening + credit − debit` (diverifikasi test). Header cetak **PERSONAL FINANCIAL STATEMENT** berisi periode, opening, income, expense, transfer, hutang, piutang, closing → tombol **Cetak / PDF** (print CSS, tanpa dependensi).
- **Laporan bulanan** — ringkasan + breakdown kategori/akun + **Rekap Bulanan** lintas bulan (income, expense, investasi, dana darurat, pembayaran hutang, piutang, net cash flow, saldo akhir).
- **Analytics** — 11 grafik (arus kas, kategori, sumber penghasilan, net worth, savings rate, tren belanja, saldo akun, progres hutang/piutang, top merchant, heatmap) dengan rentang 7D/30D/3M/6M/1Y/Semua/**Custom**.
- **Ekspor CSV / XLSX / PDF** — difilter per periode (semua/bulan/custom), akun, dan kategori. XLSX ditulis langsung sebagai OOXML (ZIP + CRC32) tanpa library.

---

## 7. Keamanan

- **Multi-pengguna** — perangkat baru menampilkan **layar perkenalan** yang sesederhana mungkin: cukup **nama + nomor telepon** (tanpa pilihan lain), lalu workspace dibuat dan **mulai dari nol** (0 akun, 0 transaksi — kategori bawaan tetap disiapkan; pilihan "isi dengan data contoh" tersedia bila diinginkan). Setiap pengguna punya akun, transaksi, kategori, budget, dan setelannya sendiri (`user_id` per baris + scope penyimpanan), diperiksa oleh uji isolasi, dan Pengaturan punya kartu **Pengguna** untuk tambah / ganti / ganti nama / hapus workspace. Perangkat yang sudah dipakai di versi lama tidak kehilangan data: layar perkenalan menyorot pilihan "Pertahankan data yang ada".
- **Local-first**: data tidak pernah meninggalkan perangkat kecuali Anda mengonfigurasi endpoint sinkronisasi.
- **PIN lock** — salted SHA-256 ×120 iterasi, PIN tidak pernah disimpan dalam bentuk asli, layar kunci menutup aplikasi.
- **Nomor rekening ter-mask** (`•••• 7890`) secara default; API hanya mengirim nomor penuh bila diminta eksplisit dengan sesi sah.
- **API** (opsional) — scrypt password hashing, JWT HS256, validasi ketat, rate limit pada auth, dan **row-level security** PostgreSQL per `user_id` sehingga satu user tidak mungkin membaca data user lain. Diuji: `user isolation` di `tests/api.test.mjs`.
- Pesan error selalu ramah pengguna; tidak ada stack trace yang bocor ke UI.

---

## 8. Testing

| Perintah | Cakupan | Status |
|---|---|---|
| `npm test` | 23 test akuntansi/XLSX + 16 test API (dijalankan lewat `tools/run-tests.mjs` agar sama di Node 20 & 22) | **39/39 hijau** |
| `npm run test:smoke` | 228 pemeriksaan DOM (boot, 7 rute, quick add, guard, detail, hutang, budget, pencarian, notifikasi, tema, ekspor, kategori, PIN, statement, mode privasi saldo, beranda ringkas, bahasa visual 2.5, tata letak Transaksi & Laporan, **gerbang perkenalan nama + nomor telepon**, **isolasi data antar pengguna**, **pindah/rename/hapus pengguna**) | **228/228 hijau** |
| `node tests/sandbox.dom.mjs` | boot dengan semua API penyimpanan diblokir | **12/12 hijau** |
| `npm run check` | import/export, precache SW vs disk, manifest, ikon, budget arsitektur, **40 invariant** (termasuk 6 pemeriksa multi-pengguna + urutan beranda) | **hijau** |
| `npm run audit:layout -- <url>` | tata letak di browser sungguhan: 5 viewport × 5 halaman (scroll horizontal, elemen keluar tepi, konten terjepit) | **25/25 bersih** |
| `npm run audit:multiuser -- <url>` | alur multi-pengguna di Chromium: wajib isi nama + nomor telepon, mulai kosong, isolasi antar pengguna, kartu Pengguna, pindah/rename/hapus, **data perangkat lama tidak hilang** | **26/26 bersih** |

Test menemukan bug nyata sepanjang pengerjaan — antara lain `scrollIntoView` yang mematikan form, handler pembayaran hutang yang crash karena field catatan tak ada, `%` negatif, bug PIN berubah yang dulu selalu menolak PIN lama yang benar, dan **`node --test tests/` yang tidak lagi menerima direktori di Node 22** (ditemukan CI dua-versi di GitHub Actions, diperbaiki lewat `tools/run-tests.mjs`).

---

## 9. Aksesibilitas & performa

- Navigasi mengambang: sidebar berbentuk panel membulat, header satu "pulau" membulat berisi pencarian + status + aksi, bottom nav pil mengambang dengan FAB bulat.
- Kartu **Total Saldo** tampil sebagai kartu ATM/e-wallet premium: lockup brand, chip EMV, gelombang contactless, nomor rekening ter-mask, nama pemegang kartu, "Member Since", dan efek tilt 3D yang mengikuti kursor.
- **Catat Cepat:** tombol tambah di navbar (bottom nav & tombol desktop/sidebar) berubah menjadi **X** saat diklik dan bisa menutup menu; menunya berupa grid 7 ubin ikon + aksi "Form lengkap" (277 px, bukan lagi daftar setinggi 532 px), dengan scrim, tombol tutup, dan ESC.
- **Mode privasi sekali klik:** tombol **mata** di kartu saldo menyembunyikan seluruh nominal di Home (kartu, metrik, saldo akun, transaksi terbaru, hutang/piutang, termasuk label sumbu grafik dan tooltip) menjadi `••••••`. Preferensi disimpan sebagai setelan `hide_balance`, jadi tetap aktif saat aplikasi dibuka kembali. Persentase (mis. Savings Rate, perubahan %) tetap tampil karena tidak membocorkan nominal.
- Kontras memenuhi WCAG AA pada kedua tema; semua kontrol punya label/`aria-*`; fokus ter-trap di dialog; navigasi keyboard penuh; `prefers-reduced-motion` dihormati.
- Tanpa framework: payload kecil, boot < 0,5 detik pada JSDOM, grafik berupa SVG inline (bukan canvas berat), animasi memakai `transform`/`opacity` agar tetap 60 fps.
- Responsif penuh: sidebar (desktop) → sidebar ringkas (tablet) → bottom nav + sheet setinggi satu tangan (mobile). Tidak ada scroll horizontal di mobile.

---

## 10. Backend opsional

```bash
DATABASE_URL=postgres://… npm run api
curl -s localhost:8787/health
```

Endpoint: `POST /auth/register` · `POST /auth/login` · `GET /me` · `GET|POST /accounts` · `GET|POST /transactions` · `POST /transactions/bulk` · `DELETE /transactions/:id` · `GET|POST /debts` · `POST /debts/:id/payments` · `GET|POST /receivables` · `POST /receivables/:id/payments` · `GET|POST /categories` · `GET|POST /budgets` · `GET /notifications` · `GET /summary` · **`POST /sync`**.

`POST /sync` menerima operasi dari outbox offline, **idempotent** per `client_id` (mengulang batch yang sama tidak menggandakan transaksi) dan mengembalikan konflik per baris alih-alih menggagalkan seluruh batch.

---

## 11. Kredit & lisensi

Desain, ikon, grafik, dan mesin akuntansi dibuat dari nol untuk proyek ini — tanpa meniru merek mana pun. Data demo bersifat deterministik (`mulberry32(20260930)`, ±5 bulan riwayat, 10 akun, 227 transaksi, 2 hutang, 2 piutang, 6 budget) sehingga angka di dokumentasi selalu bisa direproduksi.

## 12. Deploy — GitHub & Vercel

Repositori ini sudah disiapkan untuk rilis: konfigurasi hosting, CI, dan skrip
satu-perintah. Panduan lengkap (berbahasa Indonesia) ada di **[DEPLOY.md](DEPLOY.md)**.

| Berkas | Fungsi |
|---|---|
| `vercel.json` | Deploy statis tanpa build: framework dimatikan, `outputDirectory: "."`, cache SW/manifest, header keamanan. |
| `.vercelignore` | Hanya berkas aplikasi yang diunggah (`docs/`, `tests/`, `tools/`, `server/`, `preview/` dikecualikan). |
| `.github/workflows/ci.yml` | Menjalankan `check + unit + smoke + sandbox + verifikasi paket` di Node 20 & 22 untuk setiap push dan Pull Request. |
| `.github/workflows/deploy-vercel.yml` | Deploy manual dari tab Actions (opsional, agar tidak bentrok dengan integrasi Git Vercel). |
| `tools/publish-github.sh` | `GH_TOKEN=… bash tools/publish-github.sh --create ad-finance` → repo dibuat, commit, push. |
| `tools/deploy-vercel.sh` | `VERCEL_TOKEN=… bash tools/deploy-vercel.sh --prod` → verifikasi dulu, lalu deploy. |
| `tools/verify-bundle.mjs` | Meniru isi unggahan Vercel lalu membuktikan precache SW lengkap dan aplikasi tetap boot. |
| `tools/audit-live.mjs` | `npm run audit:live -- <url>` — memeriksa header, precache, dan mem-boot aplikasi dari deployment produksi. |

```bash
npm run verify                                   # check + 39 unit + 140 smoke + 12 sandbox + paket deploy
npm run verify:bundle                            # khusus memeriksa isi unggahan Vercel
npm run publish:github -- --create ad-finance    # ke GitHub (butuh GH_TOKEN)
npm run deploy:prod                              # ke Vercel (butuh VERCEL_TOKEN)
```

Setelah repo terhubung ke Vercel, setiap push ke branch produksi otomatis
mendeploy. **Selalu naikkan `VERSION` di `src/sw.js` saat merilis** supaya
pengguna lama menerima pembaruan service worker.


## 13. Identitas merek

Nama aplikasi **AD-Finance** dengan logo monogram "AD" — squircle gradien navy→biru, garis ledger tipis, dan titik mint sebagai penanda saldo positif. Logo yang sama dipakai di sidebar, kartu saldo, splash screen, ikon PWA (192/512/maskable/apple-touch), favicon, serta header statement cetak. Semua ikon dihasilkan ulang oleh `tools/make-icons.py`.

> Catatan teknis: nama merek diganti, tetapi kunci penyimpanan internal tetap berawalan `pfos` (nama database IndexedDB, kunci `localStorage`, dan nama cache service worker). Ini disengaja agar data pengguna lama tidak hilang saat rebranding.

Dokumentasi lain: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) · [`docs/ACCOUNTING.md`](docs/ACCOUNTING.md) · [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md) · [`docs/ROADMAP.md`](docs/ROADMAP.md)
