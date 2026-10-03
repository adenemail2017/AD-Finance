/**
 * Settings — profile, appearance, security (PIN lock), data lifecycle,
 * sync configuration, PWA install and storage diagnostics.
 */

import store from '../services/store.js';
import { storageEstimate, requestPersistence, isFallbackMode, persistenceLabel } from '../database/idb.js';
import { exportDataset, importDataset } from '../services/store.js';
import { hasPin, setPin, removePin, lock, pinStrength } from '../services/security.js';
import { esc, on, qs, qsa } from '../utils/dom.js';
import { initialsOf, money, formatPhone, normalizePhone, phoneValid } from '../utils/format.js';
import { icon, iconTile } from '../components/icons.js';
import { APP_VERSION } from '../sw-client.js';
import {
  badgeHtml, confirmDialog, fieldHtml, openAdaptive, progressHtml, toast,
} from '../components/ui.js';
import { animateCounters } from '../components/cards.js';
import { bindCategoryManager, categoryManagerHtml } from '../components/category-manager.js';
import { cacheVersion } from '../sw-client.js';

const CURRENCIES = [
  { value: 'IDR', label: 'IDR — Rupiah Indonesia' },
  { value: 'USD', label: 'USD — US Dollar' },
  { value: 'SGD', label: 'SGD — Singapore Dollar' },
  { value: 'MYR', label: 'MYR — Malaysian Ringgit' },
  { value: 'EUR', label: 'EUR — Euro' },
];

const LOCALES = [
  { value: 'id-ID', label: 'Indonesia (id-ID)' },
  { value: 'en-US', label: 'English US (en-US)' },
  { value: 'en-GB', label: 'English UK (en-GB)' },
];

