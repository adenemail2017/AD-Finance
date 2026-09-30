# Deploy AD-Finance ke GitHub & Vercel

## Status integrasi (30 Sep 2026)

| Bagian | Status |
|---|---|
| GitHub | <https://github.com/adenemail2017/AD-Finance> — publik, branch `main`. Commit awal repo tetap jadi akar riwayat. |
| Vercel | Proyek **ad-finance** terhubung ke repo GitHub (production branch `main`) → setiap push auto-deploy. |
| Produksi | <https://ad-finance-phi.vercel.app> — publik, sudah lolos audit. |
| Alias lain | `ad-finance-this-is-ad.vercel.app`, `ad-finance-git-main-*.vercel.app`, dan URL per-deployment **meminta login Vercel** karena proyek ini mengaktifkan *Deployment Protection* (`ssoProtection: all_except_custom_domains`). Jadi selalu bagikan **ad-finance-phi.vercel.app** — atau matikan proteksinya di *Settings ▸ Deployment Protection ▸ Vercel Authentication ▸ Only Preview Deployments*. |
| Audit produksi | `npm run audit:live -- https://ad-finance-phi.vercel.app` → semua lolos: header, 41 entri precache, berkas internal 404, boot aplikasi dari berkas produksi. |
| CI GitHub Actions | **Aktif & hijau** — 2 workflow (CI + deploy manual), 191 pemeriksaan di Node 20 (25 s) dan Node 22 (28 s). Badge di README. |

AD-Finance adalah **PWA statis tanpa build step** — tidak ada bundler, tidak ada
dependency runtime, tidak ada server yang wajib. Karena itu deploy-nya paling
sederhana: unggah berkasnya, selesai. Dokumen ini memandu dua langkah itu
(GitHub → Vercel) beserta pemeriksaan setelah live.

```
┌──────────────┐   push    ┌──────────────┐   auto    ┌──────────────┐
│  laptop/HP   │ ────────▶ │    GitHub    │ ────────▶ │    Vercel    │
│  folder ini  │           │  ad-finance  │  (import) │ ad-finance   │
└──────────────┘           └──────────────┘           └──────────────┘
                                   ▲                          │
                                   └──── setiap push ke main ─┘
                                         deploy otomatis
```

---

## Berkas yang sudah disiapkan

| Berkas | Fungsi |
|---|---|
| `vercel.json` | Konfigurasi Vercel: framework dinonaktifkan (murni statis), output = akar repo, aturan cache, dan header keamanan. |
| `.vercelignore` | Membatasi yang diunggah ke hosting — hanya berkas aplikasi. `docs/`, `tests/`, `tools/`, `server/`, `preview/` tidak ikut. |
| `.github/workflows/ci.yml` | Menjalankan pemeriksaan yang sama seperti di komputer Anda (check + unit + smoke + sandbox) di Node 20 & 22 untuk setiap push/PR. |
| `.github/workflows/deploy-vercel.yml` | Opsional: deploy langsung dari tab Actions (manual, agar tidak bentrok dengan integrasi Git Vercel). |
| `tools/publish-github.sh` | Satu perintah untuk membuat repo git, membuat repositori GitHub, commit, dan push. |
| `tools/deploy-vercel.sh` | Satu perintah untuk verifikasi lalu deploy ke Vercel (preview atau produksi). |
| `tools/verify-bundle.mjs` | Menyalin tepat berkas yang akan diunggah, lalu membuktikan precache SW lengkap, semua aset ada, dan aplikasi tetap boot dari paket itu (`npm run verify:bundle`). |
| `tools/audit-live.mjs` | Memeriksa deployment yang sudah live: header, precache, berkas internal, lalu mem-boot aplikasi dari berkas produksi (`npm run audit:live -- <url>`). |
| `.gitignore` / `.env.example` | `node_modules`, `.env`, `.vercel`, dan berkas lokal lain tidak pernah ikut ter-commit. |

---

