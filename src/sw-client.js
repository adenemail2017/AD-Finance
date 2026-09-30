/**
 * Service-worker client helpers — registration, update detection, versioning.
 * Everything degrades gracefully when SW is unavailable (e.g. in-app preview).
 */

export const SW_URL = new URL('../sw.js', import.meta.url).pathname.replace(/\/src\/sw-client\.js.*$/, '/sw.js');
export const APP_VERSION = '1.0.0';

let registration = null;

export function swSupported() {
  try {
    // Accessing navigator.serviceWorker can throw in sandboxed frames — treat
    // that as "unsupported" and keep the app running via normal HTTP caching.
    return 'serviceWorker' in navigator
      && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

export async function registerServiceWorker(onUpdate) {
  if (!swSupported()) {
    console.info('[pwa] service worker tidak didukung pada konteks ini — aplikasi tetap berjalan offline via cache browser.');
    return null;
  }
  try {
    registration = await navigator.serviceWorker.register('sw.js', { scope: './' });
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) onUpdate?.(installing);
      });
    });
    // auto-update check every hour
    setInterval(() => registration?.update().catch(() => {}), 60 * 60 * 1000);
    return registration;
  } catch (error) {
    console.warn('[pwa] service worker registration failed', error);
    return null;
  }
}

export async function checkForUpdate() {
  try {
    const reg = registration || await navigator.serviceWorker?.getRegistration?.();
    if (!reg) return false;
    await reg.update();
    if (reg.waiting) {
      reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function cacheVersion() {
  return `pfos-app-v${APP_VERSION}`;
}

export function isStandalone() {
  try {
    return window.matchMedia?.('(display-mode: standalone)')?.matches
      || window.navigator.standalone === true;
  } catch {
    return false;
  }
}

export async function offlineReady() {
  try {
    if (!('caches' in window)) return false;
    const keys = await caches.keys();
    return keys.some((k) => k.startsWith('pfos-app'));
  } catch {
    return false;
  }
}
