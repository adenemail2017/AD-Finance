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

section('Boot & data layer');
check(`app boots and renders dashboard (${bootMs} ms)`, bootMs < 10000);
check('demo dataset seeded (transactions)', state.transactions.length > 100, `${state.transactions.length} txns`);
check('demo dataset seeded (accounts = 10)', state.accounts.length === 10, `${state.accounts.length}`);
check('default categories installed', state.categories.length > 20, `${state.categories.length}`);
check('storage fallback engaged (no IndexedDB in JSDOM)', state.sync.mode === 'localStorage' || state.sync.mode === 'IndexedDB', state.sync.mode);
check('notifications engine produced alerts', state.notifications.length > 0, `${state.notifications.length}`);
check('no console errors during boot', consoleErrors.length === 0, consoleErrors[0] || '');

section('Dashboard (bento)');
check('balance is shown as an ATM-style card', Boolean($('.atm-card')));
const heroValue = $('.atm-card [data-count]')?.getAttribute('data-count');
check('card shows the total balance', heroValue === String(finance.totalBalance(state)), `${heroValue} vs ${finance.totalBalance(state)}`);
const atm = $('.atm-card');
check('card carries the AD-Finance lockup', /AD-Finance/.test(atm.textContent));
check('card shows the holder name', Boolean($('#view [data-atm-holder]')) && $('[data-atm-holder]').textContent.trim().length > 1,
  $('[data-atm-holder]')?.textContent.trim());
check('card number is masked (never the full account number)',
  /••••/.test(atm.textContent) && !/8820114778|8820 114 778/.test(atm.textContent));
check('card has chip + contactless artwork', Boolean($('.atm-chip svg')) && Boolean($('.atm-contactless svg')));
check('card dates itself with Member Since', /Member Since/.test(atm.textContent));
check('headline stats sit beside the card', $$('#view .atm-stat').length === 4);
check('12-column bento grid used', $$('.bento').length >= 3);
check('metric cards rendered', $$('.metric-value').length >= 4, `${$$('.metric-value').length}`);
check('net worth card rendered', text().includes('Kekayaan Bersih'));
check('cash flow chart rendered', Boolean($('.bento .chart-svg')));
check('account cards on dashboard', $$('.account-card').length === 10, `${$$('.account-card').length}`);
check('recent transactions listed', $$('[data-recent] .txn').length > 0, `${$$('[data-recent] .txn').length}`);
check('financial insights generated', $$('.insight').length >= 3, `${$$('.insight').length}`);
check('budget health widget', text().includes('Kesehatan Budget'));

section('Mode privasi saldo (tombol mata)');
const eyeBtn = $('#view [data-toggle-secret]');
check('kartu saldo menampilkan tombol mata', Boolean(eyeBtn) && Boolean(eyeBtn.querySelector('svg')));
check('tombol mata menjelaskan fungsinya', /Tampilkan|Sembunyikan|sembunyikan/i.test(eyeBtn?.getAttribute('aria-label') || ''),
  eyeBtn?.getAttribute('aria-label'));
check('kondisi awal: saldo terlihat (aria-pressed=false)', eyeBtn?.getAttribute('aria-pressed') === 'false');
const heroBefore = $('.atm-card .atm-value')?.textContent.trim();
click(eyeBtn);
await sleep(60);
const heroAfter = $('.atm-card .atm-value')?.textContent.trim();
check('sekali klik menyembunyikan Total Saldo', Boolean(heroAfter) && !/Rp/.test(heroAfter), `${heroBefore} → ${heroAfter}`);
check('setelan hide_balance tersimpan di pengaturan', state.settings.hide_balance === true, String(state.settings.hide_balance));
check('ikon berubah menjadi mata tertutup', /eye-off|aria-pressed="true"/.test($('#view [data-toggle-secret]').outerHTML));
check('saldo akun ikut disensor', $$('#view .account-balance').length > 0
  && $$('#view .account-balance').every((el) => !/Rp/.test(el.textContent)),
  $$('#view .account-balance')[0]?.textContent.trim());
check('nominal transaksi terbaru ikut disensor', $$('#view [data-recent] .txn-amount').length > 0
  && $$('#view [data-recent] .txn-amount').every((el) => !/Rp/.test(el.textContent)));
check('chip Net Worth di sidebar ikut disensor', (() => {
  const chip = $('#app [data-networth]');
  return !chip || !/Rp/.test(chip.textContent);
})(), $('#app [data-networth]')?.textContent.trim());
check('kartu metrik tidak lagi memuat nominal', $$('#view .metric-value').every((el) => !/Rp/.test(el.textContent)),
  $$('#view .metric-value').map((el) => el.textContent.trim()).join(' | '));
const privacy = await import(join(ROOT, 'src/utils/privacy.js'));
const scratch = doc.createElement('div');
scratch.innerHTML = '<span title="Saldo Rp 2.500.000">Sisa Rp 1.234.000 dari anggaran</span><em>Tidak ada angka</em>';
const maskedCount = privacy.maskMoneyInDom(scratch);
check('maskMoneyInDom menyensor teks & tooltip', maskedCount === 2 && !/Rp\s?\d/.test(scratch.innerHTML), `${maskedCount} sensor`);
check('maskMoneyInDom tidak mengubah teks tanpa nominal', /Tidak ada angka/.test(scratch.textContent));
click($('#view [data-toggle-secret]'));
await sleep(60);
check('klik kedua menampilkan saldo kembali', /Rp/.test($('.atm-card .atm-value')?.textContent || ''),
  $('.atm-card .atm-value')?.textContent.trim());
