# Design system

Terinspirasi bahasa visual fintech/e-wallet modern: **Bento grid**, ruang kosong yang lapang, sudut membulat, bayangan lembut, dan sentuhan kaca. Sepenuhnya orisinal — tidak meniru merek mana pun.

## Warna

| Peran | Token | Nilai (tema terang) | Dipakai untuk |
|---|---|---|---|
| Primer | `--brand-500` | `#2563eb` | aksi utama, grafik utama, navigasi aktif |
| Primer gelap | `--brand-700` | `#1b3a93` | gradien hero, header statement |
| Positif | `--pos` | `#128f5a` | **hanya** pemasukan, surplus, progres hutang |
| Negatif | `--neg` | `#d92d3f` | **hanya** pengeluaran, defisit, kewajiban |
| Peringatan | `--warn` | `#c2760a` | jatuh tempo dekat, budget ≥ 80% |
| Aksen | `--accent` | `#6d47d9` | dana darurat, elemen sekunder |

Aturannya ketat dan konsisten di seluruh aplikasi: **hijau tidak pernah dipakai untuk hal buruk, merah tidak pernah dipakai untuk hal baik, amber berarti "perhatikan".** Palet dijaga kecil (≤ 6 warna semantik + netral) agar tidak berisik.

Netral: `--bg`, `--surface`, `--surface-2`, `--surface-3`, `--line`, `--line-strong`, `--text`, `--text-2`, `--text-3`.
Tema gelap menimpa token yang sama (`html[data-theme="dark"]`), jadi setiap komponen otomatis ikut gelap.

## Tipografi & angka

- Font sistem (`-apple-system`, `Segoe UI`, Inter bila tersedia) — tanpa webfont agar instan & offline.
- Skala: `--fs-2xs` 11 · `--fs-xs` 12 · `--fs-sm` 13 · `--fs-md` 15 · `--fs-h3` 17 · `--fs-h2` 20 · `--fs-h1` 26 · `--fs-display` 34.
- Semua angka uang memakai `font-variant-numeric: tabular-nums` sehingga kolom saldo tidak "bergoyang"; format `Rp 1.000.000` (locale `id-ID`).
- Nilai penting dianimasikan dengan `animateCount` (hitung naik) — tetap terbaca saat `prefers-reduced-motion` aktif (langsung ke nilai akhir).

## Spasi, radius, elevasi

- Skala spasi `--s-1` … `--s-9` (4 → 64 px).
- Radius: `--r-xs` 8 · `--r-sm` 10 · `--r-md` 14 · `--r-lg` 18 · `--r-xl` 24 · `--r-2xl` 30 · `--r-pill` 99.
- Bayangan bertingkat `--sh-xs` → `--sh-xl`, sangat lembut (`rgba(15,23,42,.06)`) supaya terasa "mengambang", bukan tebal.
- `--glass` (blur + transparansi) hanya untuk permukaan yang menumpuk konten (topbar, sheet) — bukan dekorasi.

## Chrome aplikasi (navbar, header, bottom nav)

- **Sidebar** = panel membulat mengambang (radius 24 px, inset 12 px) dengan border halus + bayangan lembut. Item aktif berupa pil gradien biru dengan teks putih — bukan lagi garis penanda di tepi. Bagian kaki sidebar memuat chip **Net Worth** bergradien berisi angka dan tombol transaksi cepat.
- **Header** = satu "pulau" membulat (radius 20 px) berisi judul halaman, pil pencarian, pill status koneksi, dan satu klaster aksi (tema, notifikasi, avatar) dengan pemisah tipis. Tujuannya mengurangi kepadatan: 5 elemen mengambang menjadi 3 blok yang jelas.
- **Bottom nav** (mobile) = pil mengambang radius 26 px dengan jarak 12 px dari tepi; item aktif memakai pil biru lembut di belakang ikon, dan tombol tengah adalah FAB bulat bergradien dengan cincin permukaan.
- **Kartu saldo (ATM)** = kartu kredit/e-wallet premium: rasio 1.62:1, sudut 24 px, gradien navy→biru, grid halus, glow mint, chip EMV emas, gelombang contactless, nomor ter-mask, nama pemegang, Member Since, dan Net Worth. Ada respons 3D (`--rx`/`--ry`) yang mengikuti kursor serta sorotan cahaya (`--mx`/`--my`), dimatikan pada perangkat sentuh dan saat `prefers-reduced-motion`.

## Layout responsif

