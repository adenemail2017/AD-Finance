/**
 * verify-bundle.mjs — "apakah yang akan diunggah ke Vercel benar-benar jalan?"
 *
 * Skrip ini menyalin tepat berkas yang diloloskan `.vercelignore` ke folder
 * sementara, lalu memeriksa tiga hal yang paling sering membuat deploy PWA
 * gagal senyap:
 *
 *   1. Setiap entri precache di `sw.js` ada di dalam paket  → offline tidak rusak.
 *   2. Setiap aset yang dirujuk `index.html` dan manifest ada  → tidak ada 404.
 *   3. Aplikasi benar-benar boot dari folder itu (jsdom) dan halaman
 *      Transaksi/Laporan ikut render.
 *
 *   node tools/verify-bundle.mjs          # cek paket deploy
 *   node tools/verify-bundle.mjs --keep   # sisakan folder sementara untuk diperiksa
 *
 * jsdom hanya diperlukan untuk bagian (3); kalau belum dipasang
 * (`npm install --no-save jsdom`) skrip tetap menjalankan (1) dan (2).
 */

import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEEP = process.argv.includes('--keep');

const bold = (s) => `\u001b[1m${s}\u001b[0m`;
const ok = (s) => console.log(`  \u001b[32m✓\u001b[0m ${s}`);
const bad = (s) => console.log(`  \u001b[31m✗\u001b[0m ${s}`);
const info = (s) => console.log(`  \u001b[2m·\u001b[0m ${s}`);

let failed = 0;
const problems = [];

/* ------------------------------------------------------------------ */
/* 1. Baca .vercelignore dan susun daftar unggahan                     */
/* ------------------------------------------------------------------ */

async function readIgnore() {
  const raw = await readFile(join(ROOT, '.vercelignore'), 'utf8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => ({ negate: line.startsWith('!'), pattern: line.replace(/^!/, '') }));
}

const globToRegex = (glob) => {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
};

const ignored = await readIgnore();
const isIgnored = (rel, isDir) => {
  let state = false;
  for (const { negate, pattern } of ignored) {
    const re = globToRegex(pattern);
    const hit = re.test(rel)
      || re.test(rel.split('/')[0])
      || (isDir && re.test(`${rel}/`))
      || (!pattern.includes('/') && rel.split('/').includes(pattern));
    if (hit) state = !negate;
  }
  return state;
};

async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    const rel = relative(base, abs).split('\\').join('/');
    if (entry.isDirectory()) {
      if (entry.name === '.git' || isIgnored(rel, true)) continue;
      out.push(...await walk(abs, base));
    } else if (!isIgnored(rel, false)) {
      out.push(rel);
    }
  }
  return out;
}