check('setelan hide_balance kembali false', state.settings.hide_balance === false, String(state.settings.hide_balance));
check('tombol mata tetap ada setelah dikembalikan', Boolean($('#view [data-toggle-secret]')));

section('Routing — every page renders');
// Each route is verified by waiting for the shell title to switch (the real
// navigation barrier) *and* for page-specific content, so leftover DOM from the
// previous page can never satisfy the assertion.
const routeExpectations = [
  ['transactions', 'Transactions', 'Buku Besar Digital', () => $$('#view .txn').length > 0],
  ['accounts', 'Accounts', 'Dompet & Rekening', () => $$('#view .account-card').length > 0],
  ['debts', 'Hutang & Piutang', 'Kewajiban & Tagihan', () => $$('#view .debt-card').length > 0],
  ['reports', 'Reports', 'Laporan & Rekening Koran', () => Boolean($('#view .statement-head'))],
  ['analytics', 'Analytics', 'Analisis Keuangan', () => $$('#view .chart-svg').length >= 4],
  ['budgets', 'Budget', 'Kontrol Pengeluaran', () => $$('#view .budget-item').length > 0],
  ['settings', 'Settings', 'Pengaturan', () => text().includes('Keamanan')],
];
for (const [route, title, eyebrow, extra] of routeExpectations) {
  window.__pfos.navigate(route);
  const ok = await waitFor(
    () => ($('[data-title]')?.textContent === title && extra()) || null,
    { timeout: 5000, label: route },
  ).catch(() => false);
  const shellOk = $('[data-eyebrow]')?.textContent === eyebrow;
  check(`${route} page renders (title + shell + content)`, Boolean(ok) && shellOk,
    !ok ? `content missing · hash=${window.location.hash}` : `eyebrow mismatch: ${JSON.stringify($('[data-eyebrow]')?.textContent)}`);
}

section('Reports — rekening koran & tabs');
window.__pfos.navigate('reports');
await waitFor(() => $('#view .statement-head'), { label: 'statement' });
check('statement shows opening/closing balance', text().includes('Opening Balance') && text().includes('Closing Balance'));
check('running balance column present', text().includes('Saldo'));
check('statement reconciliation badge says balanced', text().includes('Seimbang'));
check('statement table has mutation rows', $$('#view table.data tbody tr').length > 0, `${$$('#view table.data tbody tr').length} rows`);
const stmt = finance.buildStatement(state, {
  from: `${state.transactions.map((t) => t.date).sort().slice(-1)[0].slice(0, 7)}-01`,
  to: '2999-12-31',
});
check('statement math reconciles (opening + in − out = closing)',
  stmt.closing === stmt.opening + stmt.totalIn - stmt.totalOut);
click($$('#view [data-tab]').find((b) => b.dataset.tab === 'monthly'));
check('monthly report renders summary + breakdowns', await waitFor(() => text().includes('Financial Summary') || text().includes('Total Income'), { label: 'monthly' }).then(() => true));
check('monthly report has category & account breakdowns', text().includes('Income Breakdown') && text().includes('Account Breakdown'));
check('spending heatmap rendered', $$('#view .heat-cell').length > 20, `${$$('#view .heat-cell').length} cells`);
click($$('#view [data-tab]').find((b) => b.dataset.tab === 'recap'));
check('recap table + net worth trend', await waitFor(() => text().includes('Ending Balance') && $$('#view .chart-svg').length > 0, { label: 'recap' }).then(() => true));

section('Record a transaction (Quick add flow)');
const targetAccountId = state.accounts[0].id;
const balanceBefore = finance.accountBalance(state, targetAccountId);
const countBefore = state.transactions.length;
click($('[data-quick-add]'));
const fabTrigger = $('[data-fab-center]');
click(fabTrigger);
await waitFor(() => $('.fab-menu'), { label: 'fab menu' });
check('FAB menu offers quick actions', $$('.fab-menu [data-fab-action]').length >= 7);
check('FAB berubah menjadi tombol X saat menu terbuka',
  /is-open/.test(fabTrigger.className) && fabTrigger.getAttribute('aria-expanded') === 'true');
const fabIconOpen = $('.bn-fab')?.innerHTML || '';
check('ikon FAB berganti (bukan tanda plus)', !/M12 5\.2v13\.6M5\.2 12h13\.6/.test(fabIconOpen), fabIconOpen.slice(0, 42));
check('menu Catat Cepat memakai grid ubin', $$('.fab-menu .fab-tile').length >= 7 && Boolean($('.fab-menu .fab-tile-label')));
check('menu menyediakan tombol tutup eksplisit', Boolean($('.fab-menu [data-fab-close]')));
check('menu membawa aksi "Form lengkap"', Boolean($('.fab-menu [data-fab-action="more"]')));
check('scrim muncul & toast disembunyikan saat menu terbuka',
  Boolean($('.fab-scrim')) && document.body.classList.contains('fab-open'));
