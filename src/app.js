/**
 * AD-Finance — application shell.
 *
 * Responsibilities: boot sequence, hash router, responsive chrome
 * (sidebar / bottom nav / FAB), theme, notifications surface, global search,
 * keyboard shortcuts, PWA install + service worker wiring.
 */

import store from './services/store.js';
import { unreadCount, refreshNotifications } from './services/notifications.js';
import { hasPin, isUnlocked, markUnlocked, verifyPin } from './services/security.js';
import { registerServiceWorker, checkForUpdate, cacheVersion } from './sw-client.js';
import { esc, on, qs, qsa } from './utils/dom.js';
import { MASK, money, initialsOf, formatPhone, phoneValid } from './utils/format.js';
import { formatMonth, todayISO, monthKey } from './utils/date.js';
import { icon, iconTile, logoMark } from './components/icons.js';
import {
  badgeHtml, closeDropdown, closeTopOverlay, confirmDialog, emptyState, isOverlayOpen, openAdaptive, toast,
} from './components/ui.js';
import { openTransactionForm } from './components/ledger.js';

import { dashboardPage } from './pages/dashboard.js';
import { transactionsPage } from './pages/transactions.js';
import { accountsPage } from './pages/accounts.js';
import { debtsPage } from './pages/debts.js';
import { reportsPage } from './pages/reports.js';
import { analyticsPage } from './pages/analytics.js';
import { budgetsPage } from './pages/budgets.js';
import { settingsPage } from './pages/settings.js';
import { openSearchOverlay } from './pages/search.js';

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

const ROUTES = {
  dashboard: dashboardPage,
  transactions: transactionsPage,
  accounts: accountsPage,
  debts: debtsPage,
  reports: reportsPage,
  analytics: analyticsPage,
  budgets: budgetsPage,
  settings: settingsPage,
};

const NAV_PRIMARY = [
  { route: 'dashboard', label: 'Dashboard', short: 'Home', icon: 'home', key: '1' },
  { route: 'transactions', label: 'Transactions', short: 'Transaksi', icon: 'list', key: '2' },
  { route: 'accounts', label: 'Accounts', short: 'Akun', icon: 'wallet', key: '3' },
  { route: 'debts', label: 'Hutang & Piutang', short: 'Hutang', icon: 'hand-coins', key: '4' },
  { route: 'reports', label: 'Reports', short: 'Laporan', icon: 'file-chart', key: '5' },
  { route: 'analytics', label: 'Analytics', short: 'Analitik', icon: 'chart', key: '6' },
  { route: 'budgets', label: 'Budget', short: 'Budget', icon: 'target', key: '7' },
];

const NAV_SECONDARY = [
  { route: 'settings', label: 'Settings', icon: 'settings', key: '8' },
];

const BOTTOM_NAV = [
  { route: 'dashboard', label: 'Home', icon: 'home' },
  { route: 'transactions', label: 'Transaksi', icon: 'list' },
  { route: 'accounts', label: 'Akun', icon: 'wallet' },
  { route: 'reports', label: 'Laporan', icon: 'file-chart' },
  { route: 'more', label: 'Lainnya', icon: 'more-horizontal' },
];

const FAB_ACTIONS = [
  { key: 'expense', label: 'Pengeluaran', icon: 'trending-down', color: 'var(--neg)' },
  { key: 'income', label: 'Pemasukan', icon: 'trending-up', color: 'var(--pos)' },
  { key: 'transfer', label: 'Transfer antar akun', icon: 'switch', color: 'var(--brand-500)' },
  { key: 'debt_payment', label: 'Bayar hutang', icon: 'hand-coins', color: 'var(--warn)' },
  { key: 'receivable_payment', label: 'Terima piutang', icon: 'circle-check', color: 'var(--info)' },
  { key: 'investment', label: 'Investasi', icon: 'chart', color: 'var(--accent)' },
  { key: 'emergency_fund', label: 'Dana darurat', icon: 'shield', color: '#0d9488' },
];

/* ------------------------------------------------------------------ */
/* App state (UI only)                                                 */
/* ------------------------------------------------------------------ */

const ui = {
  route: 'dashboard',
  params: {},
  cleanup: null,
  theme: 'system',
  installEvent: null,
  deferredLock: false,
};

let root = null;

/* ------------------------------------------------------------------ */
/* Theme                                                               */
/* ------------------------------------------------------------------ */

function applyTheme(mode) {
  ui.theme = mode;
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const resolved = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themeMode = mode;
  const meta = qs('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#070b14' : '#f4f6fb');
  qsa('[data-theme-icon]').forEach((el) => {
    el.innerHTML = icon(mode === 'dark' ? 'moon' : mode === 'light' ? 'sun' : 'monitor', { size: 18 });
  });
  try { localStorage.setItem('pfos:theme', mode); } catch { /* ignore */ }
}

function toggleTheme() {
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const current = document.documentElement.dataset.theme;
  const next = current === 'dark' ? 'light' : 'dark';
  store.updateProfile({ theme: next });
  applyTheme(next);
  void systemDark;
  toast(`Mode ${next === 'dark' ? 'gelap' : 'terang'} aktif.`, { duration: 1500 });
}

/* ------------------------------------------------------------------ */
/* Shell rendering                                                     */
/* ------------------------------------------------------------------ */

