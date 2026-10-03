/**
 * Static integrity check — run with `npm run check`.
 *
 * Verifies that:
 *   1. every ES module import resolves to a real file
 *   2. every named import actually exists in the target module
 *   3. every asset referenced by index.html exists
 *   4. the service-worker precache list matches files on disk
 *   5. every manifest icon exists and is a valid PNG
 *   6. no module exceeds the architecture line budget (keeps files reviewable)
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let problems = 0;

const ok = (msg) => console.log(`  \u001b[32m✓\u001b[0m ${msg}`);
const bad = (msg) => { problems += 1; console.log(`  \u001b[31m✗\u001b[0m ${msg}`); };

async function walk(dir, filter = () => true) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full, filter));
    else if (filter(full)) out.push(full);
  }
  return out;
}

const jsFiles = await walk(join(ROOT, 'src'), (f) => f.endsWith('.js'));
jsFiles.push(join(ROOT, 'sw.js'));
jsFiles.push(join(ROOT, 'server', 'dev-server.js'));

/* ------------------------------------------------ 1 & 2. imports ---- */
console.log('\n\u001b[1mModule graph\u001b[0m');
const exportCache = new Map();

async function exportsOf(file) {
  if (exportCache.has(file)) return exportCache.get(file);
  let source = '';
  try { source = await readFile(file, 'utf8'); } catch { return new Set(); }
  const names = new Set();
  const patterns = [
    /export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g,
    /export\s*\{([^}]*)\}/g,
  ];
  let match = patterns[0].exec(source);
  while (match) { names.add(match[1]); match = patterns[0].exec(source); }
  match = patterns[1].exec(source);
  while (match) {
    match[1].split(',').forEach((chunk) => {
      const cleaned = chunk.trim().replace(/^type\s+/, '');
      if (!cleaned) return;
      const alias = cleaned.split(/\s+as\s+/);
      names.add((alias[1] || alias[0]).trim());
    });
    match = patterns[1].exec(source);
  }
  if (/export\s+default/.test(source)) names.add('default');
  exportCache.set(file, names);
  return names;
}

for (const file of jsFiles) {
  const source = await readFile(file, 'utf8');
  const importRe = /import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  let match = importRe.exec(source);
  while (match) {
    const clause = match[1].trim();
    const specifier = match[2];
    if (specifier.startsWith('node:') || !specifier.startsWith('.')) { match = importRe.exec(source); continue; }
    const target = resolve(dirname(file), specifier);
    try {
      await stat(target);
    } catch {
      bad(`${relative(ROOT, file)} imports missing file ${specifier}`);
      match = importRe.exec(source);
      continue;
    }
    const named = clause.match(/\{([\s\S]*)\}/);
    if (named) {
      const names = named[1].split(',').map((n) => n.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
      const available = await exportsOf(target);
      names.forEach((name) => {
        if (!available.has(name)) bad(`${relative(ROOT, file)} imports { ${name} } which ${relative(ROOT, target)} does not export`);
      });
    }
    match = importRe.exec(source);
  }
}
if (!problems) ok(`${jsFiles.length} modules · all imports resolve with valid named exports`);

/* ------------------------------------------------ 3. index.html ------ */
console.log('\n\u001b[1mShell assets\u001b[0m');
const indexHtml = await readFile(join(ROOT, 'index.html'), 'utf8');
const refs = [...indexHtml.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1])
  .filter((href) => !href.startsWith('http') && !href.startsWith('#') && !href.startsWith('data:'));