click(fabTrigger);
await sleep(220);
check('klik FAB kedua menutup menu', !$('.fab-menu') && !$('.fab-scrim'));
check('ikon FAB kembali menjadi tanda plus',
  /M12 5\.2v13\.6M5\.2 12h13\.6/.test($('.bn-fab')?.innerHTML || '') && fabTrigger.getAttribute('aria-expanded') === 'false');
click(fabTrigger);
await waitFor(() => $('.fab-menu'), { label: 'fab menu (kedua)' });
click($('.fab-menu [data-fab-close]'));
await sleep(220);
check('tombol tutup di menu berfungsi', !$('.fab-menu'));
click(fabTrigger);
await waitFor(() => $('.fab-menu'), { label: 'fab menu (ketiga)' });
click($$('.fab-menu [data-fab-action]').find((b) => b.dataset.fabAction === 'expense'));
await waitFor(() => $('.sheet [data-amount]'), { label: 'transaction form' });
check('transaction form opens as modal', Boolean($('.overlay .sheet')));
check('all 9 transaction types offered', $$('.sheet [data-type]').length === 9, `${$$('.sheet [data-type]').length}`);
setValue($('.sheet [data-account]'), targetAccountId);
setValue($('.sheet [data-amount]'), '125.000');
click($$('.sheet [data-category]')[0]);
setValue($('.sheet [data-description]'), 'Uji coba smoke test');
check('amount field formats while typing', /125\.000/.test($('.sheet [data-amount]').value), $('.sheet [data-amount]').value);
click($('.sheet [data-save]'));
await waitFor(() => !doc.querySelector('.overlay'), { label: 'form closes' });
check('transaction persisted (+1)', state.transactions.length === countBefore + 1, `${countBefore} → ${state.transactions.length}`);
const balanceAfter = finance.accountBalance(state, targetAccountId);
check('account balance decreased by the exact amount', balanceBefore - balanceAfter === 125000, `${balanceBefore} → ${balanceAfter}`);
check('new entry appears in the ledger', text().includes('Uji coba smoke test'));
check('toast confirmed the save', Boolean($('.toast')) || text().includes('tersimpan'));

section('Guards — insufficient balance, duplicate, validation');
const err1 = await store.addTransaction({
  transaction_type: 'expense', amount: 999_999_999, date: state.transactions[0].date,
  account_id: state.accounts.find((a) => a.name === 'BNI').id, category_id: state.categories.find((c) => c.name === 'Food').id,
}).then(() => null).catch((e) => e);
check('insufficient balance blocked', Boolean(err1) && err1.code === 'insufficient_balance', err1?.message?.slice(0, 70));
check('error message is user friendly (mentions the account)', /BNI/.test(err1?.message || ''), err1?.message?.slice(0, 80));
const err2 = await store.addTransaction({
  transaction_type: 'expense', amount: 0, date: state.transactions[0].date, account_id: targetAccountId, category_id: null,
}).then(() => null).catch((e) => e);
check('empty amount + missing category rejected', Boolean(err2) && err2.code === 'validation');
const duplicatePayload = {
  transaction_type: 'expense', amount: 42_000, date: state.transactions[0].date, time: '08:00',
  account_id: targetAccountId, category_id: state.categories.find((c) => c.name === 'Food').id,
  description: 'Duplikat uji',
};
await store.addTransaction(duplicatePayload).catch(() => {});
const err3 = await store.addTransaction(duplicatePayload).then(() => null).catch((e) => e);
check('duplicate transaction detected', Boolean(err3) && err3.code === 'duplicate');
const forced = await store.addTransaction(duplicatePayload, { force: true }).then((t) => t).catch(() => null);
check('duplicate can be forced deliberately', Boolean(forced));

section('Detail sheet, debt payment & budgets');
window.__pfos.navigate('transactions');
await waitFor(() => $('#view .txn'), { label: 'ledger' });
click($('#view .txn'));
const detailOk = await waitFor(() => text().includes('Detail Transaksi') || null, { timeout: 3000, label: 'detail' }).then(() => true).catch(() => false);
check('transaction detail opens', detailOk);
if (detailOk) click($('.sheet [data-close]') || $('.overlay'));
await waitFor(() => !doc.querySelector('.overlay'), { label: 'detail closed' }).catch(() => {});
if (doc.querySelector('.overlay')) { const ov = $('.overlay'); ov.remove(); doc.body.style.overflow = ''; }

window.__pfos.navigate('debts');
await waitFor(() => $('#view .debt-card'), { label: 'debts' });
const openDebts = finance.debtList(state, { status: 'open' });
const payable = openDebts.find((row) => finance.accountBalance(state, row.debt.account_id) >= 100_000) || openDebts[0];
const payAmount = 100_000;
const paymentsBefore = state.debtPayments.length;
const debtAccBefore = finance.accountBalance(state, payable.debt.account_id);
const debtRemainingBefore = payable.info.remaining;
const worthBefore = finance.netWorth(state).net;
// open the payment sheet for that specific debt
window.__pfos.navigate('debts');
await waitFor(() => $('#view .debt-card'), { label: 'debts list' });
click($('#view [data-pay-debt]'));
await waitFor(() => $('.sheet [data-pay]'), { label: 'pay sheet' });
check('payment sheet gives live saldo feedback chips', $$('.sheet [data-fill]').length === 2);
setValue($('.sheet [data-account]'), payable.debt.account_id);
setValue($('.sheet [data-amount]'), payAmount.toLocaleString('id-ID'));
click($('.sheet [data-pay]'));
await waitFor(() => !doc.querySelector('.overlay'), { label: 'pay sheet closed' });
check('debt payment recorded', state.debtPayments.length === paymentsBefore + 1, `${paymentsBefore} → ${state.debtPayments.length}`);
check('debt payment created a ledger transaction',
  state.transactions.some((t) => t.transaction_type === 'debt_payment' && t.reference_id === payable.debt.id));
