/**
 * run-tests.mjs — menjalankan seluruh unit/API test dengan cara yang sama di
 * Node 20 maupun Node 22 (dan di Linux, macOS, juga Windows).
 *
 * Kenapa tidak `node --test tests/` saja?
 *   Node 20 menerima direktori sebagai argumen, Node 22 tidak — argumen
 *   posisi diperlakukan sebagai berkas modul sehingga gagal dengan
 *   "Cannot find module '.../tests'". Globbing dari shell juga tidak portabel
 *   (cmd.exe tidak meng-expand `*`). Skrip ini menemukan berkasnya sendiri lalu
 *   menyerahkan daftar eksplisit ke test runner, jadi hasilnya identik di semua
 *   lingkungan dan berkas tes baru otomatis ikut terjalankan.
 *
 *   node tools/run-tests.mjs
 *   node tools/run-tests.mjs --test-concurrency=1     # argumen tambahan diteruskan
 */

import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TESTS_DIR = join(ROOT, 'tests');

const entries = await readdir(TESTS_DIR, { withFileTypes: true });
const files = entries
  .filter((e) => e.isFile() && e.name.endsWith('.test.mjs'))
  .map((e) => e.name)
  .sort();

if (!files.length) {
  console.error('Tidak ada berkas tests/*.test.mjs untuk dijalankan.');
  process.exit(1);
}

const args = [...process.argv.slice(2), ...files.map((f) => relative(process.cwd(), join(TESTS_DIR, f))).map((p) => p.split('\\').join('/'))];
console.log(`\u001b[1mAD-Finance — unit & API tests\u001b[0m (${files.length} berkas, node ${process.version})\n`);

const child = spawn(process.execPath, ['--test', ...args], { cwd: ROOT, stdio: 'inherit' });
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1));
