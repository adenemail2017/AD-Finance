/**
 * UI primitives — toast, modal / bottom-sheet, confirm dialog, dropdown,
 * empty state, skeletons and small HTML fragment helpers.
 * Pure DOM, no framework: each helper returns DOM nodes and cleans up after itself.
 */

import { esc, on, qs, qsa, trapFocus } from '../utils/dom.js';
import { icon, iconTile, emptyIllustration } from './icons.js';
import { money } from '../utils/format.js';

/* ------------------------------------------------------------------ */
/* Toast                                                               */
/* ------------------------------------------------------------------ */

let toastHost = null;

function ensureToastHost() {
  if (!toastHost || !document.body.contains(toastHost)) {
    toastHost = document.createElement('div');
    toastHost.className = 'toast-stack';
    toastHost.setAttribute('role', 'status');
    toastHost.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastHost);
  }
  return toastHost;
}

export function toast(message, { title = '', tone = 'default', duration = 3600, action } = {}) {
  const host = ensureToastHost();
  const el = document.createElement('div');
  el.className = `toast toast-${tone}`;
  const toneIcon = { pos: 'circle-check', neg: 'alert-circle', warn: 'alert', default: 'info' }[tone] || 'info';
  el.innerHTML = `
    <span style="color:var(--${tone === 'default' ? 'brand-500' : tone === 'pos' ? 'pos' : tone === 'neg' ? 'neg' : 'warn'})">${icon(toneIcon, { size: 18 })}</span>
    <div class="grow">
      ${title ? `<div class="toast-title">${esc(title)}</div>` : ''}
      <div class="toast-msg">${esc(message)}</div>
    </div>
    <button class="icon-btn" style="width:26px;height:26px" aria-label="Tutup notifikasi">${icon('x', { size: 15 })}</button>
  `;
  host.appendChild(el);
  let timer = null;
  const close = () => {
    clearTimeout(timer);
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 200);
  };
  on(el, 'click', 'button', close);
  if (action) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm btn-soft';
    btn.textContent = action.label;
    btn.addEventListener('click', () => { action.onClick?.(); close(); });
    el.insertBefore(btn, el.lastElementChild);
    timer = setTimeout(close, duration + 1800);
  } else {
    timer = setTimeout(close, duration);
  }
  return { close, el };
}

/* ------------------------------------------------------------------ */
/* Overlay / modal manager (stack aware, ESC + focus trap)             */
/* ------------------------------------------------------------------ */

const overlayStack = [];

function onKeydown(event) {
  const top = overlayStack[overlayStack.length - 1];
  if (!top) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    top.close('escape');
  }
}

/**
 * @param {object} cfg
 *  title, body (html|node), footer (html|node), size ('sm'|'md'|'lg'),
 *  kind ('modal'|'bottom'), onMount(root, api), onClose(reason), dismissible
 */