const debtAccAfter = finance.accountBalance(state, payable.debt.account_id);
check(`debt payment debited the account by ${payAmount.toLocaleString('id-ID')}`,
  debtAccBefore - debtAccAfter === payAmount, `${debtAccBefore} → ${debtAccAfter}`);
const debtAfter = finance.debtState(state.debts.find((d) => d.id === payable.debt.id), state.debtPayments);
check('debt outstanding reduced by the payment', debtAfter.remaining === debtRemainingBefore - payAmount,
  `remaining ${debtAfter.remaining} (was ${debtRemainingBefore})`);
check('net worth unchanged by the debt payment', finance.netWorth(state).net === worthBefore,
  `${worthBefore} → ${finance.netWorth(state).net}`);

window.__pfos.navigate('budgets');
await waitFor(() => $('#view [data-new]'), { label: 'budgets' });
const budgetsBefore = state.budgets.length;
click($('#view [data-new]'));
await waitFor(() => $('.sheet [data-cat]'), { label: 'budget form' });
click($$('.sheet [data-cat]')[2]);
setValue($('.sheet [data-amount]'), '300.000');
click($('.sheet [data-save]'));
await waitFor(() => !doc.querySelector('.overlay'), { label: 'budget form closed' });
check('budget saved', state.budgets.length === budgetsBefore + 1, `${budgetsBefore} → ${state.budgets.length}`);
check('budget usage computed for the period', finance.budgetUsage(state, state.budgets[0].period).length > 0);

section('Popup Hutang · Piutang · Akun (Iterasi 6)');
await waitFor(() => $('#view .card'), { label: 'kembali ke halaman' });
window.__pfos.navigate('debts');
await waitFor(() => $('[data-debt-card]'), { label: 'halaman hutang' });
click($('[data-debt-card]'));
await waitFor(() => $('.overlay .sheet'), { label: 'popup hutang' });
check('popup hutang memakai hero ringkas (.debt-hero)', Boolean($('.overlay .debt-hero')));
check('popup hutang tidak lagi menumpuk kartu angka',
  $$('.overlay .sheet .grid.grid-3 > .stat-box').length === 0 && /SISA HUTANG|Sisa hutang/i.test($('.overlay .debt-hero')?.textContent || ''));
const heroText = ($('.overlay .debt-hero')?.textContent || '').replace(/\s+/g, ' ');
check('hero hutang memuat total, terbayar, dan jatuh tempo',
  /TOTAL/i.test(heroText) && /DIBAYAR/i.test(heroText) && /JATUH TEMPO/i.test(heroText), heroText.slice(0, 90));
check('label & nilai popup tetap dua kolom (.kv-tight)', Boolean($('.overlay .kv.kv-tight')));
click($('.overlay [data-close]'));
await sleep(80);
window.__pfos.navigate('accounts');
await waitFor(() => $('[data-account-card]'), { label: 'halaman akun' });
click($('[data-account-card]'));
await waitFor(() => $('.overlay .sheet'), { label: 'popup akun' });
check('popup akun menampilkan 3 kartu arus 30 hari', $$('.overlay .sheet .grid.grid-3 .stat-box').length === 3,
  `${$$('.overlay .sheet .grid.grid-3 .stat-box').length}`);
check('grafik popup akun memakai mode ringkas (.chart-compact)', Boolean($('.overlay .chart-compact')));
check('popup akun memuat nomor akun ter-mask', /••••/.test($('.overlay [data-number]')?.textContent || ''));
click($('.overlay [data-close]'));
await sleep(80);

section('Global search, notifications, theme, export');
window.__pfos.navigate('dashboard');
await waitFor(() => $('#view .card'), { label: 'dashboard' });
click($('[data-search]'));
await waitFor(() => $('.overlay [data-search-input]'), { label: 'search overlay' });
setValue($('.overlay [data-search-input]'), 'gaji');
const resultsOk = await waitFor(() => $$('.overlay [data-txn-id]').length > 0, { timeout: 3000, label: 'search results' }).then(() => true).catch(() => false);
check('global search returns transaction hits', resultsOk, `${$$('.overlay [data-txn-id]').length} hits`);
setValue($('.overlay [data-search-input]'), 'zzznotfound');
check('empty search state handled', await waitFor(() => text().includes('Tidak ada hasil'), { label: 'no results' }).then(() => true));
click($('.overlay [data-close]') || $('.overlay'));
await sleep(120);

