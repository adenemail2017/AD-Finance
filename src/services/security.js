/**
 * Local security — optional PIN lock.
 *
 * The passcode never leaves the device: only a salted SHA-256 hash is stored
 * (in IndexedDB). Unlock state lives in sessionStorage so a refresh keeps the
 * session, but a new browser session asks again.
 */

import { randomSalt, sha256 } from '../utils/id.js';
import { setSetting } from './store.js';

const SESSION_KEY = 'pfos:unlocked';
const ITERATIONS = 120;

async function derive(pin, salt) {
  let value = `${salt}:${pin}`;
  for (let i = 0; i < ITERATIONS; i += 1) value = await sha256(value);
  return value;
}

export function hasPin(state) {
  return Boolean(state?.settings?.pin_hash);
}

export async function setPin(pin, currentPin = null) {
  const settings = window.__pfos?.getState?.().settings || {};
  if (settings.pin_hash) {
    const ok = await verifyPin(currentPin);
    if (!ok) return { ok: false, error: 'PIN lama tidak sesuai.' };
  }
  const salt = randomSalt(12);
  const hash = await derive(pin, salt);
  await setSetting('pin_salt', salt);
  await setSetting('pin_hash', hash);
  await setSetting('pin_set_at', new Date().toISOString());
  markUnlocked();
  return { ok: true };
}

export async function verifyPin(pin) {
  const settings = window.__pfos?.getState?.().settings || {};
  if (!settings.pin_hash) return true;
  const hash = await derive(pin, settings.pin_salt || '');
  return hash === settings.pin_hash;
}

export async function removePin(currentPin) {
  const ok = await verifyPin(currentPin);
  if (!ok) return { ok: false, error: 'PIN tidak sesuai.' };
  await setSetting('pin_hash', '');
  await setSetting('pin_salt', '');
  markUnlocked();
  return { ok: true };
}

export function markUnlocked() {
  try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* ignore */ }
}

export function isUnlocked() {
  try { return sessionStorage.getItem(SESSION_KEY) === '1'; } catch { return true; }
}

export function lock() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

export function pinStrength(pin = '') {
  const value = String(pin);
  if (value.length < 4) return { score: 0, label: 'Terlalu pendek', tone: 'neg' };
  let score = 1;
  if (value.length >= 6) score += 1;
  if (/(\d)\1{2,}/.test(value)) score -= 1;
  if (/^(?:0123|1234|2345|3456|4567|5678|6789|9876|8765|7654|6543|5432|4321|3210)/.test(value)) score -= 1;
  const label = score <= 0 ? 'Lemah' : score === 1 ? 'Cukup' : 'Kuat';
  const tone = score <= 0 ? 'neg' : score === 1 ? 'warn' : 'pos';
  return { score, label, tone };
}