function shellHtml() {
  const state = store.state;
  return `
    <div class="sidebar-scrim" data-scrim></div>
    <aside class="sidebar" aria-label="Navigasi utama">
      <div class="sidebar-inner">
        <div class="sidebar-brand">
          ${logoMark(38, { radius: 12 })}
          <div class="brand-text">
            <span class="brand-name">AD<span>-Finance</span></span>
            <span class="brand-tag">Money Command Center</span>
          </div>
        </div>

        <nav class="sidebar-nav" aria-label="Menu">
          <div class="nav-section-label">Utama</div>
          ${NAV_PRIMARY.map((item) => navItemHtml(item, state)).join('')}
          <div class="nav-section-label">Lainnya</div>
          ${NAV_SECONDARY.map((item) => navItemHtml(item, state)).join('')}
        </nav>

        <div class="sidebar-foot">
          <div class="networth-chip">
            <div class="nw-top">
              <span class="nw-label">${icon('wallet', { size: 13 })} Net Worth</span>
              <span class="nw-dot" aria-hidden="true"></span>
            </div>
            <div class="nw-value" data-networth>${esc(money(netWorthValue(state)))}</div>
            <button class="btn btn-sm btn-block btn-quick hide-collapsed" data-quick-add>
              ${icon('plus', { size: 15 })} Transaksi baru
            </button>
          </div>
          <button class="sidebar-collapse" data-toggle-sidebar title="Perkecil sidebar" aria-label="Perkecil sidebar">
            ${icon('panel-left', { size: 17 })}<span class="hide-collapsed">Perkecil menu</span>
          </button>
        </div>
      </div>
    </aside>

    <div class="app-main">
      <header class="topbar">
        <div class="topbar-inner">
          <button class="icon-btn mobile-only" data-drawer aria-label="Buka menu">${icon('list', { size: 20 })}</button>
          <div class="topbar-title">
            <span class="topbar-eyebrow" data-eyebrow></span>
            <h1 data-title>Dashboard</h1>
          </div>
          <div class="topbar-actions">
            <button class="topbar-search" data-search aria-label="Cari transaksi, akun… (Ctrl+K)">
              ${icon('search', { size: 16 })}
              <span class="search-label">Cari</span>
              <span class="kbd">⌘K</span>
            </button>
            <div class="topbar-cluster">
              <span class="online-pill" data-connection title="Status koneksi">${icon('wifi', { size: 14 })}<span class="online-text">Online</span></span>
              <span class="cluster-sep" aria-hidden="true"></span>
              <button class="icon-btn" data-theme-toggle aria-label="Ganti tema" title="Ganti tema">
                <span data-theme-icon>${icon('moon', { size: 18 })}</span>
              </button>
              <button class="icon-btn" data-notifications aria-label="Notifikasi" title="Notifikasi">
                ${icon('bell', { size: 18 })}
                <span class="dot-badge" data-notif-dot hidden></span>
              </button>
              <button class="avatar" data-profile title="${esc(state.profile.name)}">${esc(initialsOf(state.profile.name))}</button>
            </div>
          </div>
        </div>
      </header>
      <main id="view" class="page" role="main"></main>
    </div>

    <nav class="bottomnav" aria-label="Navigasi bawah">
      <div class="bottomnav-inner">
        ${BOTTOM_NAV.map((item) => (item.route === 'accounts'
    ? `<a class="bn-item is-center" href="#" data-fab-center aria-label="Tambah transaksi">
              <span class="bn-fab">${icon('plus', { size: 25 })}</span>
              <span class="bn-label">Tambah</span>
            </a>`
    : `<a class="bn-item" href="#/${item.route}" data-nav="${item.route}">
              <span class="bn-ico">${icon(item.icon, { size: 20 })}</span><span class="bn-label">${esc(item.label)}</span>
            </a>`)).join('')}
      </div>
    </nav>

    <button class="fab desktop-only" data-quick-add aria-label="Transaksi baru" aria-expanded="false">
      <span class="fab-ico">${icon('plus', { size: 20 })}</span><span class="fab-label">Transaksi</span>
    </button>
  `;
}

function navItemHtml(item, state) {
  const badge = item.route === 'debts' ? overdueBadge(state) : '';
  return `<a class="nav-item" href="#/${item.route}" data-nav="${item.route}">
    ${icon(item.icon, { size: 19 })}
    <span class="grow">${esc(item.label)}</span>
    ${badge}
    <span class="kbd hide-collapsed" style="opacity:.55">${item.key}</span>
  </a>`;
}

function overdueBadge(state) {
  const count = state.debts.filter((d) => d.status === 'overdue').length
    + state.receivables.filter((r) => r.status === 'overdue').length;
  return count ? `<span class="nav-badge">${count}</span>` : '';
}

function netWorthValue(state) {
  const balances = new Map();
  state.accounts.forEach((a) => balances.set(a.id, a.opening_balance));
  state.transactions.forEach((t) => {
    const amount = Math.abs(t.amount);
    if (t.account_id) {
      const out = !['income', 'debt', 'receivable_payment'].includes(t.transaction_type);
      balances.set(t.account_id, (balances.get(t.account_id) || 0) + (out ? -amount : amount));
    }
    if (t.destination_account_id) balances.set(t.destination_account_id, (balances.get(t.destination_account_id) || 0) + amount);
  });
  const accounts = [...balances.values()].reduce((a, b) => a + b, 0);
  const rec = state.receivables.reduce((acc, r) => acc + Math.max(0, r.principal
    - state.receivablePayments.filter((p) => p.receivable_id === r.id).reduce((s, p) => s + p.amount, 0)), 0);
  const debt = state.debts.reduce((acc, d) => acc + Math.max(0, d.principal
    - state.debtPayments.filter((p) => p.debt_id === d.id).reduce((s, p) => s + p.amount, 0)), 0);
  return accounts + rec - debt;
}

/** Fade out the static splash once the shell has painted. */
function dismissSplash() {
  const splash = document.getElementById('splash');
  if (!splash) return;
  splash.classList.add('is-hidden');
  setTimeout(() => splash.remove(), 400);
}

function renderShell() {
  root.innerHTML = shellHtml();
  bindShell();
  updateShell();
}

function updateShell() {
  const state = store.state;
  const page = ROUTES[ui.route] || ROUTES.dashboard;
  const titleEl = qs('[data-title]', root);
  const eyebrowEl = qs('[data-eyebrow]', root);
  if (titleEl) titleEl.textContent = page.title || 'Dashboard';
  if (eyebrowEl) eyebrowEl.textContent = page.eyebrow || '';

  qsa('[data-nav]', root).forEach((el) => {
    el.classList.toggle('is-active', el.dataset.nav === ui.route);
  });

  const dot = qs('[data-notif-dot]', root);
  if (dot) dot.hidden = unreadCount(state) === 0;

  const connection = qs('[data-connection]', root);
  if (connection) {
    const online = navigator.onLine;
    const pending = state.sync.pending ? ` · ${state.sync.pending} menunggu` : '';
    connection.className = `online-pill ${online ? '' : 'is-offline'}`;
    connection.title = online ? `Terhubung${pending}` : `Offline — transaksi tetap tersimpan lokal${pending}`;
    connection.innerHTML = `${icon(online ? 'wifi' : 'wifi-off', { size: 14 })}<span class="online-text">${online ? 'Online' : 'Offline'}${state.sync.pending ? ` · ${state.sync.pending}` : ''}</span>`;
  }
  const badge = qs('.sidebar .nav-badge', root);
  const debtsNav = qs('[data-nav="debts"]', root);
  if (debtsNav) {
    const existing = qs('.nav-badge', debtsNav);
    const fresh = overdueBadge(state);
    if (existing) existing.remove();
    if (fresh) debtsNav.insertAdjacentHTML('beforeend', fresh);
  }
  void badge;

  const networth = qs('[data-networth]', root);
  // Mode privasi berlaku juga untuk angka di luar halaman (chip sidebar & sheet profil).
  if (networth) networth.textContent = state.settings.hide_balance ? MASK : money(netWorthValue(state));

  const avatar = qs('[data-profile]', root);
  if (avatar) avatar.textContent = initialsOf(state.profile.name);
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [route, query] = raw.split('?');
  const params = {};
  if (query) {
    new URLSearchParams(query).forEach((value, key) => { params[key] = value; });
  }
  return { route: route || 'dashboard', params };
}