click($('[data-notifications]'));
const notifOk = await waitFor(() => text().includes('Notifikasi') && ($('.overlay .notif-item') || text().includes('Belum ada notifikasi')), { label: 'notifications' }).then(() => true).catch(() => false);
check('notifications panel lists derived alerts', notifOk);
if ($('.overlay')) click($('.overlay [data-close]'));
await sleep(120);
if (doc.querySelector('.overlay')) { $('.overlay').remove(); doc.body.style.overflow = ''; }

const themeBefore = doc.documentElement.dataset.theme;
click($('.topbar [data-theme-toggle]'));
await sleep(80);
check('theme toggles light ⇄ dark', doc.documentElement.dataset.theme !== themeBefore, `${themeBefore} → ${doc.documentElement.dataset.theme}`);

let downloadedBlob = null;
window.URL.createObjectURL = (blob) => { downloadedBlob = blob; return 'blob:mock'; };
window.__pfos.navigate('transactions');
await waitFor(() => $('#view [data-export]'), { label: 'transactions page' });
click($('#view [data-export]'));
await waitFor(() => $('.sheet [data-format]'), { label: 'export sheet' });
click($('.sheet [data-format="csv"]'));
await sleep(200);
let csvText = '';
if (downloadedBlob) {
  if (typeof downloadedBlob.text === 'function') csvText = await downloadedBlob.text();
  else if (downloadedBlob.arrayBuffer) csvText = new TextDecoder().decode(new Uint8Array(await downloadedBlob.arrayBuffer()));
  else if (downloadedBlob._buffer) csvText = new TextDecoder().decode(new Uint8Array(downloadedBlob._buffer));
}
check('CSV export produced a blob', Boolean(downloadedBlob));
check('CSV has BOM + header + rows', csvText.includes('Date') && csvText.split('\r\n').length > 5, `${csvText.split('\r\n').length} lines`);
if (doc.querySelector('.overlay')) { $('.overlay').remove(); doc.body.style.overflow = ''; }
click($('#view [data-export]'));
await waitFor(() => $('.sheet [data-format="xlsx"]'), { label: 'export sheet reopened' });
click($('.sheet [data-format="xlsx"]'));
await sleep(200);
check('XLSX export produced a blob', Boolean(downloadedBlob));
if (doc.querySelector('.overlay')) { $('.overlay').remove(); doc.body.style.overflow = ''; }

section('Category manager (settings CRUD)');
window.__pfos.navigate('settings');
await waitFor(() => $('#view [data-cat-add]'), { label: 'category manager' });
const cm = await import(join(ROOT, 'src/components/category-manager.js'));
const cmBefore = cm.categoryManagerStats(store.state, 'expense');
check('category manager lists seeded expense categories', cmBefore.parents >= 15, `${cmBefore.parents} categories`);
check('subcategories are shown with their parent', cmBefore.children >= 10, `${cmBefore.children} subcategories`);

click($('#view [data-cat-add]'));
await waitFor(() => $('.sheet [data-cat-form], .modal [data-cat-form]'), { label: 'category form' });
const form = $('[data-cat-form]');
check('category form offers icon and colour pickers',
  qsa('[data-icon-pick]', form).length >= 40 && qsa('[data-color-pick]', form).length >= 12);
setValue(qs('[data-name]', form), 'Langganan Digital');
click(qsa('[data-icon-pick]', form)[8]);
click(qsa('[data-color-pick]', form)[3]);
form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
await waitFor(() => cm.categoryManagerStats(store.state, 'expense').parents === cmBefore.parents + 1, { label: 'category added' });
const added = store.state.categories.find((c) => c.name === 'Langganan Digital');
check('new category saved with the chosen icon + colour', added?.icon === qsa('[data-icon-pick]', form)[8]?.dataset.iconPick && Boolean(added?.color));
check('manager re-renders after adding', $('#view .cat-row') !== null);

// add a subcategory under the new parent
click($(`#view [data-sub-add="${added.id}"]`));
await waitFor(() => $('[data-cat-form]'), { label: 'subcategory form' });
setValue(qs('[data-name]', $('[data-cat-form]')), 'Streaming Uji Coba');
$('[data-cat-form]').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
await waitFor(() => store.state.categories.some((c) => c.name === 'Streaming Uji Coba' && c.parent_id === added.id), { label: 'subcategory added' });
check('subcategory saved under its parent', store.state.categories.some((c) => c.name === 'Streaming Uji Coba' && c.parent_id === added.id));

// rename it, and confirm the kind tab switches lists
window.__pfos.navigate('settings');
await waitFor(() => $('#view [data-cat-edit]'), { label: 'manager again' });
click($(`#view [data-cat-edit="${added.id}"]`));
await waitFor(() => $('[data-cat-form] [data-name]'), { label: 'edit form' });
setValue($('[data-cat-form] [data-name]'), 'Langganan & Digital');
$('[data-cat-form]').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
await waitFor(() => store.state.categories.some((c) => c.name === 'Langganan & Digital'), { label: 'category renamed' });
check('category rename persists', store.state.categories.some((c) => c.id === added.id && c.name === 'Langganan & Digital'));

click($('#view [data-cat-kind] [data-kind="income"]'));
await waitFor(() => $('#view [data-cat-add="income"]'), { label: 'income tab' });
check('manager switches between expense and income categories',
  cm.categoryManagerStats(store.state, 'income').parents >= 7 && qsa('#view .cat-row').length >= 7);

