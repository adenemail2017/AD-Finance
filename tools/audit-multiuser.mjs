/**
 * tools/audit-multiuser.mjs — uji multi-pengguna di browser sungguhan.
 *
 * Membuktikan alur yang diminta pengguna:
 *   perangkat baru → wajib isi nama → workspace mulai KOSONG →
 *   pengguna kedua punya ruang sendiri → pindah/rename/hapus aman.
 *
 * Jalankan (butuh puppeteer-core + Chromium):
 *   PUPPETEER_EXECUTABLE_PATH=/path/ke/chrome node tools/audit-multiuser.mjs http://localhost:4173
 */
import { mkdir } from 'node:fs/promises';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';


const URL = (process.argv.find((a) => a.startsWith('http')) || 'http://localhost:4173').replace(/\/$/, '');
const EXECUTABLE = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH;
if (!EXECUTABLE) {
  console.error('Tentukan browser-nya lebih dulu, mis.:\n'
    + '  PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome node tools/audit-multiuser.mjs ' + URL);
  process.exit(2);
}
const LAUNCH = {
  args: [...chromium.args, '--no-sandbox'], executablePath: EXECUTABLE, headless: true,
  protocolTimeout: 60000,
  env: { ...process.env, LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH || '/tmp/al2023/lib' },
};
const browser = await puppeteer.launch(LAUNCH);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const hasil = [];
const cek = (label, ok, detail = '') => hasil.push(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
const step = (n) => process.stderr.write(`… ${n}\n`);
const SHOTS = process.env.SHOTS_DIR || 'preview/shots';
await mkdir(SHOTS, { recursive: true });
const jepret = async (name, full = false, target = page) => {
  try { await target.screenshot({ path: `${SHOTS}/${name}`, fullPage: full }); }
  catch (e) { process.stderr.write(`  (tangkapan ${name} dilewati: ${e.message})\n`); }
};

const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForFunction(() => Boolean(window.__pfos), { timeout: 45000 });
await page.evaluate(() => {
  window.__run = (p) => {
    window.__op = 'pending'; window.__err = '';
    Promise.resolve(p).then(() => { window.__op = 'done'; }).catch((e) => { window.__op = 'error'; window.__err = String((e && e.message) || e); });
  };
});
/** Jalankan operasi async di halaman lalu tunggu sampai selesai (aman dari Promise was collected). */
const run = async (fn, arg) => {
  await page.evaluate(new Function('arg', `window.__run((${fn})(arg));`), arg);
  await page.waitForFunction(() => window.__op !== 'pending', { timeout: 30000 });
  return page.evaluate(() => ({ op: window.__op, err: window.__err }));
};
const state = () => page.evaluate(() => ({
  siap: !window.__pfos.needsUser(),
  users: window.__pfos.getState().users.length,
  nama: window.__pfos.getState().profile.name,
  akun: window.__pfos.getState().accounts.length,
  trx: window.__pfos.getState().transactions.length,
  kategori: window.__pfos.getState().categories.length,
  phone: window.__pfos.getState().profile.phone,
}));
await wait(600);

// ── 1. gerbang perkenalan ────────────────────────────────────────────
step('1 gerbang');
const gate = await page.evaluate(() => {
  const teks = document.querySelector('.onboard-card')?.textContent || '';
  return {
    ada: Boolean(document.querySelector('.onboarding')),
    appKosong: !document.querySelector('#view .card'),
    nama: /Nama Anda/.test(teks),
    telp: /Nomor Telepon/.test(teks),
    radio: document.querySelectorAll('input[name="onboard-mode"]').length,
    tanyaMode: /Mulai dari mana/i.test(teks),
  };
});
cek('perangkat baru diblokir layar perkenalan', gate.ada && gate.appKosong);
cek('form perkenalan hanya meminta nama + nomor telepon', gate.nama && gate.telp, `nama=${gate.nama} telp=${gate.telp}`);
cek('pilihan "Mulai dari mana?" sudah tidak ada', gate.radio === 0 && !gate.tanyaMode);
await jepret('u1-perkenalan.png');

// ── 2. form kosong / nomor salah ditolak, lalu buat pengguna pertama ─
step('2 form kosong');
await page.evaluate(() => document.querySelector('[data-onboard-submit]').dispatchEvent(new MouseEvent('click', { bubbles: true })));
await wait(300);
const kosong = await page.evaluate(() => ({
  nama: document.querySelector('[data-onboard-error]')?.hidden === false,
  telp: document.querySelector('[data-onboard-phone-error]')?.hidden === false,
  needsUser: window.__pfos.needsUser(),
}));
cek('nama & nomor telepon kosong ditolak dengan pesan', kosong.nama && kosong.telp && kosong.needsUser);

step('2a nomor telepon tidak masuk akal');
await page.evaluate(() => {
  const i = document.querySelector('[data-onboard-name]');
  i.value = 'Ade Nurrahman'; i.dispatchEvent(new Event('input', { bubbles: true }));
  const t = document.querySelector('[data-onboard-phone]');
  t.value = '123'; t.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('[data-onboard-submit]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await wait(400);
const telpSalah = await page.evaluate(() => ({
  pesan: (document.querySelector('[data-onboard-phone-error]')?.textContent || '').trim(),
  hidden: document.querySelector('[data-onboard-phone-error]')?.hidden,
  needsUser: window.__pfos.needsUser(),
}));
cek('nomor telepon salah ditolak + contoh format ditampilkan',
  telpSalah.hidden === false && /0812-3456-7890/.test(telpSalah.pesan) && telpSalah.needsUser, telpSalah.pesan);
await jepret('u7-telp-salah.png');

step('2b buat pengguna pertama');
await page.evaluate(() => {
  const t = document.querySelector('[data-onboard-phone]');
  t.value = '0812 3456 7890'; t.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('[data-onboard-submit]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
for (let i = 0; i < 40; i += 1) { await wait(400); if ((await state()).siap) break; }
await wait(700);
const pertama = await state();
const view1 = await page.evaluate(() => ({
  panduan: Boolean(document.querySelector('[data-first-run]')),
  nama: (document.querySelector('.atm-holder')?.textContent || '').trim(),
}));
cek('pengguna baru mulai dengan 0 akun & 0 transaksi', pertama.akun === 0 && pertama.trx === 0, `${pertama.akun} akun · ${pertama.trx} transaksi`);
cek('nomor telepon tersimpan ternormalisasi (0812-3456-7890 → 081234567890)', pertama.phone === '081234567890', pertama.phone);
cek('kategori bawaan tersedia untuk mulai mencatat', pertama.kategori > 0, `${pertama.kategori} kategori`);
cek('beranda menampilkan panduan 3 langkah', view1.panduan);
cek('kartu saldo memakai nama pengguna', /ade nurrahman/i.test(view1.nama), view1.nama);
await jepret('u2-kosong.png', true);

// ── 3. pengguna kedua + isolasi data ────────────────────────────────
step('3 pengguna kedua');
let r = await run(() => window.__pfos.createUser({ name: 'Rekan Uji', mode: 'empty' }));
cek('pembuatan pengguna kedua berhasil', r.op === 'done', r.err);
await wait(900);
const kedua = await state();
cek('pengguna kedua tercatat & tetap kosong', kedua.users === 2 && kedua.akun === 0 && kedua.trx === 0, `${kedua.users} pengguna`);

step('3b data milik A');
r = await run(() => window.__pfos.switchUser(window.__pfos.getState().users.find((u) => u.name === 'Ade Nurrahman').id));
cek('pindah ke pengguna pertama', r.op === 'done', r.err);
await wait(800);
r = await run(async () => {
  const { default: store } = await import('/src/services/store.js');
  return store.addAccount({ name: 'Tabungan A', account_type: 'bank', opening_balance: 5000000, color: '#2563eb', icon: 'bank' });
});
cek('pengguna pertama dapat menambah akun', r.op === 'done', r.err);
await wait(600);
const akunA = (await state()).akun;
r = await run(() => window.__pfos.switchUser(window.__pfos.getState().users.find((u) => u.name === 'Rekan Uji').id));
cek('pindah ke pengguna kedua', r.op === 'done', r.err);
await wait(800);
const isolasi = await state();
cek('akun pengguna lain tidak bocor ke pengguna kedua', akunA === 1 && isolasi.akun === 0, `A=${akunA} akun · B=${isolasi.akun} akun`);

// ── 4. Settings: kartu Pengguna + tombol Ganti ──────────────────────
step('4 settings');
await page.evaluate(() => window.__pfos.navigate('settings'));
await wait(1000);
const settings = await page.evaluate(() => ({
  kartu: Boolean(document.querySelector('#view [data-user-card]')),
  baris: document.querySelectorAll('#view [data-user-row]').length,
  aktif: document.querySelector('#view [data-user-row].is-active .t-semibold')?.textContent?.trim(),
  badge: document.querySelector('#view [data-user-row].is-active .badge')?.textContent?.trim(),
  tombolGanti: document.querySelectorAll('#view [data-switch-user]').length,
}));
cek('Settings menampilkan kartu Pengguna berisi kedua workspace', settings.kartu && settings.baris === 2, `${settings.baris} baris · aktif: ${settings.aktif}`);
cek('baris pengguna kedua bertanda aktif + badge Aktif', /Rekan Uji/i.test(settings.aktif || '') && /Aktif/i.test(settings.badge || ''), `${settings.aktif} · ${settings.badge}`);
cek('hanya pengguna non-aktif yang punya tombol Ganti', settings.tombolGanti === 1, `${settings.tombolGanti} tombol`);
await jepret('u3-pengguna-settings.png', true);

step('4b tombol Ganti');
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#view [data-user-row]')];
  const target = rows.find((row) => /Ade Nurrahman/i.test(row.textContent));
  (target?.querySelector('[data-switch-user]') || target)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await wait(1200);
const switched = await state();
cek('tombol Ganti memindahkan workspace beserta datanya', switched.nama === 'Ade Nurrahman' && switched.akun === 1, `${switched.nama} · ${switched.akun} akun`);
process.stderr.write('… registry setelah ganti: ' + JSON.stringify(await page.evaluate(() => window.__pfos.getState().users.map((u) => u.name))) + '\n');

// ── 5. rename & hapus pengguna ──────────────────────────────────────
step('5 rename & hapus');
r = await run(() => window.__pfos.renameUser(window.__pfos.getState().users.find((u) => u.name === 'Rekan Uji').id, 'Rekan Diubah'));
cek('ganti nama pengguna tersimpan', r.op === 'done', r.err);
r = await run(() => window.__pfos.deleteUser(window.__pfos.getState().users.find((u) => u.name === 'Rekan Diubah').id));
cek('hapus pengguna berhasil tanpa galat', r.op === 'done', r.err);
await wait(900);
const akhir = await state();
cek('registry bersih & data pengguna aktif tetap utuh', akhir.users === 1 && akhir.akun === 1, `${akhir.users} pengguna · ${akhir.akun} akun`);

await page.close();

// ── 6. perangkat lama (data dari versi sebelumnya) tidak hilang ─────
// Perangkat yang sudah dipakai di versi 2.4 → profil 'local' + baris lama tanpa
// sematan user_id. Harus muncul layar nama dengan pilihan "Pertahankan data
// yang ada", dan datanya utuh setelah nama diisi.
// Browser terpisah dipakai supaya IndexedDB-nya benar-benar bersih.
step('6 perangkat lama');
const browser2 = await puppeteer.launch(LAUNCH);
const page2 = await browser2.newPage();
const errors2 = [];
page2.on('pageerror', (e) => errors2.push(String(e)));
page2.on('console', (m) => { if (m.type() === 'error') errors2.push(m.text()); });
await page2.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page2.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
await page2.waitForFunction(() => Boolean(window.__pfos), { timeout: 45000 });
await wait(500);
step('6a tulis data lama langsung ke IndexedDB');
await page2.evaluate(async () => {
  const open = await new Promise((resolve, reject) => {
    const r = indexedDB.open('pfos');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const put = (store, row) => new Promise((resolve, reject) => {
    const tx = open.transaction(store, 'readwrite');
    tx.objectStore(store).put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  const now = new Date().toISOString();
  await put('profiles', { id: 'local', name: 'Pemilik Akun', currency: 'IDR', locale: 'id-ID', theme: 'system', onboarding_done: false, demo_loaded: true, created_at: now, updated_at: now });
  await put('accounts', { id: 'acc_lama', name: 'BCA Lama', account_type: 'bank', opening_balance: 1500000, color: '#2563eb', icon: 'bank', status: 'active', user_id: 'local', created_at: now, updated_at: now });
  await put('settings', { key: 'theme', value: 'system' });
  open.close();
});
step('6b muat ulang');
await page2.reload({ waitUntil: 'networkidle2' });
await page2.waitForFunction(() => Boolean(window.__pfos), { timeout: 45000 });
await wait(900);
const legacy = await page2.evaluate(() => ({
  gate: Boolean(document.querySelector('.onboarding')),
  radio: document.querySelectorAll('input[name="onboard-mode"]').length,
  teks: (document.querySelector('.onboard-card')?.textContent || ''),
}));
cek('perangkat lama tetap diminta mengisi nama + telepon', legacy.gate && legacy.radio === 0);
cek('layar menjelaskan data lama akan dipertahankan (tanpa pilihan radion)',
  /akan dipertahankan/.test(legacy.teks) && /1 akun/.test(legacy.teks), legacy.teks.replace(/\s+/g, ' ').slice(-90));
await jepret('u4-perangkat-lama.png', false, page2);
step('6c isi nama + telepon');
await page2.evaluate(() => {
  const i = document.querySelector('[data-onboard-name]');
  i.value = 'Ade Pemilik Lama'; i.dispatchEvent(new Event('input', { bubbles: true }));
  const t = document.querySelector('[data-onboard-phone]');
  t.value = '081298765432'; t.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('[data-onboard-submit]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
for (let i = 0; i < 30; i += 1) {
  await wait(400);
  const siap = await page2.evaluate(() => !window.__pfos.needsUser() && Boolean(document.querySelector('#view .card'))).catch(() => false);
  if (siap) break;
}
await wait(700);
const legacySetelah = await page2.evaluate(() => ({
  akun: window.__pfos.getState().accounts.length,
  kartu: (document.querySelector('.atm-holder')?.textContent || '').trim(),
  phone: window.__pfos.getState().profile.phone,
}));
cek('data lama dipertahankan setelah mengisi nama', legacySetelah.akun === 1, `${legacySetelah.akun} akun lama`);
cek('nama baru dipakai di kartu saldo', /ade pemilik lama/i.test(legacySetelah.kartu), legacySetelah.kartu);
cek('nomor telepon perangkat lama ikut tersimpan', legacySetelah.phone === '081298765432', legacySetelah.phone);
await browser2.close();

cek('tidak ada error konsol', errors.length === 0 && errors2.length === 0, [...errors, ...errors2].slice(0, 2).join(' | '));
console.log(hasil.join('\n'));
await browser.close();
process.exit(hasil.some((h) => h.startsWith('✗')) ? 1 : 0);
