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

/* ------------------------------------------------ result ------------ */
console.log(`\n${problems === 0 ? '\u001b[32mAll integrity checks passed\u001b[0m' : `\u001b[31m${problems} problem(s) found\u001b[0m`}\n`);
process.exit(problems === 0 ? 0 : 1);