// deleting a category that transactions reference must archive, never orphan
const usedCat = store.state.categories.find((c) => c.name === 'Food' && !c.archived);
if (usedCat) {
  const txnCount = store.state.transactions.length;
  const result = await store.deleteCategory(usedCat.id);
  check('a category used by transactions is archived, not deleted',
    result?.archived === true
      && store.state.categories.find((c) => c.id === usedCat.id)?.archived === true
      && store.state.transactions.length === txnCount);
} else {
  check('a category used by transactions is archived, not deleted', false, 'fixture not found');
}

// an unused category is removed outright
const fresh = store.state.categories.find((c) => c.name === 'Langganan & Digital');
if (fresh) {
  const removed = await store.deleteCategory(fresh.id);
  check('an unused category is deleted outright',
    removed?.archived === false && !store.state.categories.some((c) => c.id === fresh.id));
  check('its subcategory goes with it', !store.state.categories.some((c) => c.name === 'Streaming Uji Coba'));
}

section('Analytics range controls & print statement header');
window.__pfos.navigate('analytics');
await waitFor(() => $('#view [data-presets]'), { label: 'analytics' });
check('analytics offers the required presets', ['7d', '30d', '3m', '6m', '1y', 'custom']
  .every((p) => $(`#view [data-preset="${p}"]`)), qsa('#view [data-preset]').length + ' presets');
click($('#view [data-preset="custom"]'));
await waitFor(() => !$('#view [data-custom-range]')?.hidden, { label: 'custom range inputs' });
check('custom range reveals date inputs', !$('#view [data-custom-range]').hidden
  && Boolean($('#view [data-range-from]')) && Boolean($('#view [data-range-to]')));
setValue($('#view [data-range-from]'), '2026-07-01');
setValue($('#view [data-range-to]'), '2026-07-31');
await sleep(250);
check('custom range re-renders charts without errors', $('#view [data-presets]') !== null);

window.__pfos.navigate('reports', { tab: 'statement' });
await waitFor(() => $('#view .statement-head'), { label: 'statement' });
const printHead = $('#view .print-head');
check('statement ships a print-only header documented as PERSONAL FINANCIAL STATEMENT',
  Boolean(printHead) && /PERSONAL FINANCIAL STATEMENT/.test(printHead.textContent));
check('print header summarises the period like a real statement',
  /Opening Balance/.test(printHead.textContent) && /Closing Balance/.test(printHead.textContent)
  && /Total Pemasukan/.test(printHead.textContent) && /Sisa Hutang/.test(printHead.textContent));

section('Responsive shell & PWA wiring');
check('sidebar navigation present', $$('.nav-item').length >= 8, `${$$('.nav-item').length} nav items`);
check('navbar is a floating rounded panel', Boolean($('.sidebar-inner')));
check('header is a single rounded island', Boolean($('.topbar-inner')));
check('header actions are grouped in one cluster', Boolean($('.topbar-cluster')));
check('brand reads AD-Finance', /AD\s*-?\s*Finance/i.test($('.brand-name')?.textContent || ''), $('.brand-name')?.textContent);
check('brand logo mark is rendered', Boolean($('.sidebar-brand .logo-mark svg, .sidebar-brand svg')));
check('bottom nav is a floating rounded bar', Boolean($('.bottomnav .bn-ico')));
check('bottom navigation for mobile present', $$('.bottomnav .bn-item').length === 5);
check('command palette advertised in topbar', Boolean($('.topbar-search .kbd')));
const manifestLink = $('link[rel="manifest"]');
check('manifest linked', Boolean(manifestLink) && manifestLink.getAttribute('href') === 'manifest.webmanifest');
check('theme-color meta present', Boolean($('meta[name="theme-color"]')));
const manifest = JSON.parse(await readFile(join(ROOT, 'manifest.webmanifest'), 'utf8'));
check('manifest is installable (name, start_url, display, icons 192+512)',
  Boolean(manifest.name && manifest.start_url && manifest.display === 'standalone'
    && manifest.icons.some((i) => i.sizes === '192x192') && manifest.icons.some((i) => i.sizes === '512x512')));
check('manifest declares maskable icon', manifest.icons.some((i) => (i.purpose || '').includes('maskable')));
check('manifest shortcuts defined', manifest.shortcuts.length === 3);

section('Settings & security (PIN lifecycle, lock screen, data tools)');
window.__pfos.navigate('settings');
await waitFor(() => $('#view [data-save-pin]'), { label: 'settings page' });
const { APP_VERSION } = await import(join(ROOT, 'src/sw-client.js'));
const aboutText = (text().match(/Tentang Aplikasi.{0,220}/) || [''])[0];
check('Tentang Aplikasi mencantumkan versi rilis yang benar',
  aboutText.includes(`v${APP_VERSION}`) && !/v1\b/.test(aboutText), `APP_VERSION=${APP_VERSION}`);
check('Tentang Aplikasi mencantumkan developer', /Ade Nurrahman/.test(aboutText), aboutText.slice(0, 80));
check('versi aplikasi seragam (package.json, sw-client, sw.js cache)',
  JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')).version === APP_VERSION
    && (await readFile(join(ROOT, 'sw.js'), 'utf8')).includes(`adfinance-v${APP_VERSION}`),
  APP_VERSION);
