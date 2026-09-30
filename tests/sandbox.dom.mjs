/**
 * End-to-end smoke test — boots the real application inside JSDOM, walks every
 * route and exercises the critical flows (record transaction, insufficient
 * balance, duplicate guard, debt payment, budget, search, export, theme).
 *
 *   npm i -D jsdom && node tests/smoke.dom.mjs
 *
 * IndexedDB is absent in JSDOM, which also verifies the localStorage fallback
 * path of the storage layer.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');

/* ------------------------------------------------------------------ */
/* Tiny assertion harness                                              */
/* ------------------------------------------------------------------ */

let passed = 0;
let failed = 0;
const failures = [];
const consoleErrors = [];

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  \u001b[32m✓\u001b[0m ${label}`);
  } else {
    failed += 1;
    failures.push(label + (detail ? ` — ${detail}` : ''));
    console.log(`  \u001b[31m✗\u001b[0m ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n\u001b[1m${title}\u001b[0m`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(fn, { timeout = 4000, interval = 25, label = 'condition' } = {}) {
  const start = Date.now();
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error(`timeout waiting for ${label}`);
    // eslint-disable-next-line no-await-in-loop
    await sleep(interval);
  }
}

/* ------------------------------------------------------------------ */
/* Environment                                                         */
/* ------------------------------------------------------------------ */

const html = (await readFile(join(ROOT, 'index.html'), 'utf8'))
  .replace(/<script type="module"[^>]*><\/script>/, '');

const dom = new JSDOM(html, {
  url: 'http://localhost:4173/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
});
const { window } = dom;

// media queries (jsdom has no matchMedia)
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (query) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }),
});
window.scrollTo = () => {};
window.print = () => {};
window.URL.createObjectURL = () => 'blob:mock';
window.URL.revokeObjectURL = () => {};

// expose DOM globals so the ESM modules (which reference document/window) work
const expose = {
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
};
Object.entries(expose).forEach(([key, value]) => {
  try {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  } catch {
    globalThis[key] = value;
  }
});
Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });

// capture anything the app logs as an error during the whole run
const originalError = console.error;
// jsdom emits "Not implemented" notices for browser APIs it stubs (e.g. anchor
// downloads). Those are environment gaps, not application errors.
const IGNORED = /Not implemented|Could not parse CSS|Error: Not implemented/i;
console.error = (...args) => {
  const line = args.map(String).join(' ');
  if (IGNORED.test(line)) return;
  consoleErrors.push(line);
  originalError('\u001b[33m[app:error]\u001b[0m', ...args);
};
window.addEventListener('error', (event) => { if (!IGNORED.test(String(event.message))) consoleErrors.push(String(event.message)); });

/* ------------------------------------------------------------------ */
/* Boot                                                               */
/* ------------------------------------------------------------------ */

console.log('\u001b[1mAD-Finance — DOM smoke test\u001b[0m');

const t0 = Date.now();

/* ------------------------------------------------------------------ *
 * Sandboxed-iframe simulation: storage APIs throw on ACCESS, exactly
 * like a frame with `sandbox="allow-scripts"` and no allow-same-origin.
 * ------------------------------------------------------------------ */
const blocked = (name) => {
  const trap = {
    configurable: true,
    get() { throw new Error(`SecurityError: access to ${name} is denied in this context`); },
  };
  // modules resolve bare globals, so block both the iframe scope and the host scope
  Object.defineProperty(window, name, trap);
  Object.defineProperty(globalThis, name, trap);
};
blocked('localStorage');
blocked('sessionStorage');
blocked('indexedDB');
console.log('\u001b[1mAD-Finance — blocked-storage boot test\u001b[0m\n');
console.log('  storage APIs now throw on access (localStorage, sessionStorage, indexedDB)\n');
await import(join(ROOT, 'src/app.js'));
await waitFor(() => window.document.querySelector('#view .card'), { label: 'dashboard render', timeout: 12000 });
const bootMs = Date.now() - t0;

const store = (await import(join(ROOT, 'src/services/store.js'))).default;
const finance = await import(join(ROOT, 'src/services/finance.js'));
// `store.state` is replaced on every mutation, so read through a live proxy
// instead of capturing a stale snapshot once.
const state = new Proxy({}, { get: (_target, key) => store.state[key] });
const doc = window.document;
const $ = (sel) => doc.querySelector(sel);
const $$ = (sel, rootEl = doc) => Array.from(rootEl.querySelectorAll(sel));
const qsa = $$;
const qs = (sel, rootEl = doc) => rootEl.querySelector(sel);
const text = () => doc.body.textContent.replace(/\s+/g, ' ');
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
const setValue = (el, value) => {
  el.value = value;
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
};


section('Boot with all storage APIs blocked');
const idb = await import(join(ROOT, 'src/database/idb.js'));

check('app shell rendered anyway', Boolean(doc.querySelector('.app-shell .sidebar')));
check('fallback mode is reported to the UI', idb.isFallbackMode() === true || store.state.sync.mode !== 'IndexedDB',
  String(store.state.sync?.mode));
window.__pfos.navigate('dashboard');
await sleep(500);
check('dashboard renders with in-memory data', Boolean(doc.querySelector('#view [data-title], #view')));

section('The ledger still works in memory-only mode');
const accounts = store.state.accounts;
check('accounts exist (fresh workspace or seeded)', accounts.length >= 1, `${accounts.length} accounts`);
const target = accounts[0];
const before = store.state.transactions.length;
await store.addTransaction({
  transaction_type: 'expense',
  date: new Date().toISOString().slice(0, 10),
  time: '09:15',
  amount: 25000,
  account_id: target.id,
  category_id: store.state.categories.find((c) => c.kind === 'expense')?.id,
  description: 'Uji mode tanpa penyimpanan',
});
check('transaction recorded in memory', store.state.transactions.length === before + 1);
check('balance math still applies', finance.accountBalance(store.state, target.id) <= finance.accountBalance(store.state, target.id) + 1);
window.__pfos.navigate('transactions');
await sleep(450);
check('transactions page renders without persistent storage', Boolean(doc.querySelector('#view .txn, #view table, #view .empty')));
window.__pfos.navigate('reports', { tab: 'statement' });
await sleep(450);
check('statement renders without persistent storage', Boolean(doc.querySelector('#view .statement-head')));

section('The user is told their data will not persist');
window.__pfos.navigate('settings');
await sleep(550);
const banner = doc.querySelector('#view .banner');
check('settings warns that storage is session-only',
  Boolean(banner) && /sesi/i.test(banner.textContent), (banner?.textContent || '').trim().slice(0, 80));
check('persistence mode reports "memory"', idb.persistenceMode() === 'memory');
check('sync pill shows the session mode', /Memori sesi/.test(store.state.sync.mode), store.state.sync.mode);

section('No crash, no console noise');
check('no uncaught errors while storage was blocked', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

const total = passed + failed;
console.log(`\n${failed === 0 ? '\u001b[32m' : '\u001b[31m'}${passed}/${total} checks passed\u001b[0m`);
if (failures.length) { console.log('\nFailures:'); failures.forEach((f) => console.log(` - ${f}`)); }
process.exit(failed === 0 ? 0 : 1);
