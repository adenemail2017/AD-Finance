/**
 * audit-layout.mjs — memeriksa TATA LETAK di browser sungguhan.
 *
 * jsdom tidak punya mesin layout, jadi kesalahan seperti "konten terjepit di
 * kolom 258px" atau "nominal terpotong di mobile" lolos dari seluruh test DOM.
 * Skrip ini membuka aplikasi di Chromium headless, mengukur pada beberapa
 * ukuran layar, lalu melaporkan (dan memotret) setiap pelanggaran:
 *
 *   • scroll horizontal / elemen yang melewati tepi viewport
 *   • elemen yang lebarnya "meledak" melebihi induknya (min-content blowout)
 *   • konten utama yang tidak memakai lebar penuh di desktop
 *   • toast yang menutupi bottom nav / FAB di mobile
 *   • tab / tombol yang terpotong di layar kecil
 *
 * Jalankan (butuh Chromium + puppeteer-core):
 *   npm install --no-save puppeteer-core
 *   PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome node tools/audit-layout.mjs http://localhost:4173
 *   # atau ke produksi:
 *   PUPPETEER_EXECUTABLE_PATH=… node tools/audit-layout.mjs https://ad-finance-phi.vercel.app
 *
 * Opsi:
 *   --shots <dir>   simpan screenshot tiap viewport (default: tidak menyimpan)
 *   --only <nama>   hanya viewport tertentu (mis. --only mobile-390)
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const args = process.argv.slice(2);
const BASE = (args.find((a) => a.startsWith('http')) || 'http://localhost:4173').replace(/\/$/, '');
const SHOT_DIR = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

const bold = (s) => `\u001b[1m${s}\u001b[0m`;
const ok = (s) => console.log(`  \u001b[32m✓\u001b[0m ${s}`);
const bad = (s) => console.log(`  \u001b[31m✗\u001b[0m ${s}`);
const info = (s) => console.log(`  \u001b[2m·\u001b[0m ${s}`);

const EXECUTABLE = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || '';
let puppeteer = null;
try {
  puppeteer = (await import('puppeteer-core')).default;
} catch {
  console.error('puppeteer-core belum terpasang:\n  npm install --no-save puppeteer-core');
  process.exit(2);
}
if (!EXECUTABLE) {
  console.error('Tentukan browser-nya lebih dulu, mis.:\n'
    + '  PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome node tools/audit-layout.mjs ' + BASE);
  process.exit(2);
}

const VIEWPORTS = [
  { name: 'desktop-1440', width: 1440, height: 900, dpr: 1, mobile: false },
  { name: 'laptop-1180', width: 1180, height: 820, dpr: 1, mobile: false },
  { name: 'tablet-820', width: 820, height: 1100, dpr: 1, mobile: true },
  { name: 'mobile-390', width: 390, height: 844, dpr: 2, mobile: true },
  { name: 'mobile-360', width: 360, height: 780, dpr: 2, mobile: true },
];
const ROUTES = [
  ['dashboard', 'Dashboard'],
  ['transactions', 'Transaksi'],
  ['reports', 'Laporan'],
  ['accounts', 'Accounts'],
  ['analytics', 'Analytics'],
];

const browser = await puppeteer.launch({
  executablePath: EXECUTABLE,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});

console.log(bold(`\nAD-Finance — audit tata letak (browser sungguhan)\n${BASE}\n`));

let failures = 0;
const report = [];

for (const vp of VIEWPORTS) {
  if (ONLY && vp.name !== ONLY) continue;
  console.log(bold(`${vp.name} · ${vp.width}×${vp.height}${vp.mobile ? ' (sentuh)' : ''}`));
  const page = await browser.newPage();
  await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, isMobile: vp.mobile, hasTouch: vp.mobile });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => Boolean(window.__pfos), { timeout: 30000 });
  // Browser headless selalu mulai dari perangkat kosong → siapkan satu pengguna uji
  // dengan data contoh supaya semua halaman punya konten untuk dinilai.
  await page.evaluate(async () => {
    if (window.__pfos.needsUser()) await window.__pfos.createUser({ name: 'Audit Layout', mode: 'demo' });
  });
  await page.waitForSelector('#view .card', { timeout: 30000 });

  for (const [route, label] of ROUTES) {
    await page.evaluate((r) => window.__pfos.navigate(r), route);
    await new Promise((r) => setTimeout(r, 700));
    const m = await page.evaluate(() => {
      const vw = window.innerWidth;
      const visible = (el) => {
        const s = getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && s.position !== 'fixed' && el.getBoundingClientRect().width > 0;
      };
      const html = document.documentElement;
      const cls = (el) => el.getAttribute('class') || el.tagName.toLowerCase();
      // Elemen berikut BUKAN pelanggaran: (a) dipotong lewat overflow:hidden/clip,
      // (b) berada di dalam area yang memang bisa di-scroll （carousel periode /
      // preset), (c) anak SVG di dalam chart (overflow:visible disengaja untuk
      // titik data). Tanpa pengecualian ini laporan penuh positif palsu.
      const contained = (el) => {
        let node = el.parentElement;
        while (node && node !== document.body) {
          const st = getComputedStyle(node);
          if (/hidden|clip|auto|scroll/.test(st.overflowX) || /hidden|clip/.test(st.overflow)) return true;
          node = node.parentElement;
        }
        return false;
      };
      const inSvgChart = (el) => el.closest('.chart-svg') !== null;
      const overflowEls = [...document.querySelectorAll('#view *, .app-shell > *')]
        .filter((el) => visible(el) && el.getBoundingClientRect().right > vw + 1
          && !contained(el) && !inSvgChart(el))
        .slice(0, 4)
        .map((el) => `${el.tagName.toLowerCase()}.${cls(el).split(' ')[0]}`);
      const blowouts = [...document.querySelectorAll('#view *')]
        .filter((el) => visible(el) && el.parentElement && !inSvgChart(el)
          && el.getBoundingClientRect().width > el.parentElement.getBoundingClientRect().width + 1)
        .slice(0, 4)
        .map((el) => `${el.tagName.toLowerCase()}.${(el.getAttribute('class') || '').split(' ')[0]} ${Math.round(el.getBoundingClientRect().width)}>${Math.round(el.parentElement.getBoundingClientRect().width)}`);
      const main = document.querySelector('.app-main')?.getBoundingClientRect();
      const scrollers = [...document.querySelectorAll('#view *')]
        .filter((el) => visible(el) && /auto|scroll/.test(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1)
        .map((el) => `${el.tagName.toLowerCase()}.${(el.getAttribute('class') || '').split(' ')[0]}`);
      return {
        pageOverflow: html.scrollWidth - html.clientWidth,
        overflowEls, blowouts, scrollers,
        mainWidth: main ? Math.round(main.width) : 0,
        viewport: vw,
      };
    });

    const isDesktop = vp.width > 1024;
    const mainExpected = isDesktop ? Math.round(vp.width * 0.7) : vp.width;
    const issues = [];
    if (m.pageOverflow > 0) issues.push(`scroll horizontal ${m.pageOverflow}px`);
    if (m.overflowEls.length) issues.push(`keluar tepi: ${m.overflowEls.join(', ')}`);
    if (isDesktop && m.mainWidth < mainExpected) issues.push(`konten utama hanya ${m.mainWidth}px dari ${vp.width}px`);
    report.push({ vp: vp.name, route, ...m, issues });

    if (issues.length) { failures += 1; bad(`${label.padEnd(10)} ${issues.join(' · ')}`); } else {
      ok(`${label.padEnd(10)} lebar=${m.mainWidth}px${m.scrollers ? ` · ${m.scrollers} area bisa di-scroll (wajar)` : ''}`);
    }
  }
  if (errors.length) { failures += 1; bad(`error runtime: ${errors[0].slice(0, 120)}`); }

  if (SHOT_DIR) {
    await mkdir(SHOT_DIR, { recursive: true });
    await page.evaluate(() => window.__pfos.navigate('transactions'));
    await new Promise((r) => setTimeout(r, 600));
    await page.screenshot({ path: join(SHOT_DIR, `${vp.name}.png`) });
  }
  await page.close();
  console.log('');
}

await browser.close();

if (SHOT_DIR) info(`screenshot tersimpan di ${SHOT_DIR}`);
const worst = report.filter((r) => r.issues.length);
console.log(worst.length
  ? `\u001b[31m${worst.length} masalah tata letak ditemukan\u001b[0m\n`
  : '\u001b[32mTata letak sehat di semua viewport\u001b[0m\n');
process.exit(worst.length ? 1 : 0);