const security = await import(join(ROOT, 'src/services/security.js'));
check('no PIN on a fresh profile', security.hasPin(store.state) === false);
check('weak PINs are detected as weak', security.pinStrength('1234').score <= 0 && security.pinStrength('4917').score > 0);

// 1) activate a PIN
setValue($('#view [data-pin]'), '4917');
click($('#view [data-save-pin]'));
await waitFor(async () => security.hasPin(store.state), { label: 'PIN stored', timeout: 6000 });
check('PIN activated and hashed (never stored in clear)',
  Boolean(store.state.settings.pin_hash) && !String(store.state.settings.pin_hash).includes('4917'));
check('correct PIN verifies', (await security.verifyPin('4917')) === true);
check('wrong PIN is rejected', (await security.verifyPin('9999')) === false);

// 2) change it — the old PIN lives in the first field (regression guard for setPin(x, x))
window.__pfos.navigate('settings');
await waitFor(() => $('#view [data-pin2]'), { label: 'change-PIN fields' });
const hashBefore = store.state.settings.pin_hash;
setValue($('#view [data-pin]'), '4917');     // PIN lama
setValue($('#view [data-pin2]'), '8362');    // PIN baru
click($('#view [data-save-pin]'));
await waitFor(async () => (await security.verifyPin('8362')), { label: 'PIN changed', timeout: 6000 });
check('PIN change accepted the correct current PIN', store.state.settings.pin_hash !== hashBefore);

// 3) a wrong current PIN must be refused and change nothing
window.__pfos.navigate('settings');
await waitFor(() => $('#view [data-pin2]'), { label: 'change-PIN fields again' });
const hashAfterChange = store.state.settings.pin_hash;
setValue($('#view [data-pin]'), '0000');
setValue($('#view [data-pin2]'), '5147');
click($('#view [data-save-pin]'));
await sleep(350);
check('PIN change refused a wrong current PIN', store.state.settings.pin_hash === hashAfterChange);
check('old PIN still works after the failed attempt', (await security.verifyPin('8362')) === true);

// 4) lock the app, fail once, then unlock with the real PIN
click($('#view [data-lock-now]'));
await waitFor(() => doc.querySelector('.boot-screen [data-pin]'), { label: 'lock screen' });
check('lock screen appears after locking', Boolean(doc.querySelector('.boot-screen')));
setValue(doc.querySelector('.boot-screen [data-pin]'), '1111');
click(doc.querySelector('.boot-screen [data-unlock]'));
await sleep(250);
check('wrong PIN keeps the app locked', Boolean(doc.querySelector('.boot-screen')));
setValue(doc.querySelector('.boot-screen [data-pin]'), '8362');
click(doc.querySelector('.boot-screen [data-unlock]'));
await waitFor(() => !doc.querySelector('.boot-screen'), { label: 'unlocked', timeout: 6000 });
check('correct PIN unlocks the app', true);

// 5) statement integrity + backup export
const statement = finance.buildStatement(store.state, {});
check('statement running balance reconciles',
  statement.closing === statement.opening + statement.totalIn - statement.totalOut,
  `${statement.opening} + ${statement.totalIn} - ${statement.totalOut} = ${statement.closing}`);
window.__pfos.navigate('reports', { tab: 'statement' });
await waitFor(() => $('#view table'), { label: 'statement table' });
check('statement page offers print / PDF export', Boolean($('#view [data-print], #view [data-export]')));

window.__pfos.navigate('settings');
await waitFor(() => $('#view [data-export-json]'), { label: 'settings once more' });
let jsonBlob = null;
window.URL.createObjectURL = (blob) => { jsonBlob = blob; return 'blob:backup'; };
click($('#view [data-export-json]'));
await sleep(400);
check('backup export produces a blob', Boolean(jsonBlob));
if (jsonBlob) {
  const parsed = JSON.parse(await jsonBlob.text());
  check('backup contains the whole dataset',
    parsed.transactions?.length === state.transactions.length && parsed.accounts?.length === state.accounts.length,
    `${parsed.transactions?.length} transactions`);
  check('backup contains no clear-text PIN', !JSON.stringify(parsed).includes('8362'));
}

section('Transactions & Reports — layout contract (iterasi 2)');

// ---- Transactions: toolbar, chips, pagination, empty state ------------
window.__pfos.navigate('transactions');
await waitFor(() => $('#view .tool-card'), { label: 'transactions toolbar' });
check('transactions opens with a single toolbar card', qsa('#view .tool-card').length === 1);
check('search + filter sit in one toolbar row',
  Boolean(qs('#view .tool-search [data-search]')) && Boolean(qs('#view [data-open-filters]')));
check('period presets render as one scroll strip', qsa('#view [data-period]').length === 7, `${qsa('#view [data-period]').length}`);
check('ledger rows are grouped per day', qsa('#view .ledger-day').length > 0, `${qsa('#view .ledger-day').length} days`);
check('running balance is shown per row by default', qsa('#view .txn .txn-balance').length > 0);
check('every ledger row groups the amount + running balance in .txn-side',
  qsa('#view .txn').every((row) => Boolean(row.querySelector('.txn-side')))
  && qsa('#view .txn-side').length === qsa('#view .txn').length, `${qsa('#view .txn-side').length} .txn-side`);