| Lebar | Sidebar | Navigasi |
|---|---|---|
| ≥ 1180 px | penuh (258 px, `--sidebar-w`) | sidebar + topbar |
| 1024–1180 px | ringkas (ikon) | sidebar + topbar |
| ≤ 1024 px | disembunyikan | topbar + **bottom nav** |
| ≤ 760 px | — | bottom nav pil + **bottom sheet** (satu tangan); header menjadi ikon-saja |
| ≤ 420 px | — | kartu ATM lebih portrait, pencarian disembunyikan, teks nav mengecil |
| ≤ 640 px | — | kerapatan kiri-kanan dikurangi, grafik tetap utuh |
| ≤ 420 px | — | tipografi & kontrol menyesuaikan |

Tidak ada scroll horizontal di lebar mana pun; grafik memakai `viewBox` responsif.

## Komponen inti (`src/components/ui.js`)

`toast` · `openOverlay`/`openAdaptive` (sheet di mobile, modal di desktop, dengan focus trap) · `confirmDialog → Promise<boolean>` · `fieldHtml`, `inputHtml`, `selectHtml` · `badgeHtml` · `progressHtml` · `moneyHtml` · `emptyState` · `skeleton` · `segmented` · `sectionHead` · `kvList` · `banner`.

## Grafik (`src/components/charts.js`)

SVG inline: `lineAreaChart`, `groupedBarChart`, `donutChart`, `sparkline`, `breakdownBars`, dengan tooltip tunggal terdelegasi (`attachChartTooltips`) dan animasi masuk `barGrow` / `drawLine` / `areaFade` / `donutIn`. Alasan SVG: tajam di semua DPI, bisa di-print, dan tidak memerlukan canvas/library.

## Gerak (motion)

| Momen | Animasi |
|---|---|
| Pindah halaman | `page-enter` fade + geser 6 px |
| Kartu | hover `translateY(-2px)` + bayangan naik |
| Angka | `animateCount` 600 ms, `ease-out` |
| Grafik | tumbuh/digambar sekali saat muncul |
| Modal/sheet | naik dari bawah (mobile) / skala halus (desktop) |
| Tombol | `active: scale(.97)` |
| Toast | masuk dari bawah, keluar sendiri |
| Skeleton | shimmer halus saat memuat |
| Progress | lebar beranimasi saat nilai berubah |

Semua transisi 120–320 ms dan **selalu dibungkus `@media (prefers-reduced-motion: reduce)`** untuk mematikannya.


## Tampilan data (Transaksi & Laporan)

Pola yang dipakai bersama oleh halaman berisi daftar/tabel panjang:

| Elemen | Kelas / fungsi | Aturan |
|---|---|---|
| Kartu alat | `.card.tool-card` | **Satu** kartu untuk pencarian, filter, dan periode; tinggi tetap supaya daftar tidak "melompat". |
| Chip filter aktif | `filterChip()` / `.filter-chip` | Selalu bisa dihapus satu per satu, plus "Hapus semua" — pengguna tidak pernah melihat daftar terfilter tanpa penjelasan. |
| Strip angka | `statTile()` / `.stat-grid` → `.stat-tile` | Label kecil huruf besar, nilai besar `tabular-nums`, sub-teks opsional; warna hijau/merah hanya untuk nilai positif/negatif. |
| Kepala daftar | `.list-head` → `.lh-figures` + `.lh-actions` | Angka ringkasan rata kiri, aksi (saldo berjalan, urutan) rata kanan, terpisah garis tipis dari daftar. |
| Kepala seksi laporan | `sectionDivider()` / `.section-divider` | Judul + satu kalimat penjelas + aksi opsional; memberi napas antar blok laporan. |
| Daftar panjang | `.ledger-more` | Paginasi 60 baris, tombol menyebut sisa baris. |
| Tabel | `.table-wrap` → `table.data` | Desktop: tabel biasa (min-width 640 px hanya ≥861 px). Mobile: `table-stack` menumpuk baris jadi 2 kolom dengan `data-label` sebagai label. |

## Aksesibilitas

- Kontras minimal 4.5:1 untuk teks normal pada kedua tema.
- Setiap kontrol punya `aria-label`/teks; ikon dekoratif `aria-hidden`.
- Dialog: `role="dialog"`, `aria-modal`, focus trap, `Esc` menutup, fokus dikembalikan ke elemen pemicu.
- Navigasi penuh keyboard: `Tab`, `Enter`, `1`–`8`, `⌘/Ctrl+K`, `N`, `D`, `Esc`.
- Status tidak pernah bergantung warna saja — selalu ada ikon/label (mis. badge "Terlambat" + merah).
- `sr-only` untuk teks pembaca layar; skip-link di atas shell.