export function openOverlay(cfg = {}) {
  const {
    title = '', body = '', footer = '', size = 'md', kind = 'modal',
    onMount, onClose, dismissible = true, subtitle = '', iconName = '',
  } = cfg;

  const overlay = document.createElement('div');
  overlay.className = `overlay ${kind === 'bottom' ? 'is-bottom' : ''}`;
  overlay.innerHTML = `
    <div class="sheet sheet-${size}" role="dialog" aria-modal="true" aria-label="${esc(title || 'Dialog')}">
      ${kind === 'bottom' ? '<div class="sheet-handle"></div>' : ''}
      <header class="sheet-header">
        ${iconName ? iconTile(iconName, { size: 34, radius: 10, iconSize: 18 }) : ''}
        <div class="grow">
          <div class="sheet-title">${esc(title)}</div>
          ${subtitle ? `<div class="t-xs t-dim">${esc(subtitle)}</div>` : ''}
        </div>
        ${dismissible ? `<button class="icon-btn" data-close aria-label="Tutup">${icon('x', { size: 19 })}</button>` : ''}
      </header>
      <div class="sheet-body"></div>
      ${footer ? '<footer class="sheet-footer"></footer>' : ''}
    </div>
  `;
  const sheet = qs('.sheet', overlay);
  const bodyEl = qs('.sheet-body', overlay);
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
  if (footer) {
    const footerEl = qs('.sheet-footer', overlay);
    if (typeof footer === 'string') footerEl.innerHTML = footer; else footerEl.appendChild(footer);
  }

  const previouslyFocused = document.activeElement;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  // Saat sheet terbuka, notifikasi melayang disembunyikan agar tidak menutupi isi sheet.
  document.body.classList.add('has-overlay');

  let released = false;
  const releaseFocus = trapFocus(sheet);

  const api = {
    root: overlay,
    sheet,
    body: bodyEl,
    footer: qs('.sheet-footer', overlay),
    close(reason = 'programmatic') {
      if (released) return;
      released = true;
      releaseFocus();
      const index = overlayStack.findIndex((o) => o.overlay === overlay);
      if (index > -1) overlayStack.splice(index, 1);
      overlay.remove();
      if (!overlayStack.length) {
        document.body.style.overflow = '';
        document.body.classList.remove('has-overlay');
        document.removeEventListener('keydown', onKeydown);
      }
      previouslyFocused?.focus?.();
      onClose?.(reason);
    },
  };

  overlayStack.push({ overlay, close: api.close });
  document.addEventListener('keydown', onKeydown);

  if (dismissible) {
    overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) api.close('backdrop'); });
    on(overlay, 'click', '[data-close]', () => api.close('close-button'));
  }

  onMount?.(sheet, api);

  const autofocus = qs('[data-autofocus]', sheet) || qs('input, select, textarea, button:not([data-close])', sheet);
  setTimeout(() => autofocus?.focus?.({ preventScroll: true }), 60);

  return api;
}

export function isOverlayOpen() {
  return overlayStack.length > 0;
}

export function closeTopOverlay() {
  overlayStack[overlayStack.length - 1]?.close('programmatic');
}

/** Bottom sheet on mobile, centred modal on desktop. */
export function openAdaptive(cfg) {
  const isMobile = window.matchMedia('(max-width: 760px)').matches;
  return openOverlay({ ...cfg, kind: isMobile ? 'bottom' : 'modal' });
}

export function confirmDialog({
  title = 'Konfirmasi', message = '', confirmText = 'Ya, lanjutkan', cancelText = 'Batal',
  tone = 'primary', iconName = 'alert',
} = {}) {
  return new Promise((resolve) => {
    let decided = false;
    const api = openOverlay({
      title,
      iconName,
      size: 'sm',
      body: `<p class="t-sm t-muted" style="line-height:1.6">${message}</p>`,
      footer: `<button class="btn btn-ghost grow" data-cancel>${esc(cancelText)}</button>
               <button class="btn btn-${tone === 'danger' ? 'danger' : 'primary'} grow" data-confirm>${esc(confirmText)}</button>`,
      onMount(sheet, instance) {
        on(sheet, 'click', '[data-cancel]', () => { decided = true; resolve(false); instance.close(); });
        on(sheet, 'click', '[data-confirm]', () => { decided = true; resolve(true); instance.close(); });
      },
      onClose() { if (!decided) resolve(false); },
    });
    void api;
  });
}

/* ------------------------------------------------------------------ */
/* Dropdown                                                            */
/* ------------------------------------------------------------------ */

let openDropdown = null;

export function closeDropdown() {
  if (openDropdown) {
    openDropdown.menu.remove();
    openDropdown = null;
  }
}

document.addEventListener('click', (event) => {
  if (!openDropdown) return;
  if (!openDropdown.menu.contains(event.target) && !openDropdown.trigger.contains(event.target)) closeDropdown();
}, true);

/**
 * @param {HTMLElement} trigger
 * @param {Array<{label, icon?, danger?, selected?, onClick?, separator?, labelOnly?}>} items
 */