for (const ref of refs) {
  try {
    await stat(join(ROOT, ref));
  } catch {
    bad(`index.html references missing file: ${ref}`);
  }
}
const scripts = [...indexHtml.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
if (!scripts.length) bad('index.html has no application entry script');
const cssLinks = [...indexHtml.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
if (cssLinks.length < 3) bad(`expected the 3-layer stylesheet set, found ${cssLinks.length}`);
ok(`index.html: ${refs.length} asset references verified, ${scripts.length} entry script, ${cssLinks.length} stylesheets`);

/* ------------------------------------------------ 4. service worker -- */
console.log('\n\u001b[1mService worker\u001b[0m');
const sw = await readFile(join(ROOT, 'sw.js'), 'utf8');
const precache = [...sw.matchAll(/^\s{2}'([^']+)',$/gm)].map((m) => m[1]);
let missing = 0;
for (const entry of precache) {
  const target = join(ROOT, entry === './' ? 'index.html' : entry);
  try {
    await stat(target);
  } catch {
    bad(`sw.js precaches missing file: ${entry}`);
    missing += 1;
  }
}
if (!missing) ok(`precache list matches disk (${precache.length} entries)`);
// every src module must be cached for offline boot
const srcRelative = jsFiles
  .filter((f) => f.includes(`${join('src')}`))
  .map((f) => relative(ROOT, f).replace(/\\/g, '/'));
const notCached = srcRelative.filter((f) => !precache.includes(f));
if (notCached.length) bad(`module(s) missing from precache list: ${notCached.join(', ')}`);
else ok(`all ${srcRelative.length} src modules are precached (offline boot verified)`);

/* ------------------------------------------------ 5. manifest -------- */
console.log('\n\u001b[1mPWA manifest\u001b[0m');
const manifest = JSON.parse(await readFile(join(ROOT, 'manifest.webmanifest'), 'utf8'));
for (const icon of manifest.icons) {
  try {
    const info = await stat(join(ROOT, icon.src));
    if (info.size < 500) bad(`icon looks empty: ${icon.src}`);
    if (icon.sizes !== 'any') {
      const [w, h] = icon.sizes.split('x').map(Number);
      const header = (await readFile(join(ROOT, icon.src))).subarray(0, 24);
      const isPng = header[0] === 0x89 && header[1] === 0x50;
      if (!isPng) bad(`not a PNG: ${icon.src}`);
      else {
        const width = header.readUInt32BE(16);
        const height = header.readUInt32BE(20);
        if (width !== w || height !== h) bad(`icon size mismatch ${icon.src}: ${width}x${height} vs declared ${icon.sizes}`);
      }
    }
  } catch {
    bad(`manifest icon missing: ${icon.src}`);
  }
}
for (const shot of manifest.screenshots || []) {
  try { await stat(join(ROOT, shot.src)); } catch { bad(`screenshot missing: ${shot.src}`); }
}
for (const shortcut of manifest.shortcuts || []) {
  if (!shortcut.url || !shortcut.name) bad(`incomplete shortcut: ${JSON.stringify(shortcut)}`);
}
ok(`${manifest.icons.length} icons + ${(manifest.screenshots || []).length} screenshot verified`);
ok(`display=${manifest.display} · theme=${manifest.theme_color} · ${(manifest.shortcuts || []).length} shortcuts`);

/* ------------------------------------------------ 6. file budget ---- */
console.log('\n\u001b[1mArchitecture budget\u001b[0m');
const sizes = await Promise.all(jsFiles.map(async (f) => ({ file: relative(ROOT, f), lines: (await readFile(f, 'utf8')).split('\n').length })));
const oversized = sizes.filter((s) => s.lines > 1400);
sizes.sort((a, b) => b.lines - a.lines);
oversized.forEach((s) => bad(`${s.file} has ${s.lines} lines (budget 1400) — consider splitting`));
const totalLines = sizes.reduce((acc, s) => acc + s.lines, 0);
ok(`largest module: ${sizes[0].file} (${sizes[0].lines} lines) · total ${totalLines.toLocaleString('id-ID')} lines across ${sizes.length} files`);
const buckets = { pages: 0, components: 0, services: 0, utils: 0, database: 0, styles: 0, other: 0 };
sizes.forEach(({ file, lines }) => {
  const key = Object.keys(buckets).find((k) => file.includes(`/${k}/`)) || 'other';
  buckets[key] += lines;
});
ok(`layers — ${Object.entries(buckets).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' · ')}`);

/* ------------------------------------------ 7. layout invariants ---- */
console.log('\n\u001b[1mLayout invariants (desktop & mobile)\u001b[0m');
const cssComponents = await readFile(join(ROOT, 'src/styles/components.css'), 'utf8');
const debtsJs = await readFile(join(ROOT, 'src/pages/debts.js'), 'utf8');
const ledgerJs = await readFile(join(ROOT, 'src/components/ledger.js'), 'utf8');
const financeJs = await readFile(join(ROOT, 'src/services/finance.js'), 'utf8');
const cardsJs = await readFile(join(ROOT, 'src/components/cards.js'), 'utf8');
const cssApp = await readFile(join(ROOT, 'src/styles/app.css'), 'utf8');
const cssDesign = await readFile(join(ROOT, 'src/styles/design-system.css'), 'utf8');
const ruleBody = (css, selector, { from = 0 } = {}) => {
  const at = css.indexOf(`${selector} {`, from);
  return at === -1 ? '' : css.slice(at, css.indexOf('}', at));
};

const invariants = [
  {
    label: 'ledger grid memakai kolom eksplisit (bukan min-content yang meluber)',
    pass: ['.ledger', '.ledger-day'].every((sel) => /grid-template-columns:\s*minmax\(0, 1fr\)/.test(ruleBody(cssComponents, sel))),
    hint: '.ledger/.ledger-day tanpa grid-template-columns melebar ke min-content → nominal terpotong di mobile',
  },
  {
    label: 'shell menempatkan sidebar & app-main secara eksplisit',
    pass: /grid-column:\s*1;\s*grid-row:\s*1/.test(ruleBody(cssComponents, '.sidebar'))
      && /grid-column:\s*2;\s*grid-row:\s*1/.test(ruleBody(cssComponents, '.app-main')),
    hint: 'auto-placement membuat .sidebar-scrim merebut sel pertama → konten terjepit 258px di desktop',
  },
  {
    label: 'sidebar scrim tidak ikut layout di desktop',
    pass: /display:\s*none/.test(ruleBody(cssComponents, '.sidebar-scrim'))
      && /display:\s*block/.test(ruleBody(cssApp, '.sidebar-scrim')),
    hint: '.sidebar-scrim harus display:none di desktop dan block hanya di dalam drawer mobile',
  },
  {
    label: 'tabel data tidak dipaksa lebar minimum di layar kecil',
    pass: /@media \(min-width: 861px\)\s*\{\s*table\.data \{\s*min-width: 640px/.test(cssDesign)
      && !/^table\.data \{[^}]*min-width: 640px/m.test(cssDesign),
    hint: 'min-width 640px di luar media query membuat scroll horizontal di ponsel',
  },
  {
    label: 'toast tidak menutupi bottom nav',
    pass: /--bottomnav-h\)\s*\+\s*30px/.test(cssApp) && /\.toast-stack\s*\{[^}]*left:/.test(cssApp),
    hint: 'toast di mobile harus dinaikkan di atas bottom nav + FAB',
  },
  {
    label: 'tab laporan memakai 3 kolom di mobile (tidak ada tab terpotong)',
    pass: /\[data-tabs\]\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/s.test(cssApp),
    hint: 'segmented 3 tab meluber di 390px; harus jadi grid 3 kolom di mobile',
  },
  {
    label: 'nominal baris transaksi punya wadah sendiri (.txn-side)',
    pass: /class="txn-side"/.test(await readFile(join(ROOT, 'src/components/ledger.js'), 'utf8'))
      && /\.txn-side\s*\{/.test(cssComponents) && /\.txn-side\s*\{[^}]*flex: 1 1 100%/s.test(cssApp),
    hint: 'tanpa .txn-side (baris kedua di mobile) nominal kembali terpotong',
  },
  {
    label: 'eyebrow header dipotong, bukan membungkus dua baris di mobile',
    pass: /\.topbar-eyebrow\s*\{[^}]*text-overflow: ellipsis/s.test(cssApp),
    hint: 'eyebrow panjang ("LAPORAN & REKENING KORAN") menambah tinggi header island',
  },
  {
    label: 'kartu saldo punya tombol mata (mode privasi)',
    pass: /atm-balance-head/.test(await readFile(join(ROOT, 'src/components/cards.js'), 'utf8'))
      && /data-toggle-secret/.test(await readFile(join(ROOT, 'src/components/cards.js'), 'utf8'))
      && /\.atm-eye\s*\{/.test(cssComponents),
    hint: 'Total Saldo di Home harus bisa disembunyikan lewat tombol mata yang tetap terlihat di kartu navy',
  },
  {
    label: 'halaman Home menghormati setelan hide_balance',
    pass: /settings\.hide_balance/.test(await readFile(join(ROOT, 'src/pages/dashboard.js'), 'utf8'))
      && /maskMoneyInDom/.test(await readFile(join(ROOT, 'src/pages/dashboard.js'), 'utf8'))
      && /setSetting\('hide_balance'/.test(await readFile(join(ROOT, 'src/pages/dashboard.js'), 'utf8')),
    hint: 'mode privasi harus dibaca dari settings, disimpan lewat setSetting, dan menyensor sisa nominal',
  },
  {
    label: 'aksi utama sheet dapat baris penuh di mobile (tidak terpotong)',
    pass: /\.sheet-footer\s*\{[^}]*display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/s.test(cssApp)
      && /:has\(> \.btn:nth-child\(3\)\)/.test(cssApp.replace(/\\/g, '')),
    hint: 'footer sheet harus grid 2 kolom dengan aksi utama selebar baris penuh (390px)',
  },
  {
    label: 'daftar label-nilai detail tetap dua kolom di layar sempit',
    pass: /\.kv\.kv-tight\s*\{[^}]*minmax\(0, 1fr\)/s.test(cssApp)
      && !/\.kv\.kv-tight\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);/.test(cssApp),
    hint: 'satu kolom membuat nilai panjang (referensi/akun) melebarkan sheet hingga 445px',
  },
  {
    label: 'tabel Rekap punya tata letak sendiri (kartu per bulan di ponsel)',
    pass: /\.recap-table tbody tr, \.recap-table tfoot tr \{[^}]*grid-template-columns:\s*repeat\(2/s.test(cssApp)
      && /\.recap-table td\.cell-title \{[^}]*grid-column: 1 \/ -1/s.test(cssApp)
      && !/\.table-stack\.is-dense/.test(cssApp),
    hint: 'aturan "3 kolom padat" lama membuat label dan nominal saling menimpa di ponsel',
  },
  {
    label: 'tabel Rekap muat tanpa gulir samping di desktop',
    pass: /table\.recap-table \{ min-width: 0; \}/.test(cssApp)
      && /table\.recap-table td\.t-num, table\.recap-table tfoot td \{ font-size: 12\.5px; \}/.test(cssApp),
    hint: 'sembilan kolom sebelumnya meluber ~94px sehingga kolom saldo akhir terpotong',
  },
  {
    label: 'menu Catat Cepat memakai ubin grid, scrim, dan bisa ditutup',
    pass: /\.fab-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4/s.test(cssComponents)
      && /class="fab-tile"/.test(await readFile(join(ROOT, 'src/app.js'), 'utf8'))
      && /fab-scrim/.test(await readFile(join(ROOT, 'src/app.js'), 'utf8'))
      && /data-fab-close/.test(await readFile(join(ROOT, 'src/app.js'), 'utf8'))
      && /\.fab-menu\.is-open/.test(cssComponents),
    hint: 'menu lama 232×532 px; harus jadi grid ubin ringkas dengan scrim + tombol tutup',
  },
  {
    label: 'FAB berubah menjadi tombol X saat menu terbuka (toggle)',
    pass: /setFabTriggerState/.test(await readFile(join(ROOT, 'src/app.js'), 'utf8'))
      && /const alreadyOpen = Boolean\(fabMenuEl\) && fabTriggerEl === trigger/.test(await readFile(join(ROOT, 'src/app.js'), 'utf8'))
      && /\.bn-item\.is-center\.is-open \.bn-fab/.test(cssComponents),
    hint: 'klik kedua pada FAB harus menutup menu dan ikon kembali menjadi tanda plus',
  },
  {
    label: 'kartu angka di dalam sheet tetap sebaris (tidak menumpuk)',
    pass: /\.sheet \.grid\.grid-3\s*\{[^}]*repeat\(3, minmax\(0, 1fr\)\)/s.test(cssApp),
    hint: '.grid-3 menumpuk jadi 1 kolom di mobile → popup Hutang/Akun terlihat berantakan',
  },
  {
    label: 'popup hutang/piutang memakai hero ringkas',
    pass: /class="debt-hero/.test(await readFile(join(ROOT, 'src/pages/debts.js'), 'utf8'))
      && /\.debt-hero\s*\{/.test(cssComponents),
    hint: 'tiga kartu angka bertumpuk di popup hutang digantikan satu hero berisi total/dibayar/jatuh tempo',
  },
  {
    label: 'notifikasi melayang tidak menutupi sheet / menu',
    pass: /body\.has-overlay \.toast-stack/.test(cssApp) && /body\.fab-open \.toast-stack/.test(cssApp)
      && /classList\.add\('has-overlay'\)/.test(await readFile(join(ROOT, 'src/components/ui.js'), 'utf8')),
    hint: 'toast (z 300) menutupi isi sheet (z 200); sembunyikan saat sheet atau menu Catat Cepat terbuka',
  },
  {
    label: 'Tentang Aplikasi memakai APP_VERSION, bukan versi skema penyimpanan',
    pass: /APP_VERSION/.test(await readFile(join(ROOT, 'src/pages/settings.js'), 'utf8'))
      && !/state\.version \? `v\$\{state\.version\}`/.test(await readFile(join(ROOT, 'src/pages/settings.js'), 'utf8')),
    hint: 'state.version berisi versi skema data (=1); versi rilis harus dari sw-client.js',
  },
  {
    label: 'ledger di dalam sheet memakai .ledger-card (tanpa max-height/scroll internal)',
    pass: /class="ledger-card"/.test(await readFile(join(ROOT, 'src/pages/accounts.js'), 'utf8'))
      && /class="ledger-card"/.test(await readFile(join(ROOT, 'src/pages/debts.js'), 'utf8'))
      && !/class="ledger" style="border:1px solid var\(--line\)/.test(await readFile(join(ROOT, 'src/pages/accounts.js'), 'utf8'))
      && /\.ledger-card\s*\{/.test(cssComponents),
    hint: 'kotak bergulir 240px di dalam sheet memotong baris di tengah → pakai daftar ringkas tanpa scroll',
  },
  {
    label: 'ledger ringkas: baris is-compact, tanggal per baris, header hari statis',
    pass: /if \(compact\)/.test(await readFile(join(ROOT, 'src/components/ledger.js'), 'utf8'))
      && /class="txn\$\{compact \? ' is-compact' : ''\}"/.test(await readFile(join(ROOT, 'src/components/ledger.js'), 'utf8'))
      && /\.txn\.is-compact \.txn-date/.test(cssComponents)
      && /position: static/.test(cssComponents.slice(cssComponents.indexOf('.ledger-day.is-compact'))),
    hint: 'header hari sticky menimpa baris di dalam kotak bergulir; tanggal harus jadi label baris',
  },
  {
    label: 'multi-pengguna: layar perkenalan mewajibkan nama sebelum workspace dibuat',
    pass: /function renderOnboarding/.test(await readFile(join(ROOT, 'src/app.js'), 'utf8'))
      && /data-onboard-name/.test(await readFile(join(ROOT, 'src/app.js'), 'utf8'))
      && /needsUser: !resolved.onboarding_done \|\| resolved.name === DEFAULT_PROFILE.name/.test(await readFile(join(ROOT, 'src/services/store.js'), 'utf8')),
    hint: 'tanpa gerbang ini pengguna langsung memakai data contoh tanpa pernah mengisi nama',
  },
  {
    label: 'perkenalan cukup nama + nomor telepon (tanpa pilihan "mulai dari mana")',
    pass: /data-onboard-phone/.test(await readFile(join(ROOT, 'src/app.js'), 'utf8'))
      && /export function phoneValid\(value = ''\)/.test(await readFile(join(ROOT, 'src/utils/format.js'), 'utf8'))
      && /phoneValid\(phone\)/.test(await readFile(join(ROOT, 'src/app.js'), 'utf8'))
      && !/onboard-mode/.test(await readFile(join(ROOT, 'src/app.js'), 'utf8'))
      && !/opt-card/.test(cssComponents),
    hint: 'form perkenalan harus sesederhana mungkin: nama, nomor telepon, lalu mulai',
  },
  {
    label: 'pengguna baru mulai dari data kosong (kategori bawaan saja)',
    pass: /export async function createUser\(\{ name, phone = '', mode = 'empty' \} = \{\}\)/.test(await readFile(join(ROOT, 'src/services/store.js'), 'utf8'))
      && /dataset \? dataset\.categories : buildDefaultCategories\(profile\.id\)/.test(await readFile(join(ROOT, 'src/services/store.js'), 'utf8'))
      && /if \(dataset\) \{/.test(await readFile(join(ROOT, 'src/services/store.js'), 'utf8')),
    hint: 'default harus kosong; data contoh hanya untuk pengujian/bila diminta eksplisit',
  },
  {
    label: 'perangkat lama: data yang sudah ada tidak pernah dihapus diam-diam',
    pass: /const pertahankan = keepData \|\| state\.legacyData;/.test(await readFile(join(ROOT, 'src/services/store.js'), 'utf8'))
      && /keepData: true/.test(await readFile(join(ROOT, 'src/app.js'), 'utf8')),
    hint: 'tanpa ini, mengisi nama di perangkat berisi data lama akan menghapus datanya',
  },
  {
    label: 'isolasi penyimpanan per pengguna (scope + stamp user_id + settings ber-prefix)',
    pass: /export function setUserScope\(userId\)/.test(await readFile(join(ROOT, 'src/database/idb.js'), 'utf8'))
      && /const SCOPED = new Set\(\['accounts'/.test(await readFile(join(ROOT, 'src/database/idb.js'), 'utf8'))
      && /return rows.filter\(\(row\) => !row\.user_id \|\| row\.user_id === activeUserId\)/.test(await readFile(join(ROOT, 'src/database/idb.js'), 'utf8'))
      && /key: `\$\{activeUserId\}:\$\{value\.key\}`/.test(await readFile(join(ROOT, 'src/database/idb.js'), 'utf8')),
    hint: 'tanpa scope, pengguna kedua bisa membaca/menimpa baris pengguna pertama',
  },
  {
    label: 'pengguna dapat berpindah, diganti nama, dan dihapus beserta datanya',
    pass: /export async function switchUser\(userId\)/.test(await readFile(join(ROOT, 'src/services/store.js'), 'utf8'))
      && /export async function purgeUser\(userId\)/.test(await readFile(join(ROOT, 'src/database/idb.js'), 'utf8'))
      && /data-switch-user/.test(await readFile(join(ROOT, 'src/app.js'), 'utf8'))
      && /data-user-card/.test(await readFile(join(ROOT, 'src/pages/settings.js'), 'utf8')),
    hint: 'manajemen pengguna harus tersedia dari menu profil dan Settings',
  },
  {
    label: 'workspace kosong menampilkan panduan tiga langkah',
    pass: /const firstRun = state.accounts.length === 0 && state.transactions.length === 0/.test(await readFile(join(ROOT, 'src/pages/dashboard.js'), 'utf8'))
      && /data-first-run/.test(await readFile(join(ROOT, 'src/pages/dashboard.js'), 'utf8'))
      && /\.first-run-step/.test(cssComponents),
    hint: 'pengguna baru butuh arah, bukan dashboard kosong tanpa penjelasan',
  },
  {
    label: 'layar perkenalan selalu dibersihkan sebelum shell berdiri',
    pass: (await readFile(join(ROOT, 'src/app.js'), 'utf8')).match(/document\.querySelector\('\.onboarding'\)\?\.remove\(\)/g)?.length >= 2,
    hint: 'kalau gerbang tertinggal, dashboard tertutup overlay tanpa jalan keluar',
  },
  {
    label: 'beranda punya diagram donat carousel (3 slide: arus kas, pengeluaran, pemasukan)',
    pass: /export function donutCarousel/.test(await readFile(join(ROOT, 'src/components/donut-carousel.js'), 'utf8'))
      && /data-donut-slide/.test(await readFile(join(ROOT, 'src/components/donut-carousel.js'), 'utf8'))
      && /\$\{donutCard\(state\)\}/.test(await readFile(join(ROOT, 'src/pages/dashboard.js'), 'utf8'))
      && /donutIndex/.test(await readFile(join(ROOT, 'src/pages/dashboard.js'), 'utf8')),
    hint: 'permintaan pengguna: diagram pie di beranda seperti contoh (carousel + pilih bulan)',
  },
  {
    label: 'di desktop tiga donat tampil berdampingan, di ponsel jadi carousel',
    pass: /\.cd-track \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/.test(cssComponents)
      && /\.cd-nav \{ display: flex; \}/.test(cssApp)
      && /\.cd-slide\[aria-hidden="true"\] \{ pointer-events: none; \}/.test(cssApp),
    hint: 'satu donat per layar di ponsel; tiga berdampingan di desktop tanpa navigasi',
  },
  {
    label: 'segmen donat tunggal digambar sebagai lingkaran penuh',
    pass: /const solo = segments\.length === 1;/.test(await readFile(join(ROOT, 'src/components/donut-carousel.js'), 'utf8'))
      && /const dash = solo \? circumference :/.test(await readFile(join(ROOT, 'src/components/donut-carousel.js'), 'utf8')),
    hint: 'tanpa ini cincin 100% menganga karena jeda antar segmen',
  },
  {
    label: 'data contoh menyimpan kategori yang benar-benar dirujuk transaksinya',
    pass: /const dataset = mode === 'demo' \? buildDemoDataset\(profile\.id\) : null;/.test(await readFile(join(ROOT, 'src/services/store.js'), 'utf8'))
      && /dataset \? dataset\.categories : buildDefaultCategories\(profile\.id\)/.test(await readFile(join(ROOT, 'src/services/store.js'), 'utf8')),
    hint: 'bug nyata: kategori disimpan dari buildDefaultCategories terpisah sehingga breakdown jadi "Tanpa kategori"',
  },
  {
    label: 'beranda: kartu Saldo Akun tampil di atas kartu Kekayaan Bersih',
    // urutan di markup render: kartu ATM → Saldo Akun → Kekayaan Bersih
    pass: (await readFile(join(ROOT, 'src/pages/dashboard.js'), 'utf8')).indexOf('${heroCard({')
      < (await readFile(join(ROOT, 'src/pages/dashboard.js'), 'utf8')).indexOf('data-account-rail-card')
      && (await readFile(join(ROOT, 'src/pages/dashboard.js'), 'utf8')).indexOf('data-account-rail-card')
      < (await readFile(join(ROOT, 'src/pages/dashboard.js'), 'utf8')).indexOf('${netWorthCard(state, { masked: hide })}'),
    hint: 'pengguna meminta ringkasan saldo per akun lebih dulu daripada kekayaan bersih',
  },
  {
    label: 'kartu Saldo Akun di baris pertama tetap rapi (rail ditengahkan, total di dasar)',
    pass: /\.card\[data-account-rail-card\] > \.rail-wrap \{ flex: 1; display: flex; align-items: center; \}/.test(cssComponents)
      && /\.card\[data-account-rail-card\] > \.rail-foot \{ margin-top: auto; \}/.test(cssComponents),
    hint: 'tanpa ini kartu tinggi menyisakan ruang kosong di bawah rail',
  },
  {
    label: 'Aksi Cepat beranda memakai rail chip (bukan kartu 8 ubin)',
    pass: /export function quickChipRail/.test(cardsJs)
      && /class="chip-rail" data-chip-rail/.test(cardsJs)
      && /\.chip-rail \{/.test(cssComponents)
      && (await readFile(join(ROOT, 'src/pages/dashboard.js'), 'utf8')).includes('quickChipRail(QUICK_ACTIONS)'),
    hint: 'kartu Aksi Cepat 4x2 memakan tinggi; chip horizontal lebih ringan dan tetap satu hook data-quick',
  },
  {
    label: 'Financial Insights tampil sebagai rail horizontal',
    pass: /class="insight-rail" data-insight-rail/.test(await readFile(join(ROOT, 'src/pages/dashboard.js'), 'utf8'))
      && /\.insight-rail \{/.test(cssComponents)
      && /\.insight-rail\.is-overflow:not\(\.at-end\)/.test(cssComponents),
    hint: 'daftar insight vertikal 505 px; rail horizontal memberi tepi memudar sebagai penanda bisa digeser',
  },
  {
    label: 'Kepala kartu grafik tidak terjepit di ponsel (grid satu kolom)',
    pass: /\.chart-card \.card-head \{ display: grid; grid-template-columns: minmax\(0, 1fr\)/.test(cssApp)
      && /cls: 'col-8 chart-card'/.test(await readFile(join(ROOT, 'src/pages/dashboard.js'), 'utf8')),
    hint: 'flex membuat kontrol rentang keluar tepi kartu sehingga judul grafik pecah jadi kolom vertikal',
  },
  {
    label: 'Bahasa visual 2.4: tint kartu, kanvas ber-aura, stagger masuk',
    pass: /\.tint-brand \{ --card-tint: var\(--brand-500\); \}/.test(cssComponents)
      && /radial-gradient\(1200px 560px at 4% -12%/.test(cssComponents)
      && /@keyframes bentoRise/.test(cssComponents)
      && /\.sum-value \{ color: var\(--sum-color/.test(cssComponents),
    hint: 'perubahan tampilan harus terlihat: warna kartu, kanvas, animasi masuk, angka metrik berwarna',
  },
  {
    label: 'Home ringkas: empat metrik bulan ini digabung satu kartu (.summary-card)',
    pass: /export function summaryCard/.test(cardsJs)
      && /class="card col-12 summary-card"/.test(cardsJs)
      && (await readFile(join(ROOT, 'src/pages/dashboard.js'), 'utf8')).includes('summaryCard({')
      && /\.summary-grid \{ display: grid; grid-template-columns: repeat\(4/.test(cssComponents)
      && /\.summary-grid \{ grid-template-columns: repeat\(2/.test(cssApp),
    hint: 'empat kartu col-3 memakan tinggi beranda → satukan jadi satu kartu 2×2 di ponsel',
  },
  {
    label: 'Saldo Akun memakai rail horizontal (geser kiri/kanan) di beranda',
    pass: /export function accountRail/.test(cardsJs)
      && /data-rail-nav/.test(cardsJs)
      && /data-rail/.test(await readFile(join(ROOT, 'src/pages/dashboard.js'), 'utf8'))
      && /\.account-rail \{ display: grid; grid-auto-flow: column/.test(cssComponents)
      && /\.rail-wrap\.has-overflow:not\(\.is-end\)::after/.test(cssComponents),
    hint: 'grid 190px 10 akun (1480 px) membuat beranda sangat panjang; rail dapat digeser lebih hemat 90%',
  },
  {
    label: 'Hutang & Piutang beranda digabung satu kartu (.pair-stack)',
    pass: /export function debtPairCard/.test(cardsJs)
      && /\.pair-stack \{ display: grid; grid-template-columns: minmax\(0, 1fr\)/.test(cssComponents)
      && (await readFile(join(ROOT, 'src/pages/dashboard.js'), 'utf8')).includes('debtPairCard({')
      && !/<h3>Hutang<\/h3>/.test(await readFile(join(ROOT, 'src/pages/dashboard.js'), 'utf8')),
    hint: 'dua kartu terpisah (507 + 247 px di ponsel) digantikan dua baris ringkas dengan aksi cepat',
  },
  {
    label: 'ledger Transaksi Terbaru beranda memakai mode ringkas 5 baris',
    pass: /HOME_RECENT_LIMIT = 5/.test(await readFile(join(ROOT, 'src/pages/dashboard.js'), 'utf8'))
      && /ledgerHtml\(recent, \{ state, masked: hide, compact: true, limit: HOME_RECENT_LIMIT \}\)/.test(await readFile(join(ROOT, 'src/pages/dashboard.js'), 'utf8'))
      && /\.card-flush > \.ledger-card \{/.test(cssComponents),
    hint: 'daftar ber-header-hari setinggi 748 px di ponsel; mode ringkas (tanpa header hari) menjadi ±264 px',
  },
  {
    label: 'tombol "Lihat semua" pada ledger tersemat bisa diklik (data-statement)',
    pass: /data-statement>\s*$|data-statement>/.test(await readFile(join(ROOT, 'src/pages/accounts.js'), 'utf8'))
      && /ledger-more/.test(cssComponents),
    hint: 'tanpa tombol ini pengguna tidak tahu ada transaksi lain di luar 6 baris',
  },
  {
    label: 'Hutang mendukung pokok ≠ total pelunasan (total_repayment + monthly_installment)',
    pass: /total_repayment: Math.abs\(Number\(input.total_repayment\) \|\| 0\)/.test(
      await readFile(join(ROOT, 'src/types/models.js'), 'utf8'),
    )
      && /monthly_installment: Math.abs\(Number\(input.monthly_installment\) \|\| 0\)/.test(
        await readFile(join(ROOT, 'src/types/models.js'), 'utf8'),
      )
      && /export function debtInterest/.test(financeJs)
      && /data-total/.test(debtsJs)
      && /data-installment/.test(debtsJs)
      && /data-debt-calc/.test(debtsJs),
    hint: 'pengguna meminjam 8 jt tetapi harus melunasi 13 jt — kewajiban, bunga, dan cicilan wajib tersimpan sebagai data nyata',
  },
  {
    label: 'Bunga otomatis tampil sebagai persen di form, kartu, dan detail hutang',
    pass: /Bunga otomatis/.test(debtsJs)
      && /Bunga otomatis/.test(await readFile(join(ROOT, 'src/pages/debts.js'), 'utf8'))
      && /debt-interest/.test(cardsJs)
      && /\.debt-calc-grid \{/.test(await readFile(join(ROOT, 'src/styles/components.css'), 'utf8'))
      && /debtInterest\(debt\)/.test(await readFile(join(ROOT, 'src/services/finance.js'), 'utf8')),
    hint: 'angka bunga (%, flat, efektif, tenor) harus dihitung mesin, bukan diketik manual oleh pengguna',
  },
  {
    label: 'Sisa hutang, net worth, dan laporan memakai kewajiban (pokok + bunga)',
    pass: /const obligation = terms.obligation/.test(financeJs)
      && /Math.max\(0, obligation - paid\)/.test(financeJs)
      && /debtInterest\(d\)\.obligation/.test(await readFile(join(ROOT, 'src/app.js'), 'utf8'))
      && /debtInterest\(d\)\.obligation/.test(await readFile(join(ROOT, 'src/pages/reports.js'), 'utf8')),
    hint: 'kalau aset bertambah 8 jt, liabilitas harus 13 jt supaya kekayaan bersih jujur',
  },
  {
    label: 'Sheet pembayaran hutang menawarkan cicilan bulanan sebagai nominal default',
    pass: /data-fill="installment"/.test(ledgerJs)
      && /info\.terms\.installment/.test(ledgerJs),
    hint: 'pengguna membayar cicilan tetap tiap bulan (1.153.334) — jangan minta hitung manual',
  },
];
for (const inv of invariants) {
  if (inv.pass) ok(inv.label);
  else bad(`${inv.label} — ${inv.hint}`);
}

/* ------------------------------------------------ result ------------ */
console.log(`\n${problems === 0 ? '\u001b[32mAll integrity checks passed\u001b[0m' : `\u001b[31m${problems} problem(s) found\u001b[0m`}\n`);
process.exit(problems === 0 ? 0 : 1);
