# Arsitektur

## Prinsip

1. **Local-first.** Aplikasi harus 100% berguna tanpa server. Backend hanya untuk sinkronisasi/backup.
2. **Satu arah data.** `store` adalah satu-satunya penulis state; halaman hanya membaca lewat `services/finance.js`.
3. **Uang tidak dihitung di UI.** Tidak ada `+`/`−` saldo di komponen presentasional. Semua turunan angka ada di satu modul yang bisa diuji.
4. **Modul kecil & bernama jelas.** Batas 1400 baris/modul ditegakkan `tools/check.mjs`.
5. **Tidak ada dependensi runtime.** Tanpa bundler, tanpa CDN — sehingga aplikasi tetap jalan di lingkungan tertutup/offline.

## Lapisan

```
        ┌──────────────────────────── src/app.js ────────────────────────────┐
        │  shell · hash router · topbar · sidebar/bottom nav · FAB · shortcut │
        └───────────────┬─────────────────────────────────────┬──────────────┘
                        │ ctx: {params, navigate, rerender…}   │
        ┌───────────────▼──────────────┐          ┌───────────▼───────────────┐
        │  pages/*  (9 halaman)        │          │ components/*  (presentasi)│
        │  dashboard transactions      │          │ ui · cards · charts       │
        │  accounts debts budgets      │          │ ledger · category-manager │
        │  reports analytics settings  │          │ icons                     │
        └───────────────┬──────────────┘          └───────────┬───────────────┘
                        │ baca (pure)                         │ tanpa state
        ┌───────────────▼─────────────────────────────────────▼───────────────┐
        │  services/finance.js   — model baca: saldo, total, seri, statement  │
        │  services/store.js     — sumber kebenaran: state + semua mutasi     │
        │  services/notifications.js · services/security.js                   │
        └───────────────┬─────────────────────────────────────────────────────┘
                        │
        ┌───────────────▼──────────────────┐   ┌─────────────────────────────┐
        │ database/idb.js (IndexedDB+fallback) │ │ types/models.js (aturan akuntansi)│
        │ database/seed.js (kategori + demo)   │ │ utils/* (format, date, csv, xlsx)│
        └──────────────────────────────────┘   └─────────────────────────────┘
```

## Alur satu mutasi (contoh: menyimpan pengeluaran)

```
ledger.js (form)  →  store.addTransaction(input)
                        ├─ validateTransaction()   → AppError ramah pengguna
                        │    • amount > 0, akun ada, kategori ada
                        │    • saldo cukup (kecuali income/piutang baru)
                        │    • fingerprint duplikat (kecuali force:true)
                        ├─ transaction baru (id, created_at, sync_status:'pending')
                        ├─ idb.put('transactions', txn)       → durable
                        ├─ enqueue('create','transactions')   → outbox (offline)
                        ├─ syncDerived()                      → saldo, notifikasi, budget
                        └─ emit('txn-added')                  → listener halaman re-render
```

Offline: operasi tetap masuk `outbox`. Saat `online`, `flushOutbox()` mengirim ke `settings.sync_endpoint` (`POST /sync`), per-operasi idempotent lewat `client_id`. Tanpa endpoint, outbox tetap tersimpan sebagai jejak audit.

## Router & shell

- Hash router `#/route?k=v` — 8 rute: dashboard, transactions, accounts, debts, budgets, reports, analytics, settings. Shell mengekspos `[data-title]`/`[data-eyebrow]` sebagai barrier render (dipakai test).
- `ctx` berisi `{params, navigate, rerender, refreshShell, setTheme, lockApp}` — halaman tidak pernah menyentuh DOM shell.
- Kunci navigasi `1`–`7` (halaman) + `8` (Settings); `⌘/Ctrl+K` pencarian, `N` transaksi baru, `D` tema, `Esc` tutup overlay.
- `window.__pfos` menyediakan `{getState, navigate, installPWA, canInstall, checkForUpdate, version}` untuk otomasi & debugging.

## PWA & offline

- `sw.js` versi `pfos-app-v1.1.0`: 41 entri precache (shell + seluruh modul + ikon). Navigasi network-first → cache `index.html` → halaman 503 inline; aset cache-first.
- Pesan `SKIP_WAITING`, `CLEAR_CACHE`; pesan `pfos-sync` memicu `FLUSH_OUTBOX` di klien.
- `src/sw-client.js` membungkus registrasi, deteksi update, `isStandalone()`, `offlineReady()` — dan aman di frame sandbox (semua akses API dibungkus `try/catch`).

## Degradasi bertingkat (storage)

| Kondisi | Perilaku |
|---|---|
| IndexedDB normal | penyimpanan permanen |
| IndexedDB diblokir, localStorage jalan | fallback durable via `localStorage` |
| Semua diblokir | memori sesi; Settings menampilkan peringatan jujur, aplikasi tetap penuh fungsi |

Dibuktikan `tests/sandbox.dom.mjs` yang membuat `localStorage`, `sessionStorage`, dan `indexedDB` melempar `SecurityError` saat diakses.

## Batas yang dijaga tooling

`node tools/check.mjs` memeriksa: 32 modul (import/export benar-benar ada), 8 referensi aset shell, precache SW vs isi disk, dimensi PNG ikon, nama ikon yang dipakai vs yang terdaftar, dan anggaran ukuran modul. Semua kegagalan dilaporkan dengan nama file.