export function attachDropdown(trigger, items, { align = 'right' } = {}) {
  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    const already = openDropdown?.trigger === trigger;
    closeDropdown();
    if (already) return;
    const menu = document.createElement('div');
    menu.className = `dropdown-menu align-${align}`;
    menu.setAttribute('role', 'menu');
    items.forEach((item) => {
      if (item.separator) {
        menu.insertAdjacentHTML('beforeend', '<div class="dropdown-sep"></div>');
        return;
      }
      if (item.labelOnly) {
        menu.insertAdjacentHTML('beforeend', `<div class="dropdown-label t-label">${esc(item.label)}</div>`);
        return;
      }
      const btn = document.createElement('button');
      btn.className = `dropdown-item ${item.danger ? 'is-danger' : ''} ${item.selected ? 'is-selected' : ''}`;
      btn.setAttribute('role', 'menuitem');
      btn.innerHTML = `${item.icon ? icon(item.icon, { size: 17 }) : ''}<span class="grow">${esc(item.label)}</span>${item.selected ? icon('check', { size: 15 }) : ''}`;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeDropdown();
        item.onClick?.();
      });
      menu.appendChild(btn);
    });
    trigger.parentElement.style.position = 'relative';
    trigger.parentElement.appendChild(menu);
    openDropdown = { menu, trigger };
  });
}

/* ------------------------------------------------------------------ */
/* Small fragment helpers                                              */
/* ------------------------------------------------------------------ */

export function moneyHtml(value, { tone = 'auto', sign = false, cls = '', compact = false } = {}) {
  const n = Number(value) || 0;
  let toneClass = '';
  if (tone === 'auto') toneClass = n > 0 ? 'money-pos' : n < 0 ? 'money-neg' : 'money-neutral';
  else if (tone !== 'neutral') toneClass = `money-${tone}`;
  return `<span class="t-num ${toneClass} ${cls}">${esc(money(n, { sign, compact }))}</span>`;
}

export function badgeHtml(label, tone = 'default', { icon: iconName = '' } = {}) {
  return `<span class="badge badge-${tone}">${iconName ? icon(iconName, { size: 13 }) : ''}${esc(label)}</span>`;
}

export function progressHtml(value, { tone = '', size = '' } = {}) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  const cls = tone === 'pos' ? 'is-pos' : tone === 'warn' ? 'is-warn' : tone === 'neg' ? 'is-neg' : '';
  return `<div class="progress ${size}"><div class="progress-bar ${cls}" style="width:${pct}%"></div></div>`;
}

export function fieldHtml({
  label, name, control, hint = '', error = '', id = '',
}) {
  return `<div class="field" data-field="${esc(name || id)}">
    ${label ? `<label class="field-label" for="${esc(id || name)}">${esc(label)}</label>` : ''}
    ${control}
    ${error ? `<span class="field-error" data-error>${esc(error)}</span>` : hint ? `<span class="field-hint">${esc(hint)}</span>` : ''}
  </div>`;
}

export function emptyState({
  title = 'Belum ada data', message = '', actionLabel = '', actionAttrs = '', illustration = 'transactions', iconName = 'inbox',
}) {
  return `<div class="empty-state">
    ${illustration ? emptyIllustration(illustration) : iconTile(iconName, { size: 56, radius: 18, iconSize: 26 })}
    <h3>${esc(title)}</h3>
    ${message ? `<p>${esc(message)}</p>` : ''}
    ${actionLabel ? `<button class="btn btn-primary" ${actionAttrs}>${icon('plus', { size: 18 })}${esc(actionLabel)}</button>` : ''}
  </div>`;
}

export function skeletonList(rows = 5) {
  return `<div class="stack-3" style="padding:var(--s-5)">
    ${Array.from({ length: rows }).map(() => `
      <div class="row">
        <div class="skeleton" style="width:40px;height:40px;border-radius:12px"></div>
        <div class="grow stack-2">
          <div class="skeleton skeleton-text" style="width:55%"></div>
          <div class="skeleton skeleton-text" style="width:32%"></div>
        </div>
        <div class="skeleton skeleton-text" style="width:72px;height:16px"></div>
      </div>`).join('')}
  </div>`;
}