console.log(bold('\nAD-Finance — verifikasi paket deploy (Vercel)\n'));
console.log(bold('1. Menyusun isi unggahan dari .vercelignore'));
const files = await walk(ROOT);
const sim = await mkdtemp(join(tmpdir(), 'ad-finance-deploy-'));
for (const rel of files) {
  const target = join(sim, rel);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(join(ROOT, rel), target);
}
const bytes = (await Promise.all(files.map(async (rel) => (await stat(join(sim, rel))).size))).reduce((a, b) => a + b, 0);
ok(`${files.length} berkas · ${(bytes / 1024).toFixed(0)} KB → ${sim}`);
info(files.filter((f) => /^(docs|tests|tools|server|preview)\//.test(f)).length
  ? 'PERINGATAN: ada berkas lokal yang ikut terunggah'
  : 'docs/ tests/ tools/ server/ preview/ tidak ikut terunggah');

/* ------------------------------------------------------------------ */
/* 2. Kelengkapan app shell                                            */
/* ------------------------------------------------------------------ */

console.log(bold('\n2. Kelengkapan app shell'));
const sw = await readFile(join(sim, 'sw.js'), 'utf8');
const shell = (sw.split('const APP_SHELL = [')[1] || '').split('];')[0]
  .split('\n').map((l) => (l.match(/'([^']+)'/) || [])[1]).filter(Boolean);
const missingShell = shell.filter((entry) => entry !== './' && !existsSync(join(sim, entry)));
if (missingShell.length) {
  failed += 1;
  problems.push(`precache tidak lengkap: ${missingShell.join(', ')}`);
  bad(`precache SW: ${missingShell.length} berkas hilang → ${missingShell.join(', ')}`);
} else {
  ok(`precache SW lengkap (${shell.length} entri) — offline akan bekerja`);
}

const html = await readFile(join(sim, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:href|src)="([^"#:]+)"/g)].map((m) => m[1]);
const missingRefs = refs.filter((r) => !existsSync(join(sim, r)));
if (missingRefs.length) {
  failed += 1;
  problems.push(`aset index.html hilang: ${missingRefs.join(', ')}`);
  bad(`index.html: ${missingRefs.join(', ')} tidak ada`);
} else {
  ok(`index.html: ${refs.length} rujukan aset semuanya ada`);
}

const manifest = JSON.parse(await readFile(join(sim, 'manifest.webmanifest'), 'utf8'));
const manifestAssets = [...(manifest.icons || []), ...(manifest.screenshots || [])].map((i) => i.src);
const missingManifest = manifestAssets.filter((a) => !existsSync(join(sim, a)));
if (missingManifest.length) {
  failed += 1;
  problems.push(`ikon manifest hilang: ${missingManifest.join(', ')}`);
  bad(`manifest: ${missingManifest.join(', ')} tidak ada`);
} else {
  ok(`manifest: ${manifestAssets.length} ikon/screenshot ada · start_url "${manifest.start_url}" · scope "${manifest.scope}"`);
}

const secrets = files.filter((f) => /(^|\/)\.env$|\.pem$|\.key$|^backup-.*\.json$/.test(f));
if (secrets.length) {
  failed += 1;
  problems.push(`berkas sensitif ikut terunggah: ${secrets.join(', ')}`);
  bad(`berkas sensitif ikut terunggah: ${secrets.join(', ')}`);
} else {
  ok('tidak ada .env / kunci / backup yang ikut terunggah');
}

/* ------------------------------------------------------------------ */
/* 3. Boot aplikasi dari folder hasil salinan                          */
/* ------------------------------------------------------------------ */

console.log(bold('\n3. Boot aplikasi dari paket deploy'));
let JSDOMClass = null;
try {
  JSDOMClass = (await import('jsdom')).JSDOM;
} catch {
  info('jsdom belum terpasang — bagian boot dilewati (npm install --no-save jsdom)');
}

if (JSDOMClass) {
  const shellHtml = html.replace(/<script type="module"[^>]*><\/script>/, '');
  const dom = new JSDOMClass(shellHtml, { url: 'https://ad-finance.vercel.app/', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (q) => ({ matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }),
  });
  window.scrollTo = () => {};
  window.print = () => {};
  Object.entries({
    window,
    document: window.document,
    navigator: window.navigator,
    localStorage: window.localStorage,
    sessionStorage: window.sessionStorage,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    Event: window.Event,
    CustomEvent: window.CustomEvent,
    MutationObserver: window.MutationObserver,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    Blob: window.Blob,
    URL: window.URL,
    location: window.location,
  }).forEach(([key, value]) => {
    try { Object.defineProperty(globalThis, key, { value, configurable: true, writable: true }); } catch { globalThis[key] = value; }
  });

  const errors = [];
  window.addEventListener('error', (e) => errors.push(String(e.message)));
  const waitFor = async (fn, label, timeout = 12000) => {
    const start = Date.now();
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() - start > timeout) throw new Error(`timeout menunggu ${label}`);
      await new Promise((r) => setTimeout(r, 25)); // eslint-disable-line no-await-in-loop
    }
  };

  const t0 = Date.now();
  await import(join(sim, 'src/app.js'));
  await waitFor(() => window.document.querySelector('#view .card'), 'dashboard');
  ok(`aplikasi boot dari paket deploy (${Date.now() - t0} ms) — dashboard render`);

  const go = async (route, selector, label) => {
    window.__pfos.navigate(route);
    await waitFor(() => window.document.querySelector(selector), label);
    ok(`${label} render (${selector})`);
  };
  await go('transactions', '#view .txn', 'Transaksi');
  await go('reports', '#view .statement-head', 'Laporan');
  await go('settings', '#view [data-export-json]', 'Settings');

  if (errors.length) {
    failed += 1;
    problems.push(`error saat boot: ${errors[0]}`);
    bad(`error saat boot: ${errors[0]}`);
  } else {
    ok('tidak ada error runtime');
  }
}

/* ------------------------------------------------------------------ */

if (!KEEP) await rm(sim, { recursive: true, force: true });
else info(`folder sementara disimpan di ${sim}`);

console.log(`\n${failed === 0 ? '\u001b[32m' : '\u001b[31m'}${failed === 0 ? 'Paket deploy siap' : `${failed} masalah ditemukan`}\u001b[0m`);
if (problems.length) console.log(problems.map((p) => ` - ${p}`).join('\n'));
console.log('');
process.exit(failed === 0 ? 0 : 1);
