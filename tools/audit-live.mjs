/**
 * audit-live.mjs — memeriksa deployment AD-Finance yang sudah live.
 *
 *   node tools/audit-live.mjs https://ad-finance-phi.vercel.app
 *   node tools/audit-live.mjs https://domain-anda.com --keep
 *
 * Yang diperiksa (semuanya dari internet, bukan dari berkas lokal):
 *   1. Halaman utama + identitas merek.
 *   2. Header `vercel.json` benar-benar diterapkan (SW, manifest, aset, keamanan).
 *   3. Seluruh entri precache service worker bisa diunduh → offline pasti bekerja.
 *   4. Berkas lokal (tests/, tools/, docs/, server/) TIDAK ikut terekspos.
 *   5. Aplikasi di-boot di jsdom memakai berkas yang diunduh dari produksi.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const args = process.argv.slice(2);
const KEEP = args.includes('--keep');
const BASE = (args.find((a) => a.startsWith('http')) || '').replace(/\/$/, '');

const bold = (s) => `\u001b[1m${s}\u001b[0m`;
const ok = (s) => console.log(`  \u001b[32m✓\u001b[0m ${s}`);
const bad = (s) => console.log(`  \u001b[31m✗\u001b[0m ${s}`);
const info = (s) => console.log(`  \u001b[2m·\u001b[0m ${s}`);

const problems = [];
const fail = (label) => { problems.push(label); bad(label); };

if (!BASE) {
  console.error('Pakai: node tools/audit-live.mjs <url>   contoh: node tools/audit-live.mjs https://ad-finance-phi.vercel.app');
  process.exit(2);
}

console.log(bold(`\nAD-Finance — audit produksi\n${BASE}\n`));

/* 1 ─ halaman utama ------------------------------------------------------- */
console.log(bold('1. Halaman utama'));
const homeRes = await fetch(`${BASE}/`, { redirect: 'follow' });
const home = await homeRes.text();
homeRes.ok ? ok(`/ → ${homeRes.status} · ${(home.length / 1024).toFixed(1)} KB`) : fail(`/ → ${homeRes.status}`);
(/<title>AD-Finance/.test(home) ? ok : fail)('judul dokumen memakai merek AD-Finance');
(/application-name" content="AD-Finance"/.test(home) ? ok : fail)('meta application-name = AD-Finance');
(/<script type="module" src="src\/app\.js">/.test(home) ? ok : fail)('entry script PWA terpasang');

/* 2 ─ header -------------------------------------------------------------- */
console.log(bold('\n2. Header produksi (vercel.json)'));
const head = async (path) => {
  const res = await fetch(`${BASE}${path}`, { method: 'GET' });
  return { status: res.status, h: res.headers };
};
const sw = await head('/sw.js');
const expect = (label, value, pattern) => (pattern.test(value || '') ? ok(`${label}: ${value}`) : fail(`${label} → "${value}" (harus cocok ${pattern})`));
expect('sw.js cache-control', sw.h.get('cache-control'), /max-age=0/);
expect('sw.js service-worker-allowed', sw.h.get('service-worker-allowed'), /^\//);
const appJs = await head('/src/app.js');
expect('src cache-control', appJs.h.get('cache-control'), /must-revalidate|max-age=0/);
const mf = await head('/manifest.webmanifest');
expect('manifest content-type', mf.h.get('content-type'), /application\/manifest\+json/);
const icon = await head('/assets/icons/icon-512.png');
expect('asset cache-control', icon.h.get('cache-control'), /immutable/);
const sec = (await head('/')).h;
expect('x-content-type-options', sec.get('x-content-type-options'), /nosniff/);
expect('referrer-policy', sec.get('referrer-policy'), /strict-origin/);
expect('x-frame-options', sec.get('x-frame-options'), /SAMEORIGIN/i);
expect('permissions-policy', sec.get('permissions-policy'), /camera=\(\)/);

/* 3 ─ precache service worker --------------------------------------------- */
console.log(bold('\n3. Precache service worker (offline)'));
const swText = await (await fetch(`${BASE}/sw.js`)).text();
const shell = (swText.split('const APP_SHELL = [')[1] || '').split('];')[0]
  .split('\n').map((l) => (l.match(/'([^']+)'/) || [])[1]).filter(Boolean);
const statuses = await Promise.all(shell.map(async (entry) => {
  const res = await fetch(entry === './' ? `${BASE}/` : `${BASE}/${entry.replace(/^\.\//, '')}`);
  return { entry, status: res.status };
}));
const broken = statuses.filter((s) => s.status !== 200);
broken.length
  ? fail(`precache: ${broken.length}/${shell.length} berkas gagal → ${broken.map((b) => `${b.entry}(${b.status})`).join(', ')}`)
  : ok(`semua ${shell.length} entri precache bisa diunduh (200) → offline siap`);

/* 4 ─ berkas lokal tidak boleh terekspos ---------------------------------- */
console.log(bold('\n4. Berkas lokal tidak terekspos'));
const secrets = ['tests/smoke.dom.mjs', 'tools/check.mjs', 'docs/ROADMAP.md', 'server/server.js', 'package.json', '.env.example'];
const leaked = [];
for (const path of secrets) {
  const res = await fetch(`${BASE}/${path}`);
  if (res.status === 200) leaked.push(path);
}
leaked.length ? fail(`berkas internal bisa diakses publik: ${leaked.join(', ')}`)
  : ok(`semua ${secrets.length} berkas internal → 404 (terjaga .vercelignore)`);

/* 5 ─ boot dari berkas produksi ------------------------------------------ */
console.log(bold('\n5. Boot aplikasi dari berkas produksi'));
let JSDOMClass = null;
try { JSDOMClass = (await import('jsdom')).JSDOM; } catch { info('jsdom tidak terpasang — bagian ini dilewati'); }

if (JSDOMClass) {
  const dir = await mkdtemp(join(tmpdir(), 'ad-finance-live-'));
  const files = [...new Set(['index.html', ...shell.filter((s) => s !== './')])];
  await Promise.all(files.map(async (rel) => {
    const res = await fetch(`${BASE}/${rel}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const target = join(dir, rel);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, buf);
  }));
  ok(`${files.length} berkas produksi diunduh ke ${dir}`);

  const html = await (await fetch(`${BASE}/`)).text();
  const dom = new JSDOMClass(html.replace(/<script type="module"[^>]*><\/script>/, ''), {
    url: `${BASE}/`, runScripts: 'dangerously', pretendToBeVisual: true,
  });
  const { window } = dom;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (q) => ({ matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }),
  });
  window.scrollTo = () => {};
  window.print = () => {};
  Object.entries({
    window, document: window.document, navigator: window.navigator,
    localStorage: window.localStorage, sessionStorage: window.sessionStorage,
    HTMLElement: window.HTMLElement, Element: window.Element, Node: window.Node,
    Event: window.Event, CustomEvent: window.CustomEvent, MutationObserver: window.MutationObserver,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    Blob: window.Blob, URL: window.URL, location: window.location,
  }).forEach(([key, value]) => {
    try { Object.defineProperty(globalThis, key, { value, configurable: true, writable: true }); } catch { globalThis[key] = value; }
  });

  const errors = [];
  window.addEventListener('error', (e) => errors.push(String(e.message)));
  const waitFor = async (fn, label, timeout = 15000) => {
    const start = Date.now();
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() - start > timeout) throw new Error(`timeout menunggu ${label}`);
      await new Promise((r) => setTimeout(r, 25)); // eslint-disable-line no-await-in-loop
    }
  };

  try {
    const t0 = Date.now();
    await import(join(dir, 'src/app.js'));
    // Produksi diuji sebagai perangkat baru → lewati gerbang perkenalan
    // (nama + nomor telepon) dengan pengguna uji berisi data contoh.
    await waitFor(() => window.__pfos, 'api siap');
    if (window.__pfos.needsUser()) {
      await window.__pfos.createUser({ name: 'Audit Produksi', phone: '081200000000', mode: 'demo' });
    }
    await waitFor(() => window.document.querySelector('#view .card'), 'dashboard');
    ok(`aplikasi boot dari berkas produksi (${Date.now() - t0} ms) — dashboard render`);
    for (const [route, selector, label] of [
      ['transactions', '#view .txn', 'Transaksi'],
      ['reports', '#view .statement-head', 'Laporan'],
      ['accounts', '#view .account-card', 'Accounts'],
      ['settings', '#view [data-export-json]', 'Settings'],
    ]) {
      window.__pfos.navigate(route);
      await waitFor(() => window.document.querySelector(selector), label);
      ok(`${label} render di produksi`);
    }
    errors.length ? fail(`error runtime di produksi: ${errors[0]}`) : ok('tidak ada error runtime');
  } catch (error) {
    fail(`boot produksi gagal: ${error.message}`);
  }

  if (!KEEP) await rm(dir, { recursive: true, force: true });
  else info(`berkas produksi disimpan di ${dir}`);
}

/* hasil ------------------------------------------------------------------- */
console.log(`\n${problems.length ? '\u001b[31m' : '\u001b[32m'}${problems.length ? `${problems.length} masalah ditemukan` : 'Produksi sehat — semua pemeriksaan lolos'}\u001b[0m\n`);
process.exit(problems.length ? 1 : 0);