export function skeletonCards(n = 4, cls = 'col-3') {
  return Array.from({ length: n }).map(() => `<div class="${cls}"><div class="skeleton skeleton-card"></div></div>`).join('');
}

export function segmentedControl({ options, value, name = 'segment', size = '' }) {
  return `<div class="segmented ${size === 'sm' ? 'segmented-sm' : ''}" role="tablist" data-segment="${esc(name)}">
    ${options.map((option) => `<button role="tab" data-value="${esc(option.value)}"
      aria-selected="${String(option.value) === String(value)}">${esc(option.label)}</button>`).join('')}
  </div>`;
}

export function readSegment(root, name) {
  return qs(`[data-segment="${name}"] [aria-selected="true"]`, root)?.dataset.value;
}

/** Wire a segmented control: returns cleanup fn. */
export function onSegment(root, name, handler) {
  return on(root, 'click', `[data-segment="${name}"] button`, (event, btn) => {
    qsa(`[data-segment="${name}"] button`, root).forEach((b) => b.setAttribute('aria-selected', 'false'));
    btn.setAttribute('aria-selected', 'true');
    handler(btn.dataset.value);
  });
}

export function sectionHead({ title, sub = '', actions = '' }) {
  return `<div class="section-head">
    <div>
      <h3>${esc(title)}</h3>
      ${sub ? `<div class="section-sub">${esc(sub)}</div>` : ''}
    </div>
    <div class="ml-auto row gap-2">${actions}</div>
  </div>`;
}

/** Toggle helper for switches (role=switch). */
export function bindSwitch(el, { get, set }) {
  const render = () => el.setAttribute('aria-checked', String(!!get()));
  render();
  el.addEventListener('click', () => { set(!get()); render(); });
}

export { icon, iconTile, emptyIllustration };


/* ------------------------------------------------------------------ */
/* Data-view primitives shared by Transactions & Reports              */
/* ------------------------------------------------------------------ */

/**
 * Compact stat tile — one number with a label, an optional delta and context.
 * Used for summary strips so figures stop being a run-on line of text.
 */
export function statTile({
  label, value, sub = '', tone = '', iconName = '', color = '', raw = null, cls = '', attrs = '',
}) {
  const toneCls = tone === 'pos' ? 'st-pos' : tone === 'neg' ? 'st-neg' : tone === 'warn' ? 'st-warn' : tone === 'brand' ? 'st-brand' : '';
  return `<div class="stat-tile ${toneCls} ${cls}" ${attrs}>
    <span class="st-head">
      ${iconName ? `<span class="st-ico"${color ? ` style="--tile-color:${color}"` : ''}>${icon(iconName, { size: 14 })}</span>` : ''}
      <span class="st-label">${esc(label)}</span>
    </span>
    <span class="st-value"${raw !== null ? ` data-count="${raw}"` : ''}>${esc(value)}</span>
    ${sub ? `<span class="st-sub">${sub}</span>` : ''}
  </div>`;
}

/** Removable "what is filtering this list" pill. */
export function filterChip({ label, value, action, tone = '' }) {
  return `<button type="button" class="filter-chip ${tone ? `is-${tone}` : ''}" ${action} title="Hapus filter">
    <span class="fc-key">${esc(label)}</span><b class="fc-val">${esc(value)}</b>${icon('x', { size: 12 })}
  </button>`;
}

/** Titled divider that gives a long report a readable rhythm. */
export function sectionDivider({ title, sub = '', actions = '' }) {
  return `<div class="section-divider">
    <div class="sd-text">
      <h3>${esc(title)}</h3>
      ${sub ? `<p>${esc(sub)}</p>` : ''}
    </div>
    ${actions ? `<div class="sd-actions">${actions}</div>` : ''}
  </div>`;
}
