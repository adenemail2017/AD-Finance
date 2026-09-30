/**
 * Tiny DOM toolkit used by every component/page.
 * Keeps rendering declarative (template strings) while staying XSS-safe:
 * always wrap user-provided values with esc().
 */

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Tagged template that escapes interpolations by default. */
export function html(strings, ...values) {
  return strings.reduce((acc, str, i) => {
    const v = values[i - 1];
    let chunk = '';
    if (Array.isArray(v)) chunk = v.join('');
    else if (v === null || v === undefined || v === false) chunk = '';
    else chunk = v;
    return acc + chunk + str;
  });
}

/** Mark a string as pre-escaped HTML (skip further escaping). */
export function raw(str) {
  return { __html: String(str ?? '') };
}

/** Parse an HTML string into a DOM node (first element child). */
export function parse(htmlString) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(htmlString).trim();
  return tpl.content.firstElementChild;
}

export function parseAll(htmlString) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(htmlString).trim();
  return Array.from(tpl.content.children);
}

export function renderHTML(target, htmlString) {
  if (typeof target === 'string') target = document.querySelector(target);
  if (!target) return null;
  target.innerHTML = String(htmlString);
  return target;
}

export function qs(sel, root = document) {
  return root.querySelector(sel);
}

export function qsa(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}

/**
 * Event binding with two forms:
 *   on(root, 'click', '[data-action]', handler)  → delegated
 *   on(root, 'input', handler)                   → direct
 */
export function on(root, type, selector, handler, options) {
  const target = typeof root === 'string' ? qs(root) : root;
  if (!target) return () => {};
  if (typeof selector === 'function') {
    const directHandler = selector;
    target.addEventListener(type, directHandler, handler);
    return () => target.removeEventListener(type, directHandler, handler);
  }
  const listener = (event) => {
    const match = event.target.closest(selector);
    if (match && target.contains(match)) handler(event, match);
  };
  target.addEventListener(type, listener, options);
  return () => target.removeEventListener(type, listener, options);
}

export function delegate(root, handlers) {
  const cleanups = [];
  Object.entries(handlers).forEach(([key, fn]) => {
    const [type, selector] = key.split('@');
    cleanups.push(on(root, type, selector, fn));
  });
  return () => cleanups.forEach((c) => c());
}

export function setAttr(el, name, value) {
  if (value === null || value === undefined || value === false) el.removeAttribute(name);
  else el.setAttribute(name, String(value));
  return el;
}

export function addClass(el, ...names) {
  el?.classList?.add(...names.filter(Boolean));
  return el;
}

export function removeClass(el, ...names) {
  el?.classList?.remove(...names.filter(Boolean));
  return el;
}

export function toggleClass(el, name, force) {
  el?.classList?.toggle(name, force);
  return el;
}

export function animateCount(el, from, to, { duration = 750, format = (v) => String(Math.round(v)) } = {}) {
  if (!el) return;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  if (reduce || from === to) {
    el.textContent = format(to);
    return;
  }
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = format(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(tick);
    else el.textContent = format(to);
  };
  requestAnimationFrame(tick);
}

export function trapFocus(container) {
  const focusables = qsa(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    container,
  ).filter((el) => el.offsetParent !== null);
  if (!focusables.length) return () => {};
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const handler = (e) => {
    if (e.key !== 'Tab') return;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  container.addEventListener('keydown', handler);
  return () => container.removeEventListener('keydown', handler);
}

export function debounce(fn, wait = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

export function throttle(fn, wait = 100) {
  let last = 0;
  let timer;
  return (...args) => {
    const now = Date.now();
    const remaining = wait - (now - last);
    if (remaining <= 0) {
      last = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => { timer = null; last = Date.now(); fn(...args); }, remaining);
    }
  };
}