export const settingsPage = {
  id: 'settings',
  title: 'Settings',
  eyebrow: 'Pengaturan',
  render(root, ctx) {
    let cleanups = [];
    let storage = null;
    let catKind = 'expense';   // category manager tab: 'expense' | 'income'

    async function renderPage() {
      const state = store.state;
      const profile = state.profile;
      const estimate = storage || await storageEstimate();
      storage = estimate;
      const persistGranted = await navigator.storage?.persisted?.().catch(() => false);
      const notifPermission = typeof Notification !== 'undefined' ? Notification.permission : 'unavailable';
      const pinActive = hasPin(state);
      const persistence = persistenceLabel();

      root.innerHTML = `
        <div class="page-enter stack-5">
          <div class="page-head">
            <div><h2>Settings</h2><p>Kelola profil, keamanan, data, dan preferensi aplikasi.</p></div>
            <div class="page-head-actions">
              <button class="btn btn-outline" data-export-json>${icon('download', { size: 17 })} Backup JSON</button>
              <button class="btn btn-outline" data-import-json>${icon('upload', { size: 17 })} Restore</button>
            </div>
          </div>

          ${persistence.tone === 'warn' ? `
            <div class="banner ${persistence.mode.includes('sesi') ? 'is-warn' : ''}">
              ${icon(persistence.mode.includes('sesi') ? 'alert-circle' : 'info', { size: 18 })}
              <div class="grow t-xs"><b>${esc(persistence.mode)}.</b> ${esc(persistence.desc)}</div>
            </div>` : ''}

          <div class="bento">
            <section class="card col-6">
              <div class="card-head">
                <div><h3>Profil &amp; Format</h3><div class="card-sub">Nama, mata uang dan format angka</div></div>
                ${iconTile('users', { color: 'var(--brand-500)', size: 34, radius: 11, iconSize: 17 })}
              </div>
              <div class="stack-4">
                ${fieldHtml({ label: 'Nama', name: 'name', id: 'set-name', control: `<input class="input" id="set-name" data-name value="${esc(profile.name)}" maxlength="60" />` })}
                ${fieldHtml({ label: 'Nomor Telepon', name: 'phone', id: 'set-phone', control: `<input class="input" type="tel" inputmode="tel" id="set-phone" data-phone value="${esc(formatPhone(profile.phone || ''))}" placeholder="cth. 0812-3456-7890" maxlength="20" />`, hint: 'Identitas pengguna di perangkat ini' })}
                ${fieldHtml({ label: 'Email (opsional)', name: 'email', id: 'set-email', control: `<input class="input" type="email" id="set-email" data-email value="${esc(profile.email || '')}" placeholder="nama@email.com" />` })}
                <div class="grid grid-2">
                  ${fieldHtml({ label: 'Mata Uang', name: 'currency', id: 'set-currency', control: `<select class="select" id="set-currency" data-currency>${CURRENCIES.map((c) => `<option value="${esc(c.value)}" ${c.value === profile.currency ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select>` })}
                  ${fieldHtml({ label: 'Format Angka', name: 'locale', id: 'set-locale', control: `<select class="select" id="set-locale" data-locale>${LOCALES.map((l) => `<option value="${esc(l.value)}" ${l.value === profile.locale ? 'selected' : ''}>${esc(l.label)}</option>`).join('')}</select>` })}
                </div>
                <button class="btn btn-primary" data-save-profile>${icon('check', { size: 17 })} Simpan Profil</button>
              </div>
            </section>

            <section class="card col-6">
              <div class="card-head">
                <div><h3>Tampilan</h3><div class="card-sub">Mode terang, gelap, atau ikuti sistem</div></div>
                ${iconTile('sun', { color: 'var(--warn)', size: 34, radius: 11, iconSize: 17 })}
              </div>
              <div class="stack-3">
                ${[['system', 'Ikuti Sistem', 'monitor'], ['light', 'Terang', 'sun'], ['dark', 'Gelap', 'moon']].map(([value, label, iconName]) => `
                  <button class="theme-preview ${profile.theme === value ? 'is-active' : ''}" data-theme-opt="${value}">
                    <span class="theme-swatch ${value}"></span>
                    ${icon(iconName, { size: 18 })}
                    <span class="grow t-sm t-semibold">${esc(label)}</span>
                    ${profile.theme === value ? icon('check', { size: 17 }) : ''}
                  </button>`).join('')}
              </div>
              <div class="card-foot">
                <div class="field">
                  <span class="field-label">Ambang saldo rendah</span>
                  <div class="input-group">
                    <span class="input-prefix">Rp</span>
                    <input class="input" style="padding-left:44px" data-threshold inputmode="numeric"
                      value="${Number(profile.low_balance_threshold || 0).toLocaleString('id-ID')}" aria-label="Ambang saldo rendah" />
                  </div>
                  <span class="field-hint">Notifikasi muncul saat saldo akun berada di bawah nilai ini.</span>
                </div>
                <button class="btn btn-outline btn-block mt-3" data-save-prefs>Simpan Preferensi</button>
              </div>
            </section>
          </div>

          <div class="bento">
            <section class="card col-6">
              <div class="card-head">
                <div><h3>Keamanan</h3><div class="card-sub">Kunci aplikasi dengan PIN lokal</div></div>
                ${badgeHtml(pinActive ? 'PIN aktif' : 'Tanpa PIN', pinActive ? 'pos' : 'outline', { icon: pinActive ? 'lock' : 'alert' })}
              </div>
              <div class="stack-3">
                <div class="banner">${icon('lock', { size: 18 })}<div class="grow t-xs">
                  PIN disimpan di perangkat ini sebagai hash (SHA-256 + salt), tidak pernah dikirim ke mana pun.
                  Semua data keuangan tersimpan lokal di perangkat Anda.
                </div></div>
                ${fieldHtml({ label: pinActive ? 'PIN lama' : 'PIN baru', name: 'pin', id: 'set-pin', hint: pinActive ? '' : '4–8 digit angka', control: `<input class="input" id="set-pin" data-pin inputmode="numeric" type="password" maxlength="8" placeholder="••••" autocomplete="off" />` })}
                <div data-pin-strength class="t-2xs t-dim"></div>
                ${pinActive ? fieldHtml({ label: 'PIN baru (kosongkan jika tidak diubah)', name: 'pin2', id: 'set-pin2', control: '<input class="input" id="set-pin2" data-pin2 inputmode="numeric" type="password" maxlength="8" placeholder="••••" autocomplete="off" />' }) : ''}
                <div class="row gap-2 wrap">
                  <button class="btn btn-primary" data-save-pin>${pinActive ? 'Ubah PIN' : 'Aktifkan PIN'}</button>
                  ${pinActive ? `<button class="btn btn-outline" data-lock-now>${icon('lock', { size: 16 })} Kunci sekarang</button>
                    <button class="btn btn-danger-soft" data-remove-pin>${icon('trash', { size: 16 })} Hapus PIN</button>` : ''}
                </div>
              </div>
            </section>

            <section class="card col-6">
              <div class="card-head">
                <div><h3>PWA &amp; Penyimpanan</h3><div class="card-sub">Install, offline, dan kapasitas data</div></div>
                ${badgeHtml(estimate?.mode || 'IndexedDB', 'info')}
              </div>
              <div class="stack-3">
                <div class="row-between"><span class="t-sm">Status aplikasi</span>
                  ${badgeHtml(window.matchMedia('(display-mode: standalone)').matches ? 'Terinstall (standalone)' : 'Berjalan di browser', 'brand', { icon: 'globe' })}</div>
                <div class="row-between"><span class="t-sm">Service worker</span>
                  <span class="t-xs t-mono">${esc(cacheVersion())}</span></div>
                <div class="row-between"><span class="t-sm">Database</span>
                  <span class="t-xs">${esc(estimate?.mode || '—')} ${isFallbackMode() ? '(fallback: storage browser dibatasi)' : ''}</span></div>
                ${estimate ? `<div class="stack-2">
                  <div class="row-between t-xs"><span class="t-dim">Pemakaian ${esc((estimate.usage / 1024 / 1024).toFixed(2))} MB</span>
                    <span class="t-dim">Kuota ${esc((estimate.quota / 1024 / 1024).toFixed(0))} MB</span></div>
                  ${progressHtml(estimate.percent, { tone: estimate.percent > 80 ? 'warn' : 'pos' })}
                </div>` : ''}
                <div class="row gap-2 wrap">
                  <button class="btn btn-primary" data-install hidden>${icon('download', { size: 17 })} Install Aplikasi</button>
                  <button class="btn btn-outline" data-persist>${icon('shield', { size: 17 })} ${persistGranted ? 'Penyimpanan persisten aktif' : 'Minta penyimpanan persisten'}</button>
                  <button class="btn btn-outline" data-check-sw>${icon('refresh', { size: 17 })} Cek update</button>
                </div>
                <div class="banner is-warn">${icon('wifi-off', { size: 18 })}<div class="grow t-xs">
                  Saat offline, transaksi tetap tersimpan di perangkat dan otomatis masuk antrean sinkronisasi.
                  ${state.sync.pending ? `<strong>${state.sync.pending} perubahan menunggu sinkron.</strong>` : ''}
                </div></div>
              </div>
            </section>
          </div>

          <div class="bento">
            <section class="card col-5 tint-brand" data-user-card>
              <div class="card-head">
                <div><h3>Pengguna</h3><div class="card-sub">${(state.users || []).length} workspace terpisah di perangkat ini</div></div>
                ${iconTile('users', { color: 'var(--brand-500)', size: 34, radius: 11, iconSize: 17 })}
              </div>
              <div class="stack-3" data-user-list>
                ${(state.users || []).map((u) => `<div class="user-row ${u.id === state.profile.id ? 'is-active' : ''}" data-user-row="${esc(u.id)}">
                  <span class="avatar">${esc(initialsOf(u.name))}</span>
                  <div class="grow" style="min-width:0">
                    <div class="t-sm t-semibold t-clip">${esc(u.name)}</div>
                    <div class="t-2xs t-dim">${u.phone ? `${esc(formatPhone(u.phone))} · ` : ''}${u.id === state.profile.id ? 'Sedang aktif' : 'Tersimpan di perangkat ini'}</div>
                  </div>
                  ${u.id === state.profile.id ? badgeHtml('Aktif', 'pos', { icon: 'circle-check' })
    : `<button class="btn btn-sm btn-outline" data-switch-user="${esc(u.id)}">Ganti</button>`}
                </div>`).join('')}
              </div>
              <div class="card-foot">
                <div class="row wrap gap-2">
                  <button class="btn btn-primary" data-add-user>${icon('plus', { size: 16 })} Tambah pengguna</button>
                  <button class="btn btn-outline" data-manage-users>${icon('settings', { size: 16 })} Kelola</button>
                </div>
                <div class="t-2xs t-dim mt-2">Nama pengguna aktif: <b>${esc(state.profile.name)}</b> — ubah di kartu Profil. Setiap pengguna punya akun, transaksi, dan budget sendiri.</div>
              </div>
            </section>

            <section class="card col-7">
              <div class="card-head">
                <div><h3>Data Keuangan</h3><div class="card-sub">Export, restore, dan reset</div></div>
                ${iconTile('layers', { color: 'var(--accent)', size: 34, radius: 11, iconSize: 17 })}
              </div>
              <div class="grid grid-2">
                <div class="stat-box"><div class="stat-label">Transaksi</div><div class="stat-value">${state.transactions.length}</div></div>
                <div class="stat-box"><div class="stat-label">Akun</div><div class="stat-value">${state.accounts.length}</div></div>
                <div class="stat-box"><div class="stat-label">Kategori</div><div class="stat-value">${state.categories.length}</div></div>
                <div class="stat-box"><div class="stat-label">Hutang / Piutang</div><div class="stat-value">${state.debts.length} / ${state.receivables.length}</div></div>
              </div>
              <div class="card-foot">
                <div class="row wrap gap-2">
                  <button class="btn btn-outline" data-export-json>${icon('download', { size: 16 })} Backup JSON</button>
                  <button class="btn btn-outline" data-import-json>${icon('upload', { size: 16 })} Restore dari backup</button>
                  <button class="btn btn-soft" data-load-demo>${icon('sparkles', { size: 16 })} Muat data contoh</button>
                  <button class="btn btn-warn" data-fresh>${icon('refresh', { size: 16 })} Mulai dari nol</button>
                  <button class="btn btn-danger" data-wipe>${icon('trash', { size: 16 })} Hapus semua data</button>
                </div>
                ${state.demo ? `<div class="banner is-warn mt-3">${icon('sparkles', { size: 18 })}<div class="grow t-xs">
                  Data contoh sedang aktif (5 bulan riwayat). Gunakan "Mulai dari nol" untuk memulai dengan data Anda sendiri.</div></div>` : ''}
              </div>
            </section>

            <section class="card col-5">
              <div class="card-head">
                <div><h3>Sinkronisasi Server</h3><div class="card-sub">Opsional — aplikasi berjalan lokal tanpa server</div></div>
                ${badgeHtml(state.sync.online ? 'Online' : 'Offline', state.sync.online ? 'pos' : 'warn', { icon: state.sync.online ? 'wifi' : 'wifi-off' })}
              </div>
              <div class="stack-3">
                ${fieldHtml({
    label: 'Endpoint API (opsional)', name: 'sync_endpoint', id: 'set-sync',
    hint: 'Contoh: https://api.domain.com. Kosongkan untuk mode lokal penuh.',
    control: `<input class="input" id="set-sync" data-sync value="${esc(state.settings.sync_endpoint || '')}" placeholder="https://api.example.com" />`,
  })}
                <button class="btn btn-outline" data-save-sync>Simpan Endpoint</button>
                <div class="stat-box">
                  <div class="stat-label">Antrean perubahan</div>
                  <div class="stat-value">${state.sync.pending}</div>
                  <div class="t-2xs t-dim mt-1">${state.sync.lastSync ? `Sinkron terakhir ${esc(new Date(state.sync.lastSync).toLocaleString('id-ID'))}` : 'Belum pernah sinkron'}</div>
                </div>
                <button class="btn btn-primary btn-block" data-flush>${icon('refresh', { size: 16 })} Sinkron sekarang</button>
              </div>
            </section>
          </div>

          <div class="bento">
            <section class="card col-6">
              <div class="card-head">
                <div><h3>Notifikasi</h3><div class="card-sub">Pengingat jatuh tempo, budget, dan laporan</div></div>
                ${badgeHtml(notifPermission === 'granted' ? 'Diizinkan' : notifPermission === 'denied' ? 'Diblokir' : 'Belum diatur',
    notifPermission === 'granted' ? 'pos' : notifPermission === 'denied' ? 'neg' : 'warn', { icon: 'bell' })}
              </div>
              <div class="stack-3">
                <div class="banner">${icon('bell', { size: 18 })}<div class="grow t-xs">
                  Notifikasi dalam aplikasi aktif secara default (hutang/piutang jatuh tempo, budget 80%/100%, saldo rendah, laporan bulanan siap).
                  Izinkan browser notification agar pengingat juga muncul saat aplikasi tertutup.
                </div></div>
                <div class="row gap-2 wrap">
                  <button class="btn btn-primary" data-enable-notif>${icon('bell', { size: 16 })} Izinkan notifikasi browser</button>
                  <button class="btn btn-outline" data-test-notif>${icon('info', { size: 16 })} Kirim contoh</button>
                  <button class="btn btn-ghost" data-clear-notif>${icon('trash', { size: 16 })} Bersihkan daftar</button>
                </div>
              </div>
            </section>

            <section class="card col-6">
              <div class="card-head">
                <div><h3>Tentang Aplikasi</h3><div class="card-sub">AD-Finance v${esc(APP_VERSION)} · Developer Ade Nurrahman</div></div>
                ${iconTile('sparkles', { color: 'var(--accent)', size: 34, radius: 11, iconSize: 17 })}
              </div>
              <dl class="kv">
                <dt>Versi</dt><dd>v${esc(APP_VERSION)} · build ${esc(APP_VERSION)} (PWA offline-first)</dd>
                <dt>Developer</dt><dd><b>Ade Nurrahman</b></dd>
                <dt>Arsitektur</dt><dd>PWA offline-first · vanilla ESM modular</dd>
                <dt>Penyimpanan</dt><dd>${esc(persistence.mode)}${isFallbackMode() ? ' (fallback)' : ' · IndexedDB'}</dd>
                <dt>Uang</dt><dd>Integer minor unit, tanpa error pembulatan float</dd>
                <dt>Akuntansi</dt><dd>Transfer tidak dihitung income/expense · net worth selalu konsisten</dd>
                <dt>Shortcut</dt><dd class="t-xs">
                  <span class="kbd">⌘/Ctrl</span> + <span class="kbd">K</span> cari ·
                  <span class="kbd">N</span> transaksi baru ·
                  <span class="kbd">1</span>–<span class="kbd">7</span> navigasi ·
                  <span class="kbd">Esc</span> tutup dialog ·
                  <span class="kbd">D</span> mode gelap
                </dd>
              </dl>
              <div class="card-foot row gap-2 wrap">
                <button class="btn btn-soft btn-sm" data-shortcuts>${icon('info', { size: 15 })} Lihat semua shortcut</button>
                <button class="btn btn-ghost btn-sm" data-lock-now>${icon('lock', { size: 15 })} Kunci aplikasi</button>
              </div>
            </section>

            ${categoryManagerHtml(state, catKind)}
          </div>
        </div>
      `;

      animateCounters(root);
      cleanups.forEach((fn) => fn?.());
      cleanups = bind();
    }

    function bind() {
      const state = store.state;
      return [
        ...bindCategoryManager(root, ctx, {
          kind: catKind,
          onKindChange: (next) => { catKind = next; renderPage(); },
          rerender: () => renderPage(),
        }),
        on(root, 'click', '[data-save-profile]', async (event, el) => {
          const phoneInput = qs('[data-phone]', root);
          const phone = phoneInput?.value ?? state.profile.phone ?? '';
          if (!phoneValid(phone)) {
            toast('Nomor telepon belum benar. Contoh: 0812-3456-7890.', { tone: 'warn', title: 'Cek lagi' });
            phoneInput?.classList.add('is-invalid');
            phoneInput?.focus();
            return;
          }
          phoneInput?.classList.remove('is-invalid');
          await store.updateProfile({
            name: qs('[data-name]', root).value.trim() || 'Pemilik Akun',
            phone: normalizePhone(phone),
            email: qs('[data-email]', root).value.trim(),
            currency: qs('[data-currency]', root).value,
            locale: qs('[data-locale]', root).value,
          });
          toast('Profil disimpan.', { tone: 'pos', title: 'Berhasil' });
          ctx.rerender();
        }),
        on(root, 'click', '[data-theme-opt]', async (event, el) => {
          await store.updateProfile({ theme: el.dataset.themeOpt });
          ctx.setTheme?.(el.dataset.themeOpt);
          renderPage();
        }),
        on(root, 'click', '[data-save-prefs]', async () => {
          const threshold = Number(qs('[data-threshold]', root).value.replace(/[^\d]/g, '')) || 0;
          await store.updateProfile({ low_balance_threshold: threshold });
          toast('Preferensi disimpan.', { tone: 'pos' });
        }),
        on(root, 'input', '[data-threshold]', (event, el) => {
          const digits = el.value.replace(/[^\d]/g, '');
          el.value = digits ? Number(digits).toLocaleString('id-ID') : '';
        }),
        on(root, 'input', '[data-pin]', (event, el) => {
          const strength = pinStrength(el.value);
          const host = qs('[data-pin-strength]', root);
          host.textContent = el.value ? `Kekuatan PIN: ${strength.label}` : '';
          host.className = `t-2xs t-${strength.tone === 'pos' ? 'pos' : strength.tone === 'neg' ? 'neg' : 'warn'}`;
        }),
        on(root, 'click', '[data-save-pin]', async () => {
          const pinActive = hasPin(store.state);
          // [data-pin]  = PIN lama when one exists, otherwise the PIN to create
          // [data-pin2] = the replacement PIN (empty ⇒ leave the PIN untouched)
          const entered = qs('[data-pin]', root).value;
          const replacement = qs('[data-pin2]', root)?.value || '';
          const nextPin = pinActive ? replacement : entered;

          if (pinActive && !replacement) {
            toast('Tidak ada perubahan: isi kolom PIN baru untuk mengganti PIN.', { tone: 'info', title: 'PIN tidak diubah' });
            return;
          }
          if (pinStrength(nextPin).score <= 0) { toast('PIN minimal 4 digit angka.', { tone: 'warn' }); return; }

          // currentPin is only meaningful when a PIN already exists
          const result = await setPin(nextPin, pinActive ? entered : null);
          if (!result.ok) { toast(result.error, { tone: 'neg', title: 'Gagal menyimpan PIN' }); return; }
          toast(pinActive ? 'PIN diperbarui.' : 'PIN diaktifkan. Aplikasi akan meminta PIN saat dibuka.', { tone: 'pos', title: 'Keamanan aktif' });
          renderPage();
        }),
        on(root, 'click', '[data-remove-pin]', async () => {
          const pin = qs('[data-pin]', root).value;
          const result = await removePin(pin);
          if (!result.ok) { toast(result.error, { tone: 'neg' }); return; }
          toast('PIN dihapus.', { tone: 'info' });
          renderPage();
        }),
        on(root, 'click', '[data-lock-now]', () => {
          lock();
          ctx.lockApp?.();
        }),
        on(root, 'click', '[data-export-json]', () => {
          const data = exportDataset();
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `personal-finance-os-backup-${new Date().toISOString().slice(0, 10)}.json`;
          a.click();
          URL.revokeObjectURL(url);
          toast('Backup JSON diunduh.', { tone: 'pos', title: 'Backup selesai' });
        }),
        on(root, 'click', '[data-import-json]', () => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'application/json';
          input.addEventListener('change', async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
              const text = await file.text();
              const parsed = JSON.parse(text);
              const count = await importDataset(parsed);
              toast(`${count} baris data dipulihkan.`, { tone: 'pos', title: 'Restore selesai' });
              ctx.rerender();
            } catch (error) {
              toast('File backup tidak valid.', { tone: 'neg', title: 'Gagal restore' });
              console.error(error);
            }
          });
          input.click();
        }),
        on(root, 'click', '[data-add-user]', () => window.__pfos?.openUserForm?.()),
        on(root, 'click', '[data-manage-users]', () => window.__pfos?.openUserManager?.()),
        on(root, 'click', '[data-switch-user]', async (event, el) => {
          try {
            const profile = await store.switchUser(el.dataset.switchUser);
            toast(`Beralih ke ${profile.name}.`, { tone: 'info' });
            ctx.rerender();
          } catch (error) {
            toast(error?.message || 'Gagal berpindah pengguna.', { tone: 'neg' });
          }
        }),
        on(root, 'click', '[data-load-demo]', async () => {
          const yes = await confirmDialog({
            title: 'Muat data contoh?',
            message: 'Seluruh transaksi, akun, hutang, dan piutang saat ini akan diganti dengan dataset contoh 5 bulan.',
            confirmText: 'Muat data contoh', iconName: 'sparkles',
          });
          if (!yes) return;
          await store.loadDemoData();
          toast('Data contoh dimuat.', { tone: 'pos' });
          ctx.rerender();
        }),
        on(root, 'click', '[data-fresh]', async () => {
          const yes = await confirmDialog({
            title: 'Mulai dari nol?',
            message: 'Semua transaksi, hutang, piutang dan budget akan dihapus. Kategori default dan satu akun Cash Wallet tetap dibuat. Tindakan ini tidak bisa dibatalkan.',
            confirmText: 'Mulai dari nol', tone: 'danger', iconName: 'refresh',
          });
          if (!yes) return;
          await store.startFresh({ keepCategories: true, openingBalance: 0 });
          toast('Workspace kosong siap dipakai.', { tone: 'pos', title: 'Selesai' });
          ctx.rerender();
        }),
        on(root, 'click', '[data-wipe]', async () => {
          const yes = await confirmDialog({
            title: 'Hapus SEMUA data?',
            message: 'Seluruh data pengguna yang sedang aktif akan dihapus (pengguna lain tidak terpengaruh). Pastikan Anda sudah membuat backup.',
            confirmText: 'Hapus semuanya', tone: 'danger', iconName: 'trash',
          });
          if (!yes) return;
          await store.wipeEverything();
          toast('Data dihapus dan diinisialisasi ulang.', { tone: 'warn' });
          ctx.rerender();
        }),
        on(root, 'click', '[data-save-sync]', async () => {
          await store.setSetting('sync_endpoint', qs('[data-sync]', root).value.trim());
          toast('Endpoint sinkronisasi disimpan.', { tone: 'pos' });
        }),
        on(root, 'click', '[data-flush]', async () => {
          const result = await store.flushOutbox();
          if (result.error) toast(result.error, { tone: 'neg', title: 'Sinkron gagal' });
          else if (result.pushed) toast(`${result.pushed} perubahan terkirim.`, { tone: 'pos' });
          else toast('Tidak ada endpoint server — semua data tersimpan lokal.', { tone: 'info' });
          renderPage();
        }),
        on(root, 'click', '[data-persist]', async () => {
          const granted = await requestPersistence();
          toast(granted ? 'Penyimpanan persisten aktif — data tidak akan dibersihkan browser.' : 'Browser belum memberikan penyimpanan persisten.', { tone: granted ? 'pos' : 'warn' });
          renderPage();
        }),
        on(root, 'click', '[data-install]', () => window.__pfos?.installPWA?.()),
        on(root, 'click', '[data-check-sw]', async () => {
          const ok = await window.__pfos?.checkForUpdate?.();
          toast(ok ? 'Aplikasi diperbarui ke versi terbaru.' : 'Aplikasi sudah versi terbaru.', { tone: ok ? 'pos' : 'info' });
        }),
        on(root, 'click', '[data-enable-notif]', async () => {
          if (typeof Notification === 'undefined') { toast('Browser ini tidak mendukung notifikasi.', { tone: 'warn' }); return; }
          const permission = await Notification.requestPermission();
          if (permission === 'granted') {
            toast('Notifikasi browser diizinkan.', { tone: 'pos' });
            new Notification('AD-Finance', { body: 'Notifikasi aktif — pengingat jatuh tempo & budget akan muncul di sini.' });
          } else toast('Izin notifikasi ditolak.', { tone: 'warn' });
          renderPage();
        }),
        on(root, 'click', '[data-test-notif]', () => {
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            new Notification('Budget Food hampir habis', { body: 'Terpakai 84% dari Rp 2.500.000 bulan ini.' });
          } else {
            toast('Izinkan notifikasi browser terlebih dahulu.', { tone: 'warn' });
          }
        }),
        on(root, 'click', '[data-clear-notif]', async () => {
          await store.clearNotifications();
          toast('Daftar notifikasi dibersihkan.', { tone: 'info' });
        }),
        on(root, 'click', '[data-shortcuts]', () => openShortcutsSheet()),
      ];
    }

    renderPage();
    // install button visibility (fires when beforeinstallprompt has been captured)
    const installBtn = () => qs('[data-install]', root);
    const syncInstall = () => {
      const btn = installBtn();
      if (btn && window.__pfos?.canInstall?.()) btn.hidden = false;
    };
    syncInstall();
    window.addEventListener('pfos:installable', syncInstall);
    cleanups.push(() => window.removeEventListener('pfos:installable', syncInstall));

    return () => cleanups.forEach((fn) => fn?.());
  },
};

export function openShortcutsSheet() {
  const rows = [
    ['⌘/Ctrl + K', 'Buka pencarian global'],
    ['N', 'Transaksi baru'],
    ['1 … 7', 'Navigasi: Dashboard, Transactions, Accounts, Debts, Reports, Analytics, Budget'],
    ['D', 'Ganti mode terang/gelap'],
    ['Esc', 'Tutup dialog / sheet'],
    ['Enter', 'Simpan nominal pada form transaksi'],
    ['⌘/Ctrl + Enter', 'Simpan transaksi dari mana pun di form'],
  ];
  openAdaptive({
    title: 'Keyboard Shortcuts',
    iconName: 'badge-check',
    size: 'sm',
    body: `<div class="stack-3">${rows.map(([key, desc]) => `
      <div class="row-between"><span class="t-sm">${esc(desc)}</span><span class="kbd">${esc(key)}</span></div>`).join('')}</div>`,
  });
}

export { money };
export default settingsPage;
