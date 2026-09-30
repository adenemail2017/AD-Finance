/**
 * Formatting helpers — currency, numbers, initials, labels.
 * Indonesian (id-ID) defaults, overridable via profile settings.
 */

const LOCALE = 'id-ID';

let activeCurrency = 'IDR';
let activeLocale = LOCALE;

export function setCurrency(currency) {
  if (currency) activeCurrency = currency;
}

export function setLocale(locale) {
  if (locale) activeLocale = locale;
}

export function getCurrency() {
  return activeCurrency;
}

/** Rp 1.250.000 */
export function money(value, opts = {}) {
  const n = Number(value) || 0;
  const { compact = false, sign = false, decimals } = opts;
  if (compact && Math.abs(n) >= 1_000_000) {
    const units = [
      { v: 1_000_000_000_000, s: ' T' },
      { v: 1_000_000_000, s: ' M' },
      { v: 1_000_000, s: ' jt' },
    ];
    for (const u of units) {
      if (Math.abs(n) >= u.v) {
        const val = n / u.v;
        const str = `${trimZero(val.toFixed(val < 10 ? 1 : 0))}${u.s}`;
        return `${sign && n > 0 ? '+' : n < 0 ? '-' : ''}Rp ${str.replace('-', '')}`;
      }
    }
  }
  const fractionDigits = decimals === undefined ? (activeCurrency === 'IDR' ? 0 : 2) : decimals;
  const formatted = new Intl.NumberFormat(activeLocale, {
    style: 'currency',
    currency: activeCurrency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(Math.abs(n));
  if (n < 0) return `-${formatted}`;
  if (sign && n > 0) return `+${formatted}`;
  return formatted;
}

/** 1.250.000 (no symbol) */
export function number(value, decimals = 0) {
  return new Intl.NumberFormat(activeLocale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(value) || 0);
}

export function compactNumber(value) {
  const n = Number(value) || 0;
  return new Intl.NumberFormat(activeLocale, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function percent(value, decimals = 1, withSign = false) {
  const n = Number(value) || 0;
  const str = `${Math.abs(n).toFixed(decimals)}%`;
  if (n < 0) return `-${str}`;
  return withSign && n > 0 ? `+${str}` : str;
}

export function trimZero(str) {
  return String(str).replace(/\.0+$/, '');
}

export function ratio(part, whole) {
  if (!whole) return 0;
  return (part / whole) * 100;
}

export function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

/** "Rp 1.000.000" → 1000000 (accepts messy user input) */
export function parseMoneyInput(input) {
  if (typeof input === 'number') return Math.round(input);
  if (!input) return 0;
  let s = String(input).trim().toLowerCase();
  const hasMinus = /^-/.test(s) || /^\(/.test(s);
  let multiplier = 1;
  if (/jt|juta/.test(s)) multiplier = 1_000_000;
  else if (/rb|ribu|k\b/.test(s)) multiplier = 1_000;
  else if (/\bm\b|mio|miliar/.test(s)) multiplier = 1_000_000_000;
  s = s.replace(/[^0-9.,]/g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma > -1) {
    const tail = s.length - lastComma - 1;
    s = tail === 3 ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (lastDot > -1) {
    const tail = s.length - lastDot - 1;
    if (tail === 3 && s.split('.').length > 1) s = s.replace(/\./g, '');
  }
  const val = parseFloat(s.replace(/,/g, '.'));
  if (!isFinite(val)) return 0;
  const out = Math.round(val * multiplier);
  return hasMinus ? -out : out;
}

/** Live-format a currency field while typing: 1250000 → "1.250.000" */
export function formatAmountTyping(raw) {
  const digits = String(raw).replace(/[^\d]/g, '');
  if (!digits) return '';
  return number(parseInt(digits, 10));
}

export function initials(name = '') {
  const parts = String(name).trim().split(/[\s_-]+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function titleCase(str = '') {
  return String(str).replace(/\b[\p{L}]/gu, (c) => c.toUpperCase());
}

/** Mask account numbers — privacy by default (•••• 1234). */
export function maskAccountNumber(num = '') {
  const digits = String(num).replace(/\s+/g, '');
  if (!digits) return '';
  if (digits.length <= 4) return `•••• ${digits}`;
  return `•••• ${digits.slice(-4)}`;
}

export function truncate(str, len = 40) {
  const s = String(str ?? '');
  return s.length > len ? `${s.slice(0, len - 1)}…` : s;
}

export function plural(n, singular, p) {
  return n === 1 ? singular : (p || `${singular}`);
}