function navigate(route, params = {}) {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  const target = `#/${route}${query ? `?${query}` : ''}`;
  if (window.location.hash === target) renderRoute();
  else window.location.hash = target;
}

function renderRoute() {
  const { route, params } = parseHash();
  if (!ROUTES[route]) {
    navigate('dashboard');
    return;
  }
  ui.route = route;
  ui.params = params;

  if (typeof ui.cleanup === 'function') {
    try { ui.cleanup(); } catch (err) { console.warn(err); }
  }
  ui.cleanup = null;

  const view = qs('#view', root);
  view.innerHTML = '';
  view.classList.remove('page-enter');
  void view.offsetWidth;
  view.classList.add('page-enter');

  const ctx = {
    params,
    navigate,
    rerender: () => renderRoute(),
    refreshShell: () => updateShell(),
    setTheme: (mode) => applyTheme(mode),
    lockApp: () => lockApp(),
  };

  try {
    ui.cleanup = ROUTES[route].render(view, ctx) || null;
  } catch (error) {
    console.error('[router] page render failed', error);
    view.innerHTML = `<div class="card">${emptyState({
      title: 'Terjadi kesalahan saat memuat halaman',
      message: error.message || 'Silakan muat ulang aplikasi.',
      illustration: 'reports',
    })}</div>`;
  }

  // close mobile drawer + FAB menu after navigation
  qs('.app-shell')?.classList.remove('is-drawer-open');
  closeFabMenu();
  updateShell();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  try { localStorage.setItem('pfos:route', window.location.hash); } catch { /* ignore */ }
}

function rerenderCurrent() {
  if (!document.getElementById('view')) return; // shell belum berdiri (layar perkenalan)
  renderRoute();
}

/* ------------------------------------------------------------------ */
/* Shell interactions                                                  */
/* ------------------------------------------------------------------ */

let fabMenuEl = null;
let fabScrimEl = null;
let fabTriggerEl = null;

const FAB_TRIGGER_ICON = 'plus';

/** Ganti ikon pemicu (FAB bawah / tombol sidebar / FAB desktop) menjadi plus atau X. */
function setFabTriggerState(trigger, isOpen) {
  if (!trigger) return;
  trigger.classList.toggle('is-open', isOpen);
  trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  const iconHost = trigger.querySelector('.bn-fab, .fab-ico');
  if (iconHost) iconHost.innerHTML = icon(isOpen ? 'x' : FAB_TRIGGER_ICON, { size: isOpen ? 22 : 25 });
  const label = trigger.querySelector('.fab-label');
  if (label) label.textContent = isOpen ? 'Tutup' : 'Transaksi';
  trigger.setAttribute('aria-label', isOpen ? 'Tutup menu catat cepat' : 'Tambah transaksi');
}

function closeFabMenu() {
  if (fabMenuEl) {
    fabMenuEl.classList.remove('is-open');
    const el = fabMenuEl;
    fabMenuEl = null;
    setTimeout(() => el.remove(), 120);
  }
  fabScrimEl?.remove();
  fabScrimEl = null;
  setFabTriggerState(fabTriggerEl, false);
  fabTriggerEl = null;
  document.body.classList.remove('fab-open');
}

function openFabMenu(trigger) {
  const alreadyOpen = Boolean(fabMenuEl) && fabTriggerEl === trigger;
  closeFabMenu();
  if (alreadyOpen) return null;

  fabTriggerEl = trigger;
  setFabTriggerState(trigger, true);
  document.body.classList.add('fab-open');

  fabScrimEl = document.createElement('div');
  fabScrimEl.className = 'fab-scrim';
  document.body.appendChild(fabScrimEl);
  fabScrimEl.addEventListener('click', closeFabMenu);

  fabMenuEl = document.createElement('div');
  fabMenuEl.className = 'fab-menu';
  fabMenuEl.setAttribute('role', 'menu');
  fabMenuEl.setAttribute('aria-label', 'Catat cepat');
  fabMenuEl.innerHTML = `
    <div class="fab-menu-head">
      <span class="fab-menu-title">${icon('zap', { size: 14 })} Catat Cepat</span>
      <button class="fab-menu-close" type="button" data-fab-close aria-label="Tutup menu">${icon('x', { size: 16 })}</button>
    </div>
    <div class="fab-grid">
      ${FAB_ACTIONS.map((a) => `<button class="fab-tile" data-fab-action="${a.key}" type="button" role="menuitem">
        ${iconTile(a.icon, { color: a.color, size: 34, radius: 11, iconSize: 18 })}
        <span class="fab-tile-label">${esc(a.label)}</span>
      </button>`).join('')}
    </div>
    <button class="fab-more" data-fab-action="more" type="button" role="menuitem">
      ${icon('sliders', { size: 15 })}<span class="grow">Form lengkap…</span>${icon('chevron-right', { size: 15 })}
    </button>
  `;
  document.body.appendChild(fabMenuEl);
  requestAnimationFrame(() => fabMenuEl?.classList.add('is-open'));

  on(fabMenuEl, 'click', '[data-fab-action]', (event, el) => {
    const key = el.dataset.fabAction;
    closeFabMenu();
    if (key === 'more') openTransactionForm({ onSaved: rerenderCurrent });
    else openTransactionForm({ presetType: key, onSaved: rerenderCurrent });
  });
  on(fabMenuEl, 'click', '[data-fab-close]', closeFabMenu);
  return fabMenuEl;
}