## Bagian A — GitHub

### A1. Cara tercepat (skrip bawaan)

Butuh **Personal Access Token**. Pilih salah satu:

**Classic** — <https://github.com/settings/tokens> → *Generate new token (classic)* →
centang **`repo`** **dan** **`workflow`** → Generate.
> `workflow` **wajib** di sini: repo ini mengirim berkas `.github/workflows/*` saat
> push pertama. Tanpa scope itu GitHub menolak dengan pesan
> *"refusing to allow a Personal Access Token to create or update workflow"*.

**Fine-grained** — <https://github.com/settings/personal-access-tokens/new>:
*Repository access* → **All repositories** (atau pilih repo setelah dibuat), lalu
*Permissions* → **Contents: Read and write**, **Workflows: Read and write**,
**Administration: Read and write** (untuk membuat repo lewat API), **Metadata: Read**.

Token hanya dipakai saat itu; skrip tidak menyimpannya. Cabut tokennya
(<https://github.com/settings/tokens>) begitu push selesai.

```bash
cd personal-finance-os

# buat repo + commit + push dalam satu perintah (privat)
GH_TOKEN=ghp_xxxxxxxx bash tools/publish-github.sh --create AD-Finance

# publik (pilihan proyek ini), atau dengan pesan commit sendiri
GH_TOKEN=ghp_xxxxxxxx bash tools/publish-github.sh --create AD-Finance --public -m "feat: AD-Finance v2"

# kalau repo-nya sudah dibuat manual di github.com
GH_TOKEN=ghp_xxxxxxxx bash tools/publish-github.sh https://github.com/USERNAME/AD-Finance.git
```

Token di atas hanya dipakai untuk autentikasi saat itu — skrip **tidak**
menyimpannya ke `.git/config`. Ingin melihat apa yang akan dilakukan dulu?
Tambahkan `--dry-run`.

### A2. Cara manual (tanpa skrip)

```bash
cd personal-finance-os
git init -b main
git add -A
git commit -m "feat: AD-Finance — PWA keuangan pribadi (v2)"
git remote add origin https://github.com/USERNAME/ad-finance.git
git push -u origin main
```

Buat repositori kosongnya lebih dulu di <https://github.com/new>:
nama **`AD-Finance`**, **jangan** centang "Add a README" (nanti bentrok saat push).
Catatan: nama repo bersifat case-insensitive — `AD-Finance` tetap bisa diakses lewat
`github.com/USER/AD-Finance` maupun `github.com/USER/ad-finance`. Nama proyek Vercel
nanti otomatis huruf kecil (`ad-finance`).

### A3. Kalau `.git/config` hilang / rusak

Folder `.git` bisa tidak lengkap (misalnya setelah dipindah antar mesin). Skrip
`tools/publish-github.sh` **self-healing**: jalankan lagi, ia akan
`git init` ulang dan menambahkan remote yang sama, tanpa menghapus riwayat.

### A4. Yang tidak boleh ikut ter-commit

Sudah dijaga `.gitignore`: `node_modules/`, `.env` dan `.env.*` (kecuali
`.env.example`), `.vercel/`, `*.pem`, `*.key`, serta hasil ekspor
(`pfos-export-*.csv/xlsx`, `backup-*.json`). Jangan pernah menaruh
`DATABASE_URL`, `JWT_SECRET`, atau token Vercel di dalam kode — pakai
Environment Variables.

---

## Bagian B — Vercel

### B1. Cara dashboard (disarankan, sekali klik untuk seterusnya)

1. Buka <https://vercel.com/new> → **Import Git Repository** → pilih `ad-finance`.
2. Vercel membaca `vercel.json`, jadi pengaturannya sudah benar. Pastikan:
   - **Framework Preset**: `Other`
   - **Build Command**: kosong
   - **Output Directory**: kosong / root
   - **Environment Variables**: tidak ada yang wajib
3. Klik **Deploy** → selesai dalam ±20 detik. URL produksi biasanya
   `https://ad-finance.vercel.app` (halaman **Settings → Domains** untuk
   mengganti atau menambah domain sendiri; HTTPS otomatis).

Setelah repo terhubung, **setiap push ke branch produksi (`main`) langsung
deploy otomatis**, dan setiap Pull Request mendapat URL preview tersendiri.

### B2. Cara CLI (tanpa membuka dashboard)

```bash
# 1. token sekali saja: https://vercel.com/account/tokens
export VERCEL_TOKEN=xxxxxxxx

# 2. deploy (skrip menjalankan check + unit test lebih dulu)
bash tools/deploy-vercel.sh              # preview
bash tools/deploy-vercel.sh --prod       # produksi
bash tools/deploy-vercel.sh --prod --project ad-finance --scope team-anda
```

### B3. Yang diatur `vercel.json`

| Aturan | Alasan |
|---|---|
| `framework: null`, `outputDirectory: "."` | Mencegah Vercel mencari folder `public/` atau mencoba build yang tidak ada. |
| `sw.js` → `max-age=0, must-revalidate` + `Service-Worker-Allowed: /` | Service worker harus selalu diperiksa ulang, kalau tidak pengguna terjebak versi lama. |
| `src/**` & `*.html` → `must-revalidate` | Kode aplikasi selalu segar; cache offline ditangani SW dengan versi sendiri. |
| `assets/**` → `immutable, max-age=1 tahun` | Ikon & gambar sudah berversi, aman di-cache lama. |
| `manifest.webmanifest` → `application/manifest+json` | Manifest terbaca benar saat instalasi PWA. |
| Header keamanan (`nosniff`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`) | Pengerasan dasar untuk aplikasi keuangan. |
| `github.silent: true` | Vercel tidak menulis komentar bot di setiap commit. |

---

## Bagian C — Checklist setelah live

Buka URL produksi di HP, lalu:

- [ ] **Instal**: menu browser → *Add to Home Screen*; ikon AD muncul, terbuka tanpa address bar (standalone), splash layar muncul saat dibuka.
- [ ] **Offline**: buka sekali, aktifkan mode pesawat, muat ulang → aplikasi tetap hidup dari cache service worker.
- [ ] **Catat transaksi offline**: simpan satu transaksi saat offline; ketika online kembali, indikator `pending → tersinkron` berubah.
- [ ] **Tema**: Settings → System/Light/Dark, tidak ada warna yang pecah.
- [ ] **Responsif**: tidak ada scroll horizontal di HP; tabel laporan berubah jadi kartu bertumpuk.
- [ ] **Ekspor**: CSV/XLSX terunduh; Cetak/PDF menghasilkan header **PERSONAL FINANCIAL STATEMENT**.
- [ ] **Keamanan**: kunci PIN aktif; nomor rekening tetap ter-mask (`•••• 1234`).
- [ ] **Paket deploy** sudah lolos `npm run verify:bundle` di komputer Anda.
- [ ] **Lighthouse** (Chrome DevTools → Lighthouse → kategori PWA/Performance) untuk catatan akhir.

---

## Bagian D — Alur rilis sehari-hari

```bash
# 1. ubah kode di src/…
npm run verify                     # check + unit + smoke + sandbox

# 2. WAJIB saat merilis: naikkan versi service worker
#    (src/sw.js: VERSION = 'adfinance-v2.0.1')
#    tanpa ini, pengguna lama tetap memakai berkas dari cache mereka.

git add -A && git commit -m "feat: …" && git push
# → Vercel otomatis mendeploy; riwayat deploy ada di dashboard
```

CI di GitHub menolak (merah) bila pemeriksaan gagal — dan sudah membuktikan gunanya: job Node 22 menangkap `node --test <direktori>` yang tidak lagi didukung Node 22, lihat `tools/run-tests.mjs`., jadi branch yang sudah
terhubung ke Vercel selalu dalam keadaan hijau. Ingin badge status di README?

```markdown
![CI](https://github.com/USERNAME/ad-finance/actions/workflows/ci.yml/badge.svg)
```

---

## Bagian E — Opsional: API + database di Vercel

Aplikasi **sudah lengkap tanpa server** (local-first, IndexedDB). Folder
`server/` berisi API opsional untuk sinkronisasi antar-perangkat:

- `server/server.js` — Node `http` murni, `PORT`/`DATABASE_URL`/`JWT_SECRET`, tanpa dependency, sudah diuji 16 tes.
- `server/schema.sql` — 13 tabel + `sync_operations`, CHECK constraint, indeks fingerprint, 4 view, dan Row Level Security.
- `docs/ARCHITECTURE.md` — rancangan sinkronisasi.

Untuk memindahkannya ke Vercel nanti (bukan bagian dari deploy statis ini):

1. Buat Postgres serverless (Neon / Supabase / Vercel Postgres) → simpan `DATABASE_URL`.
2. Tambahkan adaptor serverless: fungsi di `api/` yang memanggil handler API
   (modul `server/server.js` saat ini membuka `listen()` ketika di-import, jadi
   perlu dipisah menjadi `handler(req, res)` yang bisa diekspor).
3. Set Environment Variables di Vercel: `DATABASE_URL`, `JWT_SECRET` (acak 32 byte), `CORS_ORIGIN=https://ad-finance.vercel.app`.
4. Jalankan `psql "$DATABASE_URL" -f server/schema.sql` sekali untuk membuat skema.
5. Di aplikasi: Settings → Sinkronisasi → isi endpoint API-nya.

Sampai langkah itu dilakukan, biarkan `server/` tidak terunggah (sudah otomatis
dikecualikan oleh `.vercelignore`).

---

## Bagian F — Jika ada masalah

| Gejala | Penyebab & solusi |
|---|---|
| Deploy gagal: *"No Output Directory named 'public' found"* | Vercel mendeteksi framework. Pastikan `vercel.json` ikut ter-commit dan berisi `"framework": null`, `"outputDirectory": "."`. |
| Situs tampil 404 di semua halaman | Routing AD-Finance memakai hash (`#/transactions`), jadi tidak perlu rewrite. Kalau Anda menambahkan routing berbasis path, tambahkan `rewrites` ke `/index.html` di `vercel.json`. |
| Perubahan tidak muncul di pengguna lama | `VERSION` di `src/sw.js` belum dinaikkan. Naikkan, commit, push. Pengguna akan melihat toast "versi baru tersedia". |
| Ikon/manifest tidak terbaca | Buka `https://DOMAIN/manifest.webmanifest` — harus JSON, `Content-Type: application/manifest+json`. |
| Push ditolak `403`/`422` | Token kurang scope (`repo`, `workflow`) atau repo sudah ada dengan nama sama. |
| Vercel tidak bisa mengambil repo private | Di Vercel → Settings → Git, hubungkan ulang akun GitHub dan beri akses ke repo tersebut. |
| Ingin alternatif hosting | Skrip `deploy-vercel.sh` khusus Vercel. Untuk GitHub Pages: semua path di `index.html` sudah **relatif**, jadi repo bisa langsung diaktifkan di Settings → Pages (branch `main`, folder `/root`) tanpa perubahan. |

---

## Lampiran — perintah ringkas

```bash
npm run dev            # jalankan lokal di http://localhost:4173
npm run verify         # check + 39 unit + 140 smoke + 12 sandbox + verifikasi paket deploy
npm run verify:bundle  # hanya memeriksa isi unggahan Vercel (cepat)
npm run audit:live -- https://ad-finance-phi.vercel.app   # audit deployment produksi
npm test               # hanya unit + API
GH_TOKEN=… bash tools/publish-github.sh --create ad-finance
VERCEL_TOKEN=… bash tools/deploy-vercel.sh --prod
```