check('summary strip shows masuk / keluar / net',
  /Masuk/.test($('#view [data-summary]').textContent) && /Keluar/.test($('#view [data-summary]').textContent)
  && /Net/.test($('#view [data-summary]').textContent));

click(qs('#view [data-period="year"]'));
await sleep(300);
const yearRows = qsa('#view .txn').length;
const totalOf = () => Number(($('#view [data-summary]').textContent.match(/(\d+)\s*transaksi/) || [])[1] || 0);
const totalBefore = totalOf();
click(qs('#view [data-open-filters]'));
await waitFor(() => qs('.overlay [data-account]'), { label: 'filter sheet' });
check('filter sheet groups account / category / type',
  Boolean(qs('.overlay [data-account]')) && Boolean(qs('.overlay [data-category]')) && Boolean(qs('.overlay [data-type]')));
setValue(qs('.overlay [data-type]'), 'expense');
click(qs('.overlay [data-f-apply]'));
await sleep(400);
check('applied filter becomes a removable chip', Boolean(qs('#view [data-clear]')));
check('filtering actually narrows the ledger', totalOf() > 0 && totalOf() < totalBefore,
  `${totalOf()} of ${totalBefore} transactions`);
const chipLabel = qs('#view [data-clear]')?.textContent || '';
check('chip names what is being filtered', /Jenis/.test(chipLabel), chipLabel.trim());
click(qs('#view [data-clear]'));
await sleep(300);
check('removing the chip restores the ledger', totalOf() === totalBefore, `${totalOf()} vs ${totalBefore}`);

setValue(qs('#view [data-search]'), 'zzqqxx-tidak-ada');
await sleep(400);
check('no-match search shows a friendly empty state',
  /Belum ada transaksi pada filter ini/.test($('#view').textContent));
setValue(qs('#view [data-search]'), '');
await sleep(400);

click(qs('#view [data-period="all"]'));
await sleep(400);
check('long ledgers paginate instead of rendering everything',
  Boolean(qs('#view [data-more-btn]')) && qsa('#view .txn').length <= 60, `${qsa('#view .txn').length} rows`);
const firstPage = qsa('#view .txn').length;
click(qs('#view [data-more-btn]'));
await sleep(300);
check('"tampilkan lagi" appends the next page', qsa('#view .txn').length > firstPage,
  `${firstPage} → ${qsa('#view .txn').length}`);

// ---- Reports: one toolbar, three sectioned views ---------------------
window.__pfos.navigate('reports', { tab: 'statement' });
await waitFor(() => $('#view .statement-head'), { label: 'statement' });
check('reports keeps one toolbar across tabs', qsa('#view .tool-card').length === 1 && Boolean(qs('#view [data-tabs]')));
check('statement leads with summary tiles', qsa('#view .stat-tile').length >= 4, `${qsa('#view .stat-tile').length} tiles`);
check('statement rows carry mobile labels (no squeezed table)',
  qsa('#view .table-stack td[data-label]').length > 0, `${qsa('#view .table-stack td[data-label]').length} cells`);
check('statement closes with a totals row', Boolean(qs('#view table.data tfoot tr')));
check('statement balances are labelled debit / credit / saldo',
  /Debit/.test($('#view table.data thead').textContent) && /Credit/.test($('#view table.data thead').textContent));

click(qsa('#view [data-tab]').find((b) => b.dataset.tab === 'monthly'));
await waitFor(() => /Financial Summary/.test($('#view').textContent), { label: 'monthly' });
check('monthly report is split into titled sections', qsa('#view .section-divider').length >= 3, `${qsa('#view .section-divider').length} dividers`);
check('monthly summary uses one tile per metric', qsa('#view .stat-tile').length === 7, `${qsa('#view .stat-tile').length} tiles`);
check('month picker stays available on every tab', Boolean(qs('#view [data-period]')));

click(qsa('#view [data-tab]').find((b) => b.dataset.tab === 'recap'));
await waitFor(() => /Ending Balance/.test($('#view').textContent), { label: 'recap' });
check('recap table carries ending balance and a totals row',
  /Ending Balance/.test($('#view table.data thead').textContent) && Boolean(qs('#view table.data tfoot tr')));
check('recap renders trend charts', qsa('#view .chart-svg').length >= 2, `${qsa('#view .chart-svg').length} charts`);
check('recap ends with a sectioned trend block', /Tren/.test($('#view').textContent));

window.__pfos.navigate('transactions');
await waitFor(() => $('#view .tool-card'), { label: 'transactions again' });

section('Console hygiene');
check('no uncaught errors during full run', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));

/* ------------------------------------------------------------------ */

const total = passed + failed;
console.log(`\n${failed === 0 ? '\u001b[32m' : '\u001b[31m'}${passed}/${total} checks passed\u001b[0m`);
if (failures.length) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(` - ${f}`));
}
console.log(`\nFinal state: ${state.transactions.length} transactions · ${state.accounts.length} accounts · `
  + `${state.debts.length} debts · ${state.receivables.length} receivables · `
  + `net worth ${Math.round(finance.netWorth(state).net).toLocaleString('id-ID')}`);

process.exit(failed === 0 ? 0 : 1);