function bindShell() {
  const shell = qs('.app-shell', root);

  on(root, 'click', '[data-drawer]', () => shell.classList.toggle('is-drawer-open'));
  on(root, 'click', '[data-scrim]', () => shell.classList.remove('is-drawer-open'));
  on(root, 'click', '[data-toggle-sidebar]', () => {
    shell.classList.toggle('is-collapsed');
    try { localStorage.setItem('pfos:sidebar', shell.classList.contains('is-collapsed') ? 'collapsed' : 'full'); } catch { /* ignore */ }
  });
  on(root, 'click', '[data-theme-toggle]', toggleTheme);
  on(root, 'click', '[data-search]', () => openSearchOverlay({ navigate, rerender: rerenderCurrent }));
  on(root, 'click', '[data-notifications]', openNotificationsPanel);
  on(root, 'click', '[data-profile]', openProfileMenu);
  on(root, 'click', '[data-quick-add]', (event, el) => openFabMenu(el));
  on(root, 'click', '[data-fab-center]', (event, el) => { event.preventDefault(); openFabMenu(el.closest('[data-fab-center]') || el); });
  on(document, 'keydown', (event) => { if (event.key === 'Escape' && fabMenuEl) closeFabMenu(); });
  on(root, 'click', '[data-nav="more"]', (event) => { event.preventDefault(); openMoreSheet(); });
  on(root, 'click', 'a.nav-item', () => shell.classList.remove('is-drawer-open'));
  on(document, 'click', (event) => {
    if (fabMenuEl && !fabMenuEl.contains(event.target) && !event.target.closest('[data-quick-add]') && !event.target.closest('[data-fab-center]')) {
      closeFabMenu();
    }
  });
}

function openMoreSheet() {
  const state = store.state;
  const items = [
    ...NAV_PRIMARY.slice(3),
    { route: 'settings', label: 'Settings', icon: 'settings' },
  ];
  openAdaptive({
    title: 'Menu Lainnya',
    iconName: 'more-horizontal',
    size: 'sm',
    body: `<div class="stack-2">
      ${items.map((item) => `<button class="dropdown-item" data-go="${item.route}">
        ${iconTile(item.icon, { size: 34, radius: 11, iconSize: 17 })}
        <span class="grow" style="text-align:left">${esc(item.label)}</span>
        ${item.route === 'debts' ? overdueBadge(state) : ''}
        ${icon('chevron-right', { size: 16 })}
      </button>`).join('')}
    </div>`,
    onMount(sheet, api) {
      on(sheet, 'click', '[data-go]', (event, el) => { api.close(); navigate(el.dataset.go); });
    },
  });
}

