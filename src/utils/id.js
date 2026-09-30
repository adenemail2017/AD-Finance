/** ID generation + fingerprint hashing (no external deps). */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export function uid(prefix = '') {
  const time = Date.now().toString(36);
  let rand = '';
  if (globalThis.crypto?.getRandomValues) {
    const buf = new Uint8Array(8);
    crypto.getRandomValues(buf);
    rand = Array.from(buf, (b) => ALPHABET[b % ALPHABET.length]).join('');
  } else {
    rand = Math.random().toString(36).slice(2, 10);
  }
  return `${prefix}${prefix ? '_' : ''}${time}${rand}`;
}

export function shortId(len = 8) {
  let out = '';
  for (let i = 0; i < len; i += 1) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}

/** djb2 — fast, stable string hash for local fingerprints. */
export function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i += 1) hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

export async function sha256(text) {
  if (!globalThis.crypto?.subtle) return hashString(text);
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomSalt(len = 16) {
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function groupBy(list, keyFn) {
  return list.reduce((acc, item) => {
    const key = typeof keyFn === 'function' ? keyFn(item) : item[keyFn];
    (acc[key] = acc[key] || []).push(item);
    return acc;
  }, {});
}

export function sum(list, fn = (x) => x) {
  return list.reduce((acc, item) => acc + (Number(fn(item)) || 0), 0);
}

export function sortBy(list, fn, dir = 'asc') {
  const copy = [...list];
  copy.sort((a, b) => {
    const av = fn(a);
    const bv = fn(b);
    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ? 1 : -1;
    return 0;
  });
  return copy;
}

export function unique(list) {
  return Array.from(new Set(list));
}
