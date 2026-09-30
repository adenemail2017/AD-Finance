/**
 * Date helpers — all local-time based, ISO (YYYY-MM-DD) as canonical format.
 */

export const MONTHS_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

export const MONTHS_SHORT_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export const DAYS_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
export const DAYS_SHORT_ID = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

export function todayISO() {
  return toISO(new Date());
}

export function toISO(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromISO(iso) {
  if (iso instanceof Date) return iso;
  const [y, m, d] = String(iso || todayISO()).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
}

export function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function monthKey(date = new Date()) {
  const d = date instanceof Date ? date : fromISO(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthKeyOfISO(iso) {
  return String(iso || '').slice(0, 7);
}

export function parseMonthKey(key) {
  const [y, m] = String(key).split('-').map(Number);
  return { year: y, month: (m || 1) - 1 };
}

export function startOfMonthISO(date = new Date()) {
  const d = date instanceof Date ? date : fromISO(date);
  return toISO(new Date(d.getFullYear(), d.getMonth(), 1));
}

export function endOfMonthISO(date = new Date()) {
  const d = date instanceof Date ? date : fromISO(date);
  return toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

export function addDays(iso, days) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

export function addMonths(key, delta) {
  const { year, month } = parseMonthKey(key);
  const d = new Date(year, month + delta, 1);
  return monthKey(d);
}

export function daysBetween(fromIso, toIsoVal) {
  const a = fromISO(fromIso).getTime();
  const b = fromISO(toIsoVal).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** 30 Sep 2026 */
export function formatDate(iso, opts = {}) {
  if (!iso) return '-';
  const d = fromISO(iso);
  const { weekday = false, year = true, short = false } = opts;
  const month = short ? MONTHS_SHORT_ID[d.getMonth()] : MONTHS_ID[d.getMonth()];
  const parts = [];
  if (weekday) parts.push(DAYS_ID[d.getDay()]);
  parts.push(`${d.getDate()} ${month}${year ? ` ${d.getFullYear()}` : ''}`);
  return parts.join(', ');
}

/** Senin, 30 Sep */
export function formatDayHeader(iso) {
  const d = fromISO(iso);
  if (iso === todayISO()) return 'Hari Ini';
  if (iso === addDays(todayISO(), -1)) return 'Kemarin';
  return `${DAYS_ID[d.getDay()]}, ${d.getDate()} ${MONTHS_SHORT_ID[d.getMonth()]} ${d.getFullYear()}`;
}

/** September 2026 */
export function formatMonth(key, short = false) {
  if (!key) return '-';
  const { year, month } = parseMonthKey(key);
  return `${short ? MONTHS_SHORT_ID[month] : MONTHS_ID[month]} ${year}`;
}

export function formatMonthShort(key) {
  const { month } = parseMonthKey(key);
  return MONTHS_SHORT_ID[month];
}

/** "3 hari lagi" / "5 hari lalu" */
export function relativeDays(iso) {
  if (!iso) return '';
  const diff = daysBetween(todayISO(), iso);
  if (diff === 0) return 'hari ini';
  if (diff === 1) return 'besok';
  if (diff === -1) return 'kemarin';
  if (diff > 0) return `${diff} hari lagi`;
  return `${Math.abs(diff)} hari lalu`;
}

export function monthOptions(count = 24, from = new Date()) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(from.getFullYear(), from.getMonth() - i, 1);
    out.push({ value: monthKey(d), label: `${MONTHS_ID[d.getMonth()]} ${d.getFullYear()}` });
  }
  return out;
}

export function yearOptions(count = 6, from = new Date()) {
  const out = [];
  for (let i = 0; i < count; i += 1) out.push(from.getFullYear() - i);
  return out;
}

/** Inclusive range helper for charts & filters. */
export function rangeForPreset(preset, reference = new Date()) {
  const today = toISO(reference);
  switch (preset) {
    case '7d': return { from: addDays(today, -6), to: today, label: '7 Hari' };
    case '30d': return { from: addDays(today, -29), to: today, label: '30 Hari' };
    case '3m': return { from: toISO(new Date(reference.getFullYear(), reference.getMonth() - 2, 1)), to: today, label: '3 Bulan' };
    case '6m': return { from: toISO(new Date(reference.getFullYear(), reference.getMonth() - 5, 1)), to: today, label: '6 Bulan' };
    case '1y': return { from: toISO(new Date(reference.getFullYear() - 1, reference.getMonth() + 1, 1)), to: today, label: '1 Tahun' };
    case 'ytd': return { from: `${reference.getFullYear()}-01-01`, to: today, label: 'Tahun Ini' };
    case 'all': return { from: '1970-01-01', to: today, label: 'Semua' };
    default: return { from: addDays(today, -29), to: today, label: '30 Hari' };
  }
}

export function isSameMonth(iso, key) {
  return String(iso).slice(0, 7) === key;
}

export function weekdayIndex(iso) {
  return fromISO(iso).getDay();
}