function openProfileMenu() {
  const state = store.state;
  openAdaptive({
    title: state.profile.name,
    subtitle: state.profile.phone ? `${formatPhone(state.profile.phone)} · lokal di perangkat ini`
      : (state.profile.email || 'Data tersimpan lokal di perangkat ini'),
    iconName: 'users',
    size: 'sm',
    body: `<div class="stack-4">
      <div class="stat-row">
        <div class="stat-box"><div class="stat-label">Net Worth</div><div class="stat-value">${esc(state.settings.hide_balance ? MASK : money(netWorthValue(state)))}</div></div>
        <div class="stat-box"><div class="stat-label">Transaksi</div><div class="stat-value">${state.transactions.length}</div></div>
      </div>
      <div class="row-between t-xs"><span class="t-dim">Mode tema</span>
        <div class="segmented segmented-sm" data-theme-seg>
          ${['system', 'light', 'dark'].map((m) => `<button data-mode="${m}" aria-selected="${ui.theme === m}">${m === 'system' ? 'Sistem' : m === 'light' ? 'Terang' : 'Gelap'}</button>`).join('')}
        </div>
      </div>
      <div class="row-between t-xs"><span class="t-dim">Mata uang</span><span class="t-semibold">${esc(state.profile.currency)} · ${esc(state.profile.locale)}</span></div>
      <div class="row-between t-xs"><span class="t-dim">Penyimpanan</span><span class="t-semibold">${esc(state.sync.mode)}</span></div>
      <div class="user-strip">
        <div class="row-between">
          <span class="t-label">Pengguna di perangkat ini</span>
          <button class="btn btn-sm btn-ghost" data-manage-users>Kelola</button>
        </div>
        <div class="user-chips">
          ${(store.state.users || []).map((u) => `<button class="user-chip ${u.id === state.profile.id ? 'is-active' : ''}" data-switch-user="${esc(u.id)}" type="button">
            <span class="avatar avatar-sm">${esc(initialsOf(u.name))}</span>
            <span class="t-clip">${esc(u.name)}</span>
            ${u.phone ? `<em class="user-chip-phone">${esc(formatPhone(u.phone))}</em>` : ''}
          </button>`).join('')}
          <button class="user-chip is-add" data-add-user type="button">${icon('plus', { size: 14 })} Tambah</button>
        </div>
      </div>
    </div>`,
    footer: `<button class="btn btn-ghost" data-close>Tutup</button>
      ${hasPin(state) ? `<button class="btn btn-outline" data-lock>${icon('lock', { size: 16 })} Kunci</button>` : ''}
      <button class="btn btn-primary ml-auto" data-settings>${icon('settings', { size: 16 })} Pengaturan</button>`,
    onMount(sheet, api) {
      on(sheet, 'click', '[data-mode]', async (event, el) => {
        await store.updateProfile({ theme: el.dataset.mode });
        applyTheme(el.dataset.mode);
        qsa('[data-mode]', sheet).forEach((b) => b.setAttribute('aria-selected', String(b === el)));
      });
      on(sheet, 'click', '[data-settings]', () => { api.close(); navigate('settings'); });
      on(sheet, 'click', '[data-switch-user]', async (event, el) => {
        if (el.dataset.switchUser === store.state.profile.id) return;
        api.close();
        await switchUserFlow(el.dataset.switchUser);
      });
      on(sheet, 'click', '[data-add-user]', () => { api.close(); openUserForm(); });
      on(sheet, 'click', '[data-manage-users]', () => { api.close(); navigate('settings'); });
      on(sheet, 'click', '[data-lock]', () => { api.close(); lockApp(); });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Notifications panel                                                 */
/* ------------------------------------------------------------------ */

function openNotificationsPanel() {
  const state = store.state;
  const list = [...state.notifications].sort((a, b) => (a.priority - b.priority) || (a.created_at < b.created_at ? 1 : -1));

  openAdaptive({
    title: 'Notifikasi',
    subtitle: `${unreadCount(state)} belum dibaca · ${list.length} total`,
    iconName: 'bell',
    size: 'md',
    body: list.length
      ? `<div class="ledger-card ledger-card-flat">
          ${list.map((n) => `<div class="notif-item ${n.read ? '' : 'is-unread'}" data-notif="${esc(n.id)}" data-route="${esc(n.action?.route || '')}" data-params="${esc(JSON.stringify(n.action?.params || {}))}">
            ${iconTile(n.icon || 'bell', { color: n.tone === 'neg' ? 'var(--neg)' : n.tone === 'warn' ? 'var(--warn)' : n.tone === 'info' ? 'var(--info)' : 'var(--brand-500)', size: 38, radius: 12, iconSize: 18 })}
            <div class="grow" style="min-width:0">
              <div class="notif-title t-sm">${esc(n.title)}</div>
              <div class="t-2xs t-dim">${esc(n.message)}</div>
              <div class="t-2xs t-dim mt-1">${esc(new Date(n.created_at).toLocaleString('id-ID'))}</div>
            </div>
            ${n.read ? '' : '<span class="dot-badge" style="position:static;border:0;width:8px;height:8px"></span>'}
          </div>`).join('')}
        </div>`
      : emptyState({
        title: 'Belum ada notifikasi',
        message: 'Pengingat jatuh tempo, budget, dan laporan bulanan akan muncul di sini.',
        illustration: '', iconName: 'bell',
      }),
    footer: list.length ? `
      <button class="btn btn-ghost" data-read-all>${icon('check', { size: 16 })} Tandai semua dibaca</button>
      <button class="btn btn-danger-soft ml-auto" data-clear-all>${icon('trash', { size: 16 })} Bersihkan</button>` : '',
    onMount(sheet, api) {
      on(sheet, 'click', '[data-notif]', async (event, el) => {
        await store.markNotificationRead(el.dataset.notif);
        const route = el.dataset.route;
        if (route) {
          let params = {};
          try { params = JSON.parse(el.dataset.params || '{}'); } catch { params = {}; }
          api.close();
          navigate(route, params);
        } else {
          api.close();
        }
      });
      on(sheet, 'click', '[data-read-all]', async () => {
        await store.markAllNotificationsRead();
        api.close();
        toast('Semua notifikasi ditandai dibaca.', { tone: 'pos' });
      });
      on(sheet, 'click', '[data-clear-all]', async () => {
        await store.clearNotifications();
        api.close();
        toast('Daftar notifikasi dibersihkan.', { tone: 'info' });
      });
    },
  });
}

function surfaceBrowserNotification(notification) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible') return;
  try {
    new Notification(notification.title, { body: notification.message, tag: notification.key, icon: 'assets/icons/icon-192.png' });
  } catch (err) {
    console.warn('[notifications] browser notification failed', err);
  }
}

/* ------------------------------------------------------------------ */
/* Lock screen                                                         */
/* ------------------------------------------------------------------ */

function lockApp() {
  if (!hasPin(store.state)) return;
  renderLockScreen();
}

function renderLockScreen() {
  const state = store.state;
  const wrapper = document.createElement('div');
  wrapper.className = 'boot-screen';
  wrapper.style.zIndex = '900';
  wrapper.innerHTML = `
    <div class="stack-5" style="width:min(340px,88vw);text-align:center">
      <div class="boot-mark" style="display:grid;place-items:center">${logoMark(58)}</div>
      <div>
        <div class="t-h2">Aplikasi Terkunci</div>
        <div class="t-xs t-dim mt-1">Masukkan PIN untuk membuka ${esc(state.profile.name)}'s workspace</div>
      </div>
      <div class="field">
        <input class="input" data-pin type="password" inputmode="numeric" maxlength="8" placeholder="••••"
          style="text-align:center;font-size:24px;letter-spacing:.4em;height:56px" autocomplete="off" />
        <span class="field-error" data-error hidden>PIN tidak sesuai.</span>
      </div>
      <button class="btn btn-primary btn-lg btn-block" data-unlock>${icon('lock', { size: 18 })} Buka Aplikasi</button>
      <button class="btn btn-ghost btn-sm" data-forgot>Lupa PIN? Semua data tetap aman di perangkat ini.</button>
    </div>`;
  document.body.appendChild(wrapper);

  const input = qs('[data-pin]', wrapper);
  const errorEl = qs('[data-error]', wrapper);
  input.focus();

  const attempt = async () => {
    const ok = await verifyPin(input.value);
    if (ok) {
      markUnlocked();
      wrapper.remove();
      toast('Selamat datang kembali.', { tone: 'pos', duration: 1800 });
    } else {
      errorEl.hidden = false;
      input.value = '';
      input.focus();
    }
  };
  on(wrapper, 'click', '[data-unlock]', attempt);
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') attempt(); });
  on(wrapper, 'click', '[data-forgot]', () => {
    openAdaptive({
      title: 'Lupa PIN',
      iconName: 'info',
      size: 'sm',
      body: `<div class="stack-3">
        <div class="banner is-warn">${icon('alert', { size: 18 })}<div class="grow t-xs">
          PIN tidak dapat dipulihkan karena hanya hash-nya yang disimpan. Untuk mengatur ulang, hapus data aplikasi melalui
          pengaturan situs di browser (Site settings → Delete data). Data keuangan Anda akan hilang kecuali sudah dibuat backup.
        </div></div>
        <div class="t-xs t-dim">Tips: buat backup JSON secara berkala dari halaman Settings agar data tetap aman.</div>
      </div>`,
    });
  });
}

/* ------------------------------------------------------------------ */
/* Keyboard shortcuts                                                  */
/* ------------------------------------------------------------------ */

function bindShortcuts() {
  document.addEventListener('keydown', (event) => {
    const tag = document.activeElement?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable;

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openSearchOverlay({ navigate, rerender: rerenderCurrent });
      return;
    }
    if (event.key === 'Escape') {
      closeDropdown();
      closeFabMenu();
      return;
    }
    if (typing || isOverlayOpen() || event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key.toLowerCase() === 'n') {
      event.preventDefault();
      openTransactionForm({ onSaved: rerenderCurrent });
      return;
    }
    if (event.key.toLowerCase() === 'd') {
      event.preventDefault();
      toggleTheme();
      return;
    }
    const match = NAV_PRIMARY.find((item) => item.key === event.key);
    if (match) {
      event.preventDefault();
      navigate(match.route);
    } else if (event.key === NAV_SECONDARY[0].key) {
      event.preventDefault();
      navigate('settings');
    }
  });
}

/* ------------------------------------------------------------------ */
/* PWA                                                                 */
/* ------------------------------------------------------------------ */

function bindInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    ui.installEvent = event;
    window.dispatchEvent(new Event('pfos:installable'));
    toast('Aplikasi dapat di-install ke perangkat ini.', {
      title: 'Install PWA',
      tone: 'info',
      duration: 7000,
      action: { label: 'Install', onClick: () => installPWA() },
    });
  });
  window.addEventListener('appinstalled', () => {
    ui.installEvent = null;
    toast('Aplikasi berhasil di-install. Buka dari home screen untuk pengalaman penuh.', { tone: 'pos', title: 'Terinstall' });
  });
}

async function installPWA() {
  if (!ui.installEvent) {
    toast('Gunakan menu browser → "Add to Home Screen" untuk meng-install.', { tone: 'info', duration: 5200 });
    return false;
  }
  ui.installEvent.prompt();
  const { outcome } = await ui.installEvent.userChoice;
  ui.installEvent = null;
  return outcome === 'accepted';
}

/* ------------------------------------------------------------------ */
/* Demo banner                                                         */
/* ------------------------------------------------------------------ */

function maybeShowDemoBanner() {
  if (!store.state.demo) return;
  const shownKey = 'pfos:demo-banner-dismissed';
  try { if (localStorage.getItem(shownKey)) return; } catch { /* ignore */ }
  setTimeout(() => {
    toast('Data contoh aktif — 5 bulan riwayat, 10 akun, hutang & piutang. Mulai dari nol kapan saja.', {
      title: 'Selamat datang di AD-Finance',
      tone: 'info',
      duration: 12000,
      action: { label: 'Mulai dari nol', onClick: () => navigate('settings') },
    });
    try { localStorage.setItem(shownKey, '1'); } catch { /* ignore */ }
  }, 1800);
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

async function boot() {
  root = document.getElementById('app');
  const themeMode = (() => {
    try { return localStorage.getItem('pfos:theme') || 'system'; } catch { return 'system'; }
  })();
  applyTheme(themeMode);

  const bootScreen = document.createElement('div');
  bootScreen.className = 'boot-screen';
  bootScreen.innerHTML = `
    <div class="stack-5" style="display:grid;place-items:center;gap:var(--s-4)">
      <div class="boot-mark">${logoMark(62)}</div>
      <div style="text-align:center">
        <div class="t-h3">AD-Finance</div>
        <div class="t-xs t-dim mt-1">Menyiapkan data keuangan Anda…</div>
      </div>
      <div class="boot-bar"><span></span></div>
    </div>`;
  document.body.appendChild(bootScreen);

  try {
    await store.init();
  } catch (error) {
    console.error('[boot] store init failed', error);
    bootScreen.innerHTML = `<div class="stack-4" style="width:min(420px,90vw)">
      <div class="t-h2">Gagal memuat data</div>
      <div class="banner is-neg">${icon('alert', { size: 18 })}<div class="grow t-xs">${esc(error.message || 'Terjadi kesalahan pada penyimpanan lokal.')}</div></div>
      <button class="btn btn-primary" onclick="location.reload()">Muat ulang</button>
    </div>`;
    return;
  }

  applyTheme(store.state.profile.theme || themeMode);
  exposeApi();
  dismissSplash();
  bootScreen.remove();

  // Perkenalan: setiap pengguna wajib mengisi nama sebelum aplikasi dibuka,
  // dan memulai dengan workspace kosong miliknya sendiri.
  if (store.state.needsUser) {
    // Perkenalan bisa selesai lewat tombol (wrapper dihapus di renderOnboarding)
    // atau lewat jalur lain (mis. tambah pengguna program) — pastikan layarnya
    // selalu dibersihkan sebelum shell berdiri.
    const stop = store.subscribe((next) => {
      if (next.needsUser) return;
      stop();
      document.querySelector('.onboarding')?.remove();
      startShell();
    });
    renderOnboarding(() => startShell());
    return;
  }

  startShell();
}

/* ---------------------- Perkenalan pengguna ------------------------ */

/**
 * Layar perkenalan sekaligus gerbang privasi: cukup **nama** dan **nomor
 * telepon**. Workspace baru selalu mulai dari data kosong; kalau perangkat ini
 * sudah punya data dari versi sebelumnya, data itu otomatis dipertahankan.
 */
function renderOnboarding(onDone) {
  const legacy = store.state.legacyData && store.state.users.length > 0;
  const wrapper = document.createElement('div');
  wrapper.className = 'boot-screen onboarding';
  wrapper.style.zIndex = '880';
  wrapper.innerHTML = `
    <div class="onboard-card card">
      <div class="onboard-head">
        <div class="boot-mark" style="display:grid;place-items:center">${logoMark(50)}</div>
        <div>
          <div class="t-h2">Selamat datang di AD-Finance</div>
          <div class="t-xs t-dim mt-1">Isi nama dan nomor telepon dulu ya. Setiap pengguna di perangkat ini punya workspace-nya sendiri, jadi data Anda tidak bercampur dengan pengguna lain.</div>
        </div>
      </div>

      <div class="field">
        <label class="field-label" for="onboard-name">Nama Anda</label>
        <input class="input" id="onboard-name" data-onboard-name type="text" autocomplete="name"
          placeholder="cth. Ade Nurrahman" maxlength="40" />
        <span class="field-error" data-onboard-error hidden>Nama minimal 2 karakter.</span>
      </div>

      <div class="field">
        <label class="field-label" for="onboard-phone">Nomor Telepon</label>
        <input class="input" id="onboard-phone" data-onboard-phone type="tel" inputmode="tel" autocomplete="tel"
          placeholder="cth. 0812-3456-7890" maxlength="20" />
        <span class="field-hint" data-onboard-phone-hint>Dipakai hanya sebagai identitas pengguna di perangkat ini.</span>
        <span class="field-error" data-onboard-phone-error hidden>Nomor telepon belum benar. Contoh: 0812-3456-7890.</span>
      </div>

      <button class="btn btn-primary btn-lg btn-block" data-onboard-submit>${icon('arrow-right', { size: 18 })} Mulai gunakan</button>
      <div class="t-2xs t-dim t-center">${legacy
        ? `Data yang sudah ada di perangkat ini (${store.state.accounts.length} akun · ${store.state.transactions.length} transaksi) akan dipertahankan.`
        : 'Workspace baru mulai dari data kosong. Data tersimpan lokal di perangkat ini dan hanya terlihat oleh pengguna ini.'}</div>
    </div>`;

  document.body.appendChild(wrapper);
  const nameEl = qs('[data-onboard-name]', wrapper);
  const phoneEl = qs('[data-onboard-phone]', wrapper);
  const nameError = qs('[data-onboard-error]', wrapper);
  const phoneError = qs('[data-onboard-phone-error]', wrapper);
  const hint = qs('[data-onboard-phone-hint]', wrapper);
  nameEl.focus();

  const showError = (el, input, message) => {
    el.hidden = false;
    if (message) el.textContent = message;
    input?.classList.add('is-invalid');
  };
  const clearError = (el, input) => {
    el.hidden = true;
    input?.classList.remove('is-invalid');
  };

  let busy = false;
  const submit = async () => {
    if (busy) return;
    const name = nameEl.value.trim();
    const phone = phoneEl.value.trim();
    let salah = false;
    if (name.length < 2) { showError(nameError, nameEl); salah = true; } else { clearError(nameError, nameEl); }
    if (!phoneValid(phone)) { showError(phoneError, phoneEl); salah = true; } else { clearError(phoneError, phoneEl); }
    if (salah) { (name.length < 2 ? nameEl : phoneEl).focus(); return; }

    busy = true;
    const button = qs('[data-onboard-submit]', wrapper);
    button.disabled = true;
    button.textContent = 'Menyiapkan workspace…';
    try {
      if (legacy) {
        await store.completeOnboarding({ name, phone, keepData: true });
      } else {
        await store.createUser({ name, phone, mode: 'empty' });
      }
      wrapper.remove();
      toast(`Halo, ${name}! Workspace Anda siap.`, { tone: 'pos', duration: 2600 });
      onDone?.();
    } catch (error) {
      busy = false;
      button.disabled = false;
      button.innerHTML = `${icon('arrow-right', { size: 18 })} Mulai gunakan`;
      if (error?.code === 'phone') showError(phoneError, phoneEl, error.message);
      else showError(nameError, nameEl, error?.message || 'Gagal menyiapkan workspace.');
    }
  };

  on(wrapper, 'click', '[data-onboard-submit]', submit);
  const onEnter = (event) => { if (event.key === 'Enter') submit(); };
  on(wrapper, 'keydown', '[data-onboard-name]', onEnter);
  on(wrapper, 'keydown', '[data-onboard-phone]', onEnter);
  nameEl.addEventListener('input', () => clearError(nameError, nameEl));
  phoneEl.addEventListener('input', () => clearError(phoneError, phoneEl));
  phoneEl.addEventListener('focus', () => { hint.hidden = true; });
  phoneEl.addEventListener('blur', () => { if (!phoneEl.value.trim()) hint.hidden = false; });
}

/* --------------------------- Pengguna ------------------------------ */

/** Pindah pengguna: data langsung dimuat ulang & halaman digambar ulang. */
async function switchUserFlow(userId) {
  try {
    const profile = await store.switchUser(userId);
    toast(`Beralih ke ${profile.name}.`, { tone: 'info', duration: 2000 });
    renderRoute();
  } catch (error) {
    toast(error?.message || 'Gagal berpindah pengguna.', { tone: 'neg' });
  }
}

/** Form tambah pengguna baru (nama wajib; default mulai dari data kosong). */
function openUserForm({ onDone } = {}) {
  openAdaptive({
    title: 'Tambah pengguna',
    subtitle: 'Workspace baru, terpisah dari pengguna lain di perangkat ini',
    iconName: 'users',
    size: 'sm',
    body: `<div class="stack-4">
      <div class="field">
        <label class="field-label" for="user-name">Nama</label>
        <input class="input" id="user-name" data-user-name type="text" maxlength="40" placeholder="cth. Pasangan / Anggota keluarga" />
        <span class="field-error" data-user-error hidden>Nama minimal 2 karakter.</span>
      </div>
      <div class="field">
        <label class="field-label" for="user-phone">Nomor Telepon</label>
        <input class="input" id="user-phone" data-user-phone type="tel" inputmode="tel" maxlength="20" placeholder="cth. 0812-3456-7890" />
        <span class="field-error" data-user-phone-error hidden>Nomor telepon belum benar. Contoh: 0812-3456-7890.</span>
      </div>
      <div class="banner">${icon('info', { size: 18 })}<div class="grow t-xs">
        Workspace baru selalu dimulai dari data kosong dan tidak bisa melihat data pengguna lain. Anda dapat berpindah kapan saja dari menu profil.</div></div>
    </div>`,
    footer: `<button class="btn btn-ghost" data-close>Batal</button>
      <button class="btn btn-primary ml-auto" data-save-user>${icon('plus', { size: 16 })} Buat pengguna</button>`,
    onMount(sheet, api) {
      const input = qs('[data-user-name]', sheet);
      const phoneInput = qs('[data-user-phone]', sheet);
      const errorEl = qs('[data-user-error]', sheet);
      const phoneError = qs('[data-user-phone-error]', sheet);
      input.focus();
      input.addEventListener('input', () => { errorEl.hidden = true; input.classList.remove('is-invalid'); });
      phoneInput.addEventListener('input', () => { phoneError.hidden = true; phoneInput.classList.remove('is-invalid'); });
      on(sheet, 'click', '[data-save-user]', async (event, el) => {
        const name = input.value.trim();
        const phone = phoneInput.value.trim();
        let salah = false;
        if (name.length < 2) { errorEl.hidden = false; input.classList.add('is-invalid'); salah = true; }
        if (!phoneValid(phone)) { phoneError.hidden = false; phoneInput.classList.add('is-invalid'); salah = true; }
        if (salah) { (name.length < 2 ? input : phoneInput).focus(); return; }
        el.disabled = true;
        el.textContent = 'Menyiapkan…';
        try {
          const profile = await store.createUser({ name, phone });
          api.close();
          toast(`Workspace ${profile.name} siap.`, { tone: 'pos' });
          renderRoute();
          onDone?.(profile);
        } catch (error) {
          el.disabled = false;
          el.innerHTML = `${icon('plus', { size: 16 })} Buat pengguna`;
          if (error?.code === 'phone') phoneError.hidden = false;
          else errorEl.hidden = false;
          (error?.code === 'phone' ? phoneError : errorEl).textContent = error?.message || 'Gagal membuat pengguna.';
        }
      });
    },
  });
}

function openUserManager() {
  const users = store.state.users || [];
  openAdaptive({
    title: 'Kelola pengguna',
    subtitle: `${users.length} pengguna di perangkat ini`,
    iconName: 'users',
    size: 'sm',
    body: `<div class="stack-3" data-user-list>
      ${users.map((u) => `<div class="user-row ${u.id === store.state.profile.id ? 'is-active' : ''}" data-user-row="${esc(u.id)}">
        <span class="avatar">${esc(initialsOf(u.name))}</span>
        <div class="grow" style="min-width:0">
          <div class="t-sm t-semibold t-clip">${esc(u.name)}</div>
          <div class="t-2xs t-dim">${u.id === store.state.profile.id ? 'Sedang aktif' : 'Tersimpan di perangkat ini'}</div>
        </div>
        <button class="btn btn-sm btn-ghost" data-rename-user="${esc(u.id)}" title="Ganti nama">${icon('edit', { size: 15 })}</button>
        <button class="btn btn-sm btn-danger-soft" data-delete-user="${esc(u.id)}" title="Hapus pengguna">${icon('trash', { size: 15 })}</button>
      </div>`).join('')}
    </div>`,
    footer: `<button class="btn btn-ghost" data-close>Tutup</button>
      <button class="btn btn-primary ml-auto" data-add-user-2>${icon('plus', { size: 16 })} Tambah pengguna</button>`,
    onMount(sheet, api) {
      on(sheet, 'click', '[data-add-user-2]', () => { api.close(); openUserForm(); });
      on(sheet, 'click', '[data-rename-user]', async (event, el) => {
        const user = (store.state.users || []).find((u) => u.id === el.dataset.renameUser);
        const next = window.prompt('Nama baru untuk pengguna ini:', user?.name || '');
        if (next === null) return;
        try {
          await store.renameUser(el.dataset.renameUser, next);
          api.close();
          toast('Nama pengguna diperbarui.', { tone: 'pos' });
          openUserManager();
        } catch (error) {
          toast(error?.message || 'Nama tidak valid.', { tone: 'neg' });
        }
      });
      on(sheet, 'click', '[data-delete-user]', async (event, el) => {
        const user = (store.state.users || []).find((u) => u.id === el.dataset.deleteUser);
        const yes = await confirmDialog({
          title: `Hapus ${user?.name || 'pengguna'}?`,
          message: 'Seluruh data pengguna ini (akun, transaksi, hutang, budget) akan dihapus permanen dari perangkat. Pengguna lain tidak terpengaruh.',
          confirmText: 'Hapus permanen', tone: 'danger', iconName: 'trash',
        });
        if (!yes) return;
        await store.deleteUser(el.dataset.deleteUser);
        api.close();
        toast('Pengguna dihapus.', { tone: 'info' });
        if (store.state.needsUser) { location.reload(); return; }
        renderRoute();
      });
    },
  });
}

/* ------------------------- Shell (setelah masuk) ------------------- */

let shellStarted = false;

function startShell() {
  if (shellStarted) return;
  shellStarted = true;
  document.querySelector('.onboarding')?.remove(); // jaga-jaga: gerbang tidak boleh menutupi shell
  renderShell();
  dismissSplash();

  // restore last route
  let initial = parseHash();
  if (initial.route === 'dashboard') {
    try {
      const saved = localStorage.getItem('pfos:route');
      if (saved && saved.length > 3) initial = { route: saved.replace(/^#\/?/, '').split('?')[0] || 'dashboard', params: {} };
      window.location.hash = window.location.hash || `#/${initial.route}`;
    } catch { /* ignore */ }
  }
  if (!window.location.hash) window.location.hash = '#/dashboard';
  renderRoute();

  // persistence + sync
  store.subscribe((state, reason) => {
    updateShell();
    if (reason === 'notifications' && state.notifications.length) {
      const [latest] = state.notifications;
      if (latest && !latest.read) surfaceBrowserNotification(latest);
    }
    if (reason === 'external-change' || reason === 'data-reloaded') rerenderCurrent();
    if (reason === 'users') rerenderCurrent();
  });

  window.addEventListener('hashchange', renderRoute);
  window.addEventListener('online', () => { updateShell(); store.flushOutbox(); });
  window.addEventListener('offline', updateShell);

  bindShortcuts();
  bindInstallPrompt();
  maybeShowDemoBanner();

  // periodic refresh of derived notifications (every 15 min while open)
  setInterval(() => {
    store.state.transactions.length && refreshNotifications(store.state).length && store.emit('update');
  }, 15 * 60 * 1000);

  // service worker
  registerServiceWorker((update) => {
    toast('Versi baru tersedia.', {
      title: 'Update aplikasi', tone: 'info', duration: 9000,
      action: { label: 'Muat ulang', onClick: () => window.location.reload() },
    });
    void update;
  });

  if (hasPin(store.state) && !isUnlocked()) lockApp();

  void initial;
}

/** API kecil untuk modul lain (settings, tombol install) dan untuk QA otomatis. */
function exposeApi() {
  window.__pfos = {
    getState: () => store.state,
    navigate,
    installPWA,
    canInstall: () => Boolean(ui.installEvent),
    checkForUpdate,
    version: cacheVersion(),
    needsUser: () => Boolean(store.state.needsUser),
    users: () => store.listUsers(),
    createUser: (opts) => store.createUser(opts),
    switchUser: (id) => store.switchUser(id),
    renameUser: (id, name) => store.renameUser(id, name),
    deleteUser: (id) => store.deleteUser(id),
    completeOnboarding: (opts) => store.completeOnboarding(opts),
    rerender: () => rerenderCurrent(),
    openUserManager, openUserForm,
  };
}


if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
